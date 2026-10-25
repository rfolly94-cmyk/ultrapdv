import fs from "node:fs/promises";
import path from "node:path";

import { arquiteturaPe } from "./tef-dll.mjs";
import { prepararTipoGetDataInstalacao } from "./tef-instalacao-homologacao.mjs";
import { ASSINATURAS_NATIVAS } from "./tef-pgweb.mjs";

export const TAMANHO_PW_GETDATA = 12500;

export const OFFSETS_PW_GETDATA = Object.freeze({
  wIdentificador: 0,
  bTipoDeDado: 2,
  szPrompt: 3,
  bNumOpcoesMenu: 87,
  vszTextoMenu: 88,
  vszValorMenu: 1728,
  ulValorMinimo: 12012,
  ulValorMaximo: 12016,
  ulTipoEntradaCartao: 12404,
  bAlinhaPelaDireita: 12498,
});

export const ASSINATURAS_FINANCEIRAS = Object.freeze([
  ["PW_iNewTransac", ASSINATURAS_NATIVAS.PW_iNewTransac],
  ["PW_iAddParam", ASSINATURAS_NATIVAS.PW_iAddParam],
  ["PW_iExecTransac", ASSINATURAS_NATIVAS.PW_iExecTransac],
  ["PW_iGetResult", ASSINATURAS_NATIVAS.PW_iGetResult],
  ["PW_iConfirmation", ASSINATURAS_NATIVAS.PW_iConfirmation],
  ["PW_iWaitConfirmation", "int16 __stdcall PW_iWaitConfirmation()"],
]);

export function caminhoDeProducao(arquivo) {
  const normal = String(arquivo ?? "").replaceAll("/", "\\").toLowerCase();
  return normal.includes("\\producao\\") || normal.includes("\\paygo\\") || normal.includes("pos-transac");
}

export function medirLayoutFinanceiro(koffi) {
  const tipo = prepararTipoGetDataInstalacao(koffi);
  const offsets = {};
  for (const nome of Object.keys(OFFSETS_PW_GETDATA)) {
    offsets[nome] = koffi.offsetof(tipo, nome);
  }
  return { sizeof: koffi.sizeof(tipo), offsets };
}

export async function inspecionarDllFinanceira(arquivoDll, deps = {}) {
  if (caminhoDeProducao(arquivoDll)) {
    throw Object.assign(new Error("O perfil de produção não pode ser usado nesta prova."), {
      code: "PERFIL_PRODUCAO",
    });
  }
  if (path.win32.basename(String(arquivoDll ?? "")).toLowerCase() !== "pgweblib.dll") {
    throw Object.assign(new Error("A prova só abre PGWebLib.dll."), { code: "DLL_INESPERADA" });
  }
  const bytes = await fs.readFile(arquivoDll);
  const arquitetura = arquiteturaPe(bytes);
  if (arquitetura !== "x64") {
    throw Object.assign(new Error("A prova exige a DLL Windows x64 4.1.50.924."), { code: "ARQUITETURA" });
  }
  const koffi = deps.koffi ?? (await import("koffi")).default;
  const layout = medirLayoutFinanceiro(koffi);
  if (layout.sizeof !== TAMANHO_PW_GETDATA) {
    throw Object.assign(new Error("O layout de PW_GetData não confere com o cabeçalho."), { code: "LAYOUT" });
  }
  for (const [nome, esperado] of Object.entries(OFFSETS_PW_GETDATA)) {
    if (layout.offsets[nome] !== esperado) {
      throw Object.assign(new Error("O alinhamento de PW_GetData não confere com o cabeçalho."), { code: "LAYOUT" });
    }
  }
  const carregar = deps.carregar ?? ((arquivo) => koffi.load(arquivo));
  const lib = carregar(arquivoDll);
  const chamadas = [];
  for (const [nome, assinatura] of ASSINATURAS_FINANCEIRAS) {
    const fn = lib.func(assinatura);
    if (typeof fn !== "function") {
      throw Object.assign(new Error("Exportação financeira ausente."), { code: "EXPORTACAO" });
    }
    chamadas.push(nome);
  }
  return {
    arquitetura,
    sizeof: layout.sizeof,
    offsets: layout.offsets,
    exportacoes: chamadas,
    invocacoes: 0,
    vendaExecutada: false,
  };
}
