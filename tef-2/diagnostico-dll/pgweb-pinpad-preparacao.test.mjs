import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "../..");
const fonte = path.join(aqui, "PgWebDiagnostico.lpr");
const simulador = path.join(aqui, "PgWebPinPadSim.lpr");
const dllKit = path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924", "x64", "PGWebLib.dll");
const fpc = "C:\\lazarus\\fpc\\3.2.2\\bin\\x86_64-win64\\fpc.exe";
const saida = path.join(aqui, "bin");
const exe = path.join(saida, "PgWebDiagnostico.exe");
const dllSim = path.join(saida, "PgWebPinPadSim.dll");
const marca = path.join(saida, "pinpad-sim-chamado.txt");
const raizEnsaio = path.join(aqui, "ensaio-init");
const fraseSim = "AUTORIZAR-PINPAD-SIM-4.1.50.924";
const fraseReal = "AUTORIZAR-PINPAD-REAL-4.1.50.924";
const fraseInit = "AUTORIZAR-PW-IINIT-REAL-4.1.50.924";
const conector = path.join(process.env.ProgramFiles, "UltraPDV Connector");

function mapa(texto) {
  const saidaMapa = new Map();
  for (const linha of texto.split(/\r?\n/)) {
    const espaco = linha.indexOf(" ");
    if (espaco < 1) continue;
    const chave = linha.slice(0, espaco);
    const valor = linha.slice(espaco + 1);
    if (!saidaMapa.has(chave)) saidaMapa.set(chave, []);
    saidaMapa.get(chave).push(valor);
  }
  return saidaMapa;
}

function executar(args, envExtra = {}) {
  return spawnSync(exe, args, { encoding: "utf8", env: { ...process.env, ...envExtra } });
}

function pinpad(pasta, extra = []) {
  rmSync(marca, { force: true });
  rmSync(pasta, { recursive: true, force: true });
  return executar(["--pinpad", dllSim, pasta, "--autorizado-pinpad", ...extra], {
    PGWEB_PINPAD_AUTORIZACAO: fraseSim,
  });
}

test("o pinpad simulado percorre init, comunicacao e evento sem a DLL oficial", () => {
  mkdirSync(path.join(saida, "pinpad"), { recursive: true });
  mkdirSync(path.join(saida, "pinpad-sim"), { recursive: true });
  mkdirSync(raizEnsaio, { recursive: true });
  const compilou = spawnSync(
    fpc,
    ["-Px86_64", "-FU" + path.join(saida, "pinpad"), "-FE" + saida, fonte],
    { encoding: "utf8" },
  );
  assert.equal(compilou.status, 0, compilou.stdout + compilou.stderr);
  const compilouSim = spawnSync(
    fpc,
    ["-Px86_64", "-FU" + path.join(saida, "pinpad-sim"), "-FE" + saida, simulador],
    { encoding: "utf8" },
  );
  assert.equal(compilouSim.status, 0, compilouSim.stdout + compilouSim.stderr);

  const fonteTexto = readFileSync(fonte, "utf8");
  const real = fonteTexto.slice(fonteTexto.indexOf("procedure EnsaiarReal"), fonteTexto.indexOf("procedure Uso"));
  const fluxo = fonteTexto.slice(fonteTexto.indexOf("procedure ExecutarPinPad"), fonteTexto.indexOf("procedure Recusar"));
  assert.equal(real.includes("PW_iPP"), false);
  assert.equal(fluxo.includes("PW_iNewTransac"), false);
  assert.equal(fluxo.includes("PW_iExecTransac"), false);
  assert.equal(fluxo.includes("PW_iConfirmation"), false);
  assert.equal(fluxo.includes("PW_iSetEnvironment"), false);
  assert.equal(fluxo.includes("PW_iGetResult"), false);
  assert.equal(fluxo.includes("PW_iPPAbort"), false);
  assert.equal(fluxo.includes("PW_iPPGetCard"), false);
  assert.equal((fonteTexto.match(/GetProcAddress\(Lib, 'PW_iInit'\)/g) || []).length, 1);
  const agente = readFileSync(path.join(raiz, "tef-2", "agente", "PgWebLib.pas"), "utf8");
  assert.match(agente, /ABI_COMPROVADO = False/);
  assert.match(agente, /LAYOUT_HOMOLOGADO = False/);
  const header = readFileSync(path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924", "PGWebLib.h"), "utf8");
  assert.match(header, /PW_iPPCommTest \(char \*pszMsg, Uint16 uiMsgSize, Byte \*pbCommPort\)/);
  assert.match(header, /PW_iPPEventLoop \(char \*pszDisplay, Uint32 ulDisplaySize\)/);

  const antesConector = statSync(path.join(conector, "version.json")).mtimeMs;
  const antesDados = statSync(path.join(conector, "data")).mtimeMs;
  const okDir = path.join(raizEnsaio, "ensaio-pinpad-ok");
  const ok = pinpad(okDir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const okMapa = mapa(ok.stdout);
  assert.equal(okMapa.get("resultado").at(-1), "PINPAD_SIMULADO");
  assert.equal(okMapa.get("dllReal").at(-1), "0");
  assert.equal(okMapa.get("initRetorno")[0], "0");
  assert.equal(okMapa.get("initNome")[0], "PWRET_OK");
  assert.equal(okMapa.get("commTestRetorno")[0], "0");
  assert.equal(okMapa.get("commTestNome")[0], "PWRET_OK");
  assert.equal(okMapa.get("porta")[0], "01");
  assert.deepEqual(okMapa.get("eventoNome"), ["PWRET_NOTHING", "PWRET_DISPLAY", "PWRET_OK"]);
  assert.equal(okMapa.get("mensagem").at(-1), "teste pinpad");
  assert.equal(okMapa.get("voltas")[0], "3");
  assert.equal(okMapa.get("buffer")[0], "128");
  assert.equal(okMapa.get("larguraUint16")[0], "2");
  assert.equal(okMapa.get("larguraUint32")[0], "4");
  assert.equal(okMapa.get("larguraByte")[0], "1");
  assert.equal(okMapa.get("tiposKit")[0], "nao-comprovado");
  assert.equal(readFileSync(marca, "utf8"), "init\r\ncommtest\r\neventloop\r\neventloop\r\neventloop\r\n");

  const erroDir = path.join(raizEnsaio, "ensaio-pinpad-erro");
  const erro = pinpad(erroDir);
  assert.equal(erro.status, 0, erro.stdout + erro.stderr);
  const erroMapa = mapa(erro.stdout);
  assert.equal(erroMapa.get("commTestNome")[0], "PWRET_PPCOMERR");
  assert.equal(erroMapa.get("porta")[0], "FF");
  assert.equal(erroMapa.get("eventLoopChamado")[0], "0");
  assert.equal(readFileSync(marca, "utf8").includes("eventloop"), false);

  const nadaDir = path.join(raizEnsaio, "ensaio-pinpad-nada");
  const nada = pinpad(nadaDir);
  assert.equal(nada.status, 0, nada.stdout + nada.stderr);
  const nadaMapa = mapa(nada.stdout);
  assert.equal(nadaMapa.get("commTestNome")[0], "PWRET_NOTHING");
  assert.equal(nadaMapa.get("mensagem")[0], "sem pinpad");
  assert.equal(nadaMapa.get("porta")[0], "FF");
  assert.equal(nadaMapa.get("eventLoopChamado")[0], "0");

  const semAuth = executar(["--pinpad", dllSim, path.join(raizEnsaio, "ensaio-pinpad-sem")]);
  assert.equal(semAuth.status, 0, semAuth.stdout);
  assert.equal(mapa(semAuth.stdout).get("resultado").at(-1), "PINPAD_DESABILITADO");
  assert.equal(mapa(semAuth.stdout).get("dllCarregada").at(-1), "0");

  const oficial = executar(["--pinpad", dllKit, path.join(raizEnsaio, "ensaio-pinpad-oficial"), "--autorizado-pinpad"], {
    PGWEB_PINPAD_AUTORIZACAO: fraseSim,
    PGWEB_PINPAD_REAL: fraseReal,
    PGWEB_INIT_REAL: fraseInit,
  });
  assert.equal(oficial.status, 12, oficial.stdout + oficial.stderr);
  assert.equal(mapa(oficial.stdout).get("resultado").at(-1), "DLL_REAL_BLOQUEADA");
  assert.equal(mapa(oficial.stdout).get("dllCarregada").at(-1), "0");
  assert.equal(mapa(oficial.stdout).get("initChamado").at(-1), "0");

  const realSemPinpad = executar(
    ["--pinpad-real", dllKit, "--autorizado-real", "--aceitar-risco-isolamento"],
    { PGWEB_INIT_REAL: fraseInit },
  );
  assert.equal(realSemPinpad.status, 0, realSemPinpad.stdout);
  assert.equal(mapa(realSemPinpad.stdout).get("resultado").at(-1), "PINPAD_DESABILITADO");
  assert.equal(mapa(realSemPinpad.stdout).get("dllCarregada").at(-1), "0");
  assert.match(mapa(realSemPinpad.stdout).get("comando")[0], /--autorizado-pinpad/);
  assert.match(mapa(realSemPinpad.stdout).get("comando")[0], /PGWEB_PINPAD_REAL='AUTORIZAR-PINPAD-REAL-4\.1\.50\.924'/);

  const realSemInit = executar(["--pinpad-real", dllKit, "--autorizado-pinpad"], {
    PGWEB_PINPAD_REAL: fraseReal,
  });
  assert.equal(realSemInit.status, 0, realSemInit.stdout);
  assert.equal(mapa(realSemInit.stdout).get("resultado").at(-1), "INIT_DESABILITADO");
  assert.equal(mapa(realSemInit.stdout).get("dllReal").at(-1), "0");
  assert.equal(mapa(realSemInit.stdout).get("initChamado").at(-1), "0");

  const outra = executar(
    ["--pinpad-real", "C:\\ultrapdv\\nao-oficial\\x64\\PGWebLib.dll", "--autorizado-real", "--aceitar-risco-isolamento", "--autorizado-pinpad"],
    { PGWEB_INIT_REAL: fraseInit, PGWEB_PINPAD_REAL: fraseReal },
  );
  assert.equal(outra.status, 12, outra.stdout);
  assert.equal(mapa(outra.stdout).get("resultado").at(-1), "DLL_REAL_BLOQUEADA");
  assert.equal(mapa(outra.stdout).get("dllCarregada").at(-1), "0");
  assert.equal(mapa(outra.stdout).get("initChamado").at(-1), "0");

  assert.equal(statSync(path.join(conector, "version.json")).mtimeMs, antesConector);
  assert.equal(statSync(path.join(conector, "data")).mtimeMs, antesDados);
});
