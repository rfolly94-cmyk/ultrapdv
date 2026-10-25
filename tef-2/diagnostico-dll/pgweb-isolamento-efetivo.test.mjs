import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "../..");
const fonte = path.join(aqui, "PgWebDiagnostico.lpr");
const unidade = path.join(aqui, "PgWebRestrito.pas");
const fpc = "C:\\lazarus\\fpc\\3.2.2\\bin\\x86_64-win64\\fpc.exe";
const exe = path.join(aqui, "bin", "PgWebDiagnostico.exe");
const conector = path.join(process.env.ProgramFiles, "UltraPDV Connector");
const producao = path.join(process.env.ProgramData, "UltraPDV");

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

test("o token restrito nega producao e nao fica exclusivo", () => {
  mkdirSync(path.join(aqui, "bin", "isolamento-efetivo"), { recursive: true });
  const compilou = spawnSync(
    fpc,
    ["-Px86_64", "-FU" + path.join(aqui, "bin", "isolamento-efetivo"), "-FE" + path.join(aqui, "bin"), fonte],
    { encoding: "utf8" },
  );
  assert.equal(compilou.status, 0, compilou.stdout + compilou.stderr);
  const fonteTexto = readFileSync(fonte, "utf8");
  const procedimento = fonteTexto.slice(
    fonteTexto.indexOf("procedure EnsaiarReal"),
    fonteTexto.indexOf("procedure Uso"),
  );
  assert.equal(procedimento.indexOf("ISOLAMENTO_REPROVADO") < procedimento.indexOf("LoadLibraryA"), true);
  assert.equal(procedimento.indexOf("IsolamentoExclusivoAtual") < procedimento.indexOf("LoadLibraryA"), true);
  assert.equal(readFileSync(unidade, "utf8").includes("PW_iInit"), false);
  const agente = readFileSync(path.join(raiz, "tef-2", "agente", "PgWebLib.pas"), "utf8");
  assert.match(agente, /ABI_COMPROVADO = False/);
  assert.match(agente, /LAYOUT_HOMOLOGADO = False/);

  const antesConector = statSync(path.join(conector, "version.json")).mtimeMs;
  const antesDados = statSync(path.join(conector, "data")).mtimeMs;
  const antesProducao = statSync(producao).mtimeMs;
  const prova = spawnSync(exe, ["--isolamento"], { encoding: "utf8" });
  assert.equal(prova.status, 6, prova.stdout + prova.stderr);
  const saida = mapa(prova.stdout);
  assert.equal(saida.get("resultado").at(-1), "ISOLAMENTO_REPROVADO");
  assert.equal(saida.get("mecanismo")[0], "CreateRestrictedToken+TokenIntegrityLevel+CreateProcessAsUser");
  assert.equal(saida.get("aclProducaoAlterada")[0], "0");
  assert.equal(saida.get("tokenAtualProgramData")[0], "permitido");
  assert.equal(saida.get("medioProgramData")[0], "permitido");
  assert.equal(saida.get("usuarioProcesso")[0], "inviavel");
  assert.equal(saida.get("integridade")[0], "1000");
  assert.equal(saida.get("elevado")[0], "0");
  assert.equal(saida.get("escritaEnsaio")[0], "permitido");
  assert.equal(saida.get("programData")[0], "negado");
  assert.equal(saida.get("conectorDados")[0], "negado");
  assert.equal(saida.get("conectorArquivo")[0], "negado");
  assert.equal(saida.get("conectorInstalacao")[0], "negado");
  assert.equal(saida.get("paygoExiste")[0], "0");
  assert.equal(saida.get("paygoPai")[0], "negado");
  assert.equal(saida.get("localLow")[0], "permitido");
  assert.equal(saida.get("cacheBaixo")[0], "permitido");
  assert.equal(saida.get("repositorio")[0], "negado");
  assert.equal(saida.get("leituraDll")[0], "permitido");
  assert.equal(saida.get("escritaDll")[0], "negado");
  assert.equal(saida.get("cargaDll")[0], "permitido");
  assert.equal(saida.get("ajusteDebug")[0], "negado");
  assert.equal(saida.get("tokenLigado")[0], "presente");
  assert.equal(saida.get("initChamado").at(-1), "0");
  assert.equal(saida.get("ambientePayGo")[0], "ausente");
  assert.equal(saida.get("isolamentoExclusivo")[0], "0");
  assert.equal(saida.get("isolamentoGarantido").at(-1), "0");
  assert.equal(saida.get("ausenciaNaoComprova")[0], "1");
  assert.equal(statSync(path.join(conector, "version.json")).mtimeMs, antesConector);
  assert.equal(statSync(path.join(conector, "data")).mtimeMs, antesDados);
  assert.equal(statSync(producao).mtimeMs, antesProducao);

  const semAuth = spawnSync(exe, ["--init-real", path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924", "x64", "PGWebLib.dll")], {
    encoding: "utf8",
  });
  assert.equal(semAuth.status, 0, semAuth.stdout + semAuth.stderr);
  assert.equal(mapa(semAuth.stdout).get("resultado").at(-1), "INIT_DESABILITADO");
  assert.equal(mapa(semAuth.stdout).get("dllCarregada").at(-1), "0");
  assert.equal(mapa(semAuth.stdout).get("initChamado").at(-1), "0");
});
