import path from "node:path";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, PGWEB2_PRODUCAO, PWCNF, PWRET } from "./tef-pgweb.mjs";

export const FRASE_COMPROVACAO_FISICA = "AUTORIZO_COMPROVACAO_FISICA_HOMOLOGACAO";
export const VALOR_MAXIMO_COMPROVACAO_CENTAVOS = 100;
export const ARQUIVO_EVIDENCIA_COMPROVACAO = "tef-journal-comprovacao-fisica.json";

const CONTINUOS = new Set([PWRET.NOTHING, PWRET.DISPLAY]);
const TERMINAIS_EVENTO = new Set([PWRET.OK, PWRET.CANCEL, PWRET.TIMEOUT, PWRET.PPCOMERR]);

function identidadeValida(entrada) {
  return (
    String(entrada.empresaId ?? "").trim().length > 0 &&
    String(entrada.terminalCodigo ?? "").trim().length > 0 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(entrada.dispositivoId ?? "")) &&
    /^[A-Za-z0-9._-]{1,40}$/.test(String(entrada.posid ?? ""))
  );
}

function sessaoHomologacaoValida(biblioteca) {
  return Boolean(
    biblioteca &&
      biblioteca.residente === true &&
      biblioteca.homologacao === true &&
      biblioteca.producao !== true &&
      biblioteca.origem === "conector" &&
      typeof biblioteca.ppAbort === "function" &&
      typeof biblioteca.ppEventLoop === "function" &&
      typeof biblioteca.confirmation === "function" &&
      typeof biblioteca.waitConfirmation === "function"
  );
}

export function auditarTiposSdk({ kitPresente = false, headerLinux = "" } = {}) {
  const linux = String(headerLinux ?? "");
  const headerLinuxOficial = linux.includes("Plataforma") && linux.includes("Linux") && /unsigned\s+long\s+Uint32/.test(linux);
  return {
    kitContemPwlType: kitPresente === true,
    headerLinuxOficial,
    compativelComDllWindows: false,
    abiComprovado: false,
    layoutHomologado: false,
    motivo: kitPresente
      ? "O kit contém um PWL_Type.h, mas sizeof e alinhamento ainda não foram medidos na DLL Windows 4.1.50.924."
      : "O kit 4.1.50.924 não traz PWL_Type.h. O header Linux da SETIS declara Uint32 como unsigned long e não comprova o ABI da DLL Windows x64.",
  };
}

export function avaliarComprovacaoFisica(entrada = {}) {
  const falhas = [];
  if (entrada.ambiente !== "homologacao") falhas.push("producao");
  if (entrada.frase !== FRASE_COMPROVACAO_FISICA) falhas.push("autorizacao");
  if (!identidadeValida(entrada)) falhas.push("identidade");
  const valor = Number(entrada.valorCentavos);
  if (!Number.isInteger(valor) || valor <= 0 || valor > VALOR_MAXIMO_COMPROVACAO_CENTAVOS) falhas.push("valor");
  if (!sessaoHomologacaoValida(entrada.biblioteca)) falhas.push("sessao");
  if (entrada.com7Exclusiva !== true || entrada.portaPinpadOcupada === true) falhas.push("com7");
  if (entrada.journal?.seguir === false) falhas.push("journal");
  if (entrada.evidenciaExistente && entrada.evidenciaExistente.encerrado !== true) falhas.push("recuperacao");
  return {
    ok: falhas.length === 0,
    falhas,
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
    layoutExigido: false,
    abiExigido: false,
    flagsAlteradas: false,
    abiComprovado: ABI_COMPROVADO === true,
    layoutHomologado: LAYOUT_HOMOLOGADO === true,
    producaoLiberada: PGWEB2_PRODUCAO === true,
  };
}

function referenciasCompletas(refs) {
  return ["reqNum", "locRef", "extRef", "virtMerch", "authSyst"].every((campo) => String(refs?.[campo] ?? "").trim());
}

async function coletarCancelamento(transporte) {
  const abort = Number(await transporte.ppAbort());
  const eventos = [];
  for (let sonda = 0; sonda < 8; sonda += 1) {
    const evento = await transporte.ppEventLoop();
    const codigo = Number(evento?.codigo ?? evento);
    eventos.push(codigo);
    if (!CONTINUOS.has(codigo)) break;
  }
  const evento = eventos.at(-1);
  return {
    abort,
    evento,
    eventos,
    contratoAbort: abort === PWRET.OK || abort === PWRET.PPCOMERR || abort === PWRET.DLLNOTINIT,
    contratoEvento: TERMINAIS_EVENTO.has(evento),
  };
}

async function coletarConfirmacao(transporte, refs) {
  if (!referenciasCompletas(refs)) {
    return { confirmacao: null, espera: null, contratoConfirmacao: false, contratoEspera: false, motivo: "referencias" };
  }
  const confirmacao = Number(await transporte.confirmation(PWCNF.CNF_AUTO, refs));
  const espera = confirmacao === PWRET.OK ? Number(await transporte.waitConfirmation()) : null;
  return {
    confirmacao,
    espera,
    contratoConfirmacao: Number.isInteger(confirmacao),
    contratoEspera: espera === null || Number.isInteger(espera),
  };
}

export async function coletarRetornosComprovacao(entrada = {}, transporte = null) {
  const gate = avaliarComprovacaoFisica(entrada);
  if (!gate.ok || entrada.executar !== true) {
    return { ...gate, executado: false, retornos: null, simulado: entrada.simulado === true };
  }
  const destino = transporte ?? entrada.biblioteca;
  const cancelamento = await coletarCancelamento(destino);
  const confirmacao = await coletarConfirmacao(destino, entrada.referencias ?? {});
  return {
    ...gate,
    ok: true,
    executado: true,
    simulado: entrada.simulado === true,
    retornos: { ...cancelamento, ...confirmacao },
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
    flagsAlteradas: false,
  };
}

export function avaliarCapacidadeComprovacao(registro = null) {
  const fisico = Boolean(registro && registro.executado === true && registro.simulado !== true && registro.retornos);
  const retornos = registro?.retornos ?? {};
  return {
    abiComprovado: false,
    layoutHomologado: false,
    producaoLiberada: false,
    abortColetado: fisico && Number.isInteger(retornos.abort),
    eventoColetado: fisico && Number.isInteger(retornos.evento),
    confirmacaoColetada: fisico && Number.isInteger(retornos.confirmacao),
    esperaColetada: fisico && Number.isInteger(retornos.espera),
    flagsAlteradas: false,
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
  };
}

export async function persistirEvidenciaComprovacao(arquivo, registro, fsApi) {
  if (!arquivo || !registro?.idempotencyKey) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  let existente = null;
  try {
    existente = await fsApi.readFile(arquivo, "utf8");
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      return { gravado: false, preservado: true, journalApagado: false, codigo: erro?.code === "EPERM" || erro?.code === "EACCES" ? "permissao" : "leitura" };
    }
  }
  if (existente != null) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  await fsApi.mkdir(path.dirname(arquivo), { recursive: true });
  try {
    await fsApi.writeFile(arquivo, `${JSON.stringify({ ...registro, pagamentoRecebido: false, podeFinalizar: false, nfcEEmitida: false }, null, 2)}\n`, { flag: "wx" });
  } catch (erro) {
    if (erro?.code === "EEXIST") return { gravado: false, preservado: true, journalApagado: false };
    throw erro;
  }
  return { gravado: true, preservado: true, journalApagado: false };
}
