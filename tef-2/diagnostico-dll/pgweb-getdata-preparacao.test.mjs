import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { vigiar } from "./supervisor-getdata.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "../..");
const fpc = "C:\\lazarus\\fpc\\3.2.2\\bin\\x86_64-win64\\fpc.exe";
const fonte = resolve(aqui, "PgWebGetData.lpr");
const exe = resolve(aqui, "bin", "PgWebGetData.exe");
const dllKit = resolve(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924", "x64", "PGWebLib.dll");
const acbr = readFileSync("C:\\ACBr\\Fontes\\ACBrTEFD\\ACBrTEFPayGoWebComum.pas", "utf8");

function mapa(saida) {
  const linhas = new Map();
  for (const linha of saida.split(/\r?\n/)) {
    const espaco = linha.indexOf(" ");
    if (espaco < 1) continue;
    const chave = linha.slice(0, espaco);
    const valor = linha.slice(espaco + 1);
    const lista = linhas.get(chave) ?? [];
    lista.push(valor);
    linhas.set(chave, lista);
  }
  return linhas;
}

function ultimo(item, chave) {
  const lista = item.get(chave);
  assert.ok(lista, chave);
  return lista.at(-1);
}

test("o diagnostico de PW_GetData copia o ACBr e nao executa a DLL", async () => {
  const texto = readFileSync(fonte, "utf8");
  const declaracao = acbr.slice(acbr.indexOf("TPW_GetData = record"), acbr.indexOf("TArrPW_GetData"));
  for (const campo of ["wIdentificador: Word", "bTipoDeDado: Byte", "ulValorMinimo", "ulTipoEntradaCartao", "bAlinhaPelaDireita: Byte"]) {
    assert.equal(declaracao.includes(campo), true, campo);
    assert.equal(texto.includes(campo.replace(": LongWord", ": LongWord")), true);
  }
  assert.match(acbr, /xPW_iExecTransac: function\(pvstParam: TArrPW_GetData; var piNumParam: SmallInt\)/);
  assert.match(acbr, /NumParams := Length\(ArrParams\)-1/);
  assert.match(texto, /TPwExec = function\(pvstParam: TArrPWGetData; var piNumParam: SmallInt\)/);
  assert.equal(texto.includes("CAPACIDADE_SUGERIDA = 9"), true);
  assert.equal(texto.includes("Quantidade := CAPACIDADE_SUGERIDA"), true);
  assert.equal(texto.split("Exec(Parametros").length - 1, 1);
  assert.equal(texto.includes("PW_iAddParam"), false);
  assert.equal(texto.includes("PW_iPPAbort"), false);
  assert.equal(texto.includes("PW_iGetResult"), true);
  assert.equal(texto.includes("bloqueada-sem-referencia"), true);
  assert.equal(texto.includes("PWCNF_REV_OTHER_AUT"), true);
  assert.equal(texto.includes("PW_iConfirmation"), true);
  assert.equal(texto.includes("SetCurrentDir"), true);
  assert.equal(texto.includes("ENVRMNT_TEST"), true);
  assert.equal(texto.includes("nao-interrompe-chamada"), true);
  assert.equal(texto.includes("sizeof divergente"), true);
  const fim = texto.indexOf("procedure FinalizarBiblioteca");
  const fimCorpo = texto.slice(fim, texto.indexOf("procedure ExecutarInstalacao"));
  assert.equal(fimCorpo.indexOf("Encerrar()") < fimCorpo.indexOf("FreeLibrary"), true);
  assert.equal(texto.includes("314159"), false);
  assert.equal(texto.includes("ABI_COMPROVADO = True"), false);
  assert.equal(texto.includes("LAYOUT_HOMOLOGADO = True"), false);
  const carga = texto.indexOf("Lib := LoadLibrary");
  const trava = texto.indexOf("if not Autorizado");
  assert.equal(trava > 0 && trava < carga, true);

  mkdirSync(resolve(aqui, "bin", "getdata"), { recursive: true });
  const compilado = spawnSync(fpc, ["-Mdelphi", "-Px86_64", "-FU" + resolve(aqui, "bin", "getdata"), "-FE" + resolve(aqui, "bin"), fonte], { encoding: "utf8" });
  assert.equal(compilado.status, 0, compilado.stdout + compilado.stderr);

  const layout = spawnSync(exe, ["--layout"], { encoding: "utf8" });
  assert.equal(layout.status, 0);
  const layoutMapa = mapa(layout.stdout);
  assert.equal(ultimo(layoutMapa, "resultado"), "LAYOUT_LOCAL");
  assert.equal(ultimo(layoutMapa, "passagem"), "array-estatico");
  assert.equal(ultimo(layoutMapa, "slots"), "9");
  assert.equal(ultimo(layoutMapa, "numParamInicial"), "9");
  assert.equal(ultimo(layoutMapa, "execMaximo"), "1");
  assert.equal(ultimo(layoutMapa, "protecaoEscrita"), "0");
  assert.equal(ultimo(layoutMapa, "limiteNativo"), "nao-interrompe-chamada");
  assert.equal(ultimo(layoutMapa, "reversaoForcada"), "nao-garantida");
  assert.equal(ultimo(layoutMapa, "sizeofWord"), "2");
  assert.equal(ultimo(layoutMapa, "sizeofByte"), "1");
  assert.equal(ultimo(layoutMapa, "sizeofLongWord"), "4");
  assert.equal(ultimo(layoutMapa, "abiComprovado"), "0");
  assert.equal(ultimo(layoutMapa, "layoutHomologado"), "0");
  assert.equal(ultimo(layoutMapa, "layoutSelecionado"), "0");
  assert.equal(ultimo(layoutMapa, "loadLibrary"), "0");
  const campos = layoutMapa.get("campo").join(" ");
  assert.match(campos, /wIdentificador offset=0 sizeof=2/);
  assert.match(campos, /bTipoDeDado offset=\d+ sizeof=1/);
  assert.match(campos, /ulTipoEntradaCartao offset=\d+ sizeof=4/);

  const semAuth = spawnSync(exe, ["--exec-install", dllKit, "--autorizado-getdata"], { encoding: "utf8" });
  assert.equal(semAuth.status, 0);
  const semMapa = mapa(semAuth.stdout);
  assert.equal(ultimo(semMapa, "resultado"), "EXEC_DESABILITADO");
  assert.equal(ultimo(semMapa, "loadLibrary"), "0");
  assert.equal(semAuth.stdout.includes("PW_iInit"), false);

  const producao = spawnSync(exe, ["--preparar", "C:\\ProgramData\\UltraPDV\\TEF\\Producao\\x64\\PGWebLib.dll"], { encoding: "utf8" });
  assert.equal(producao.status, 3);
  assert.equal(ultimo(mapa(producao.stdout), "resultado"), "DIRETORIO_PRODUCAO");
  assert.equal(ultimo(mapa(producao.stdout), "loadLibrary"), "0");

  const preparado = spawnSync(exe, ["--preparar", dllKit], { encoding: "utf8" });
  assert.equal(preparado.status, 0, preparado.stdout);
  const pronto = mapa(preparado.stdout);
  assert.equal(ultimo(pronto, "resultado"), "PREPARADO_SEM_EXECUCAO");
  assert.equal(ultimo(pronto, "hashConfere"), "1");
  assert.equal(ultimo(pronto, "loadLibrary"), "0");
  assert.equal(preparado.stdout.includes("314159"), false);

  const paygo = spawnSync(exe, ["--preparar", "C:\\Program Files (x86)\\PayGo\\x64\\PGWebLib.dll"], { encoding: "utf8" });
  assert.equal(paygo.status, 3);
  assert.equal(ultimo(mapa(paygo.stdout), "resultado"), "DIRETORIO_PRODUCAO");
  assert.equal(ultimo(mapa(paygo.stdout), "loadLibrary"), "0");

  const rapido = await vigiar({
    comando: process.execPath,
    args: ["-e", "process.exit(0)"],
    timeoutMs: 5000,
  });
  assert.equal(rapido.resultado, "CONCLUIDO");
  assert.equal(rapido.encerramentoForcado, 0);
  assert.equal(rapido.reversaoFiscal, 0);
  assert.equal(rapido.reversaoFinanceira, 0);

  const preso = await vigiar({
    comando: process.execPath,
    args: ["-e", "setTimeout(() => {}, 30000)"],
    timeoutMs: 300,
  });
  assert.equal(preso.resultado, "TRAVAMENTO");
  assert.equal(preso.encerramentoForcado, 1);
  assert.equal(preso.reversaoFiscal, 0);
  assert.equal(preso.reversaoFinanceira, 0);
});
