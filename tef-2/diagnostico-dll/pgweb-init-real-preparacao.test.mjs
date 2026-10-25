import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "../..");
const fonte = path.join(aqui, "PgWebDiagnostico.lpr");
const dllKit = path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924", "x64", "PGWebLib.dll");
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

function executar(args, envExtra = {}) {
  return spawnSync(exe, args, { encoding: "utf8", env: { ...process.env, ...envExtra } });
}

test("o procedimento real fica protegido e o backup nao leva credenciais", () => {
  const compilou = spawnSync(
    fpc,
    ["-Px86_64", "-FU" + path.join(aqui, "bin", "realprep"), "-FE" + path.join(aqui, "bin"), fonte],
    { encoding: "utf8" },
  );
  assert.equal(compilou.status, 0, compilou.stdout + compilou.stderr);
  const fonteTexto = readFileSync(fonte, "utf8");
  const procedimento = fonteTexto.slice(
    fonteTexto.indexOf("procedure EnsaiarReal"),
    fonteTexto.indexOf("procedure Uso"),
  );
  assert.equal(procedimento.includes("LoadLibraryA"), true);
  assert.equal(procedimento.indexOf("VIGILANCIA_INCOMPLETA") < procedimento.indexOf("LoadLibraryA"), true);
  assert.equal(procedimento.indexOf("MonitorCompleto") < procedimento.indexOf("LoadLibraryA"), true);
  assert.equal(procedimento.indexOf("isolamentoGarantido") < procedimento.indexOf("LoadLibraryA"), true);
  assert.equal(procedimento.indexOf("IsolamentoExclusivoAtual") < procedimento.indexOf("LoadLibraryA"), true);
  assert.equal(procedimento.indexOf("interrompido") < procedimento.indexOf("Halt(SAIDA_MONITOR)"), true);
  assert.equal(procedimento.includes("redeEvento"), false);
  assert.equal(fonteTexto.includes("redeEvento"), true);
  assert.equal(procedimento.includes("PW_iSetEnvironment"), false);
  assert.equal(procedimento.includes("PW_iNewTransac"), false);
  assert.equal(procedimento.includes("PW_iExecTransac"), false);
  assert.equal(procedimento.includes("PW_iPP"), false);
  const agente = readFileSync(path.join(raiz, "tef-2", "agente", "PgWebLib.pas"), "utf8");
  assert.match(agente, /ABI_COMPROVADO = False/);
  assert.match(agente, /LAYOUT_HOMOLOGADO = False/);
  assert.match(fonteTexto, /INIT_PERMITIDO = False/);

  const antesConector = statSync(path.join(conector, "version.json")).mtimeMs;
  const antesDados = statSync(path.join(conector, "data")).mtimeMs;
  const antesProducao = statSync(producao).mtimeMs;

  const backup = executar(["--backup"]);
  assert.equal(backup.status, 0, backup.stdout + backup.stderr);
  const backupMapa = mapa(backup.stdout);
  assert.equal(backupMapa.get("resultado").at(-1), "BACKUP_OK");
  assert.equal(backupMapa.get("conectorVersao")[0], "1.3.19");
  assert.equal(backupMapa.get("backupVerificado")[0], "1");
  assert.equal(backupMapa.get("credencialCopiada")[0], "0");
  assert.equal(backupMapa.get("isolamentoGarantido")[0], "0");
  assert.equal(backupMapa.get("initChamado").at(-1), "0");
  assert.equal(backup.stdout.includes("privada"), false);
  assert.equal(backup.stdout.includes("codigoHash"), false);
  const pasta = backupMapa.get("backup")[0];
  assert.equal(existsSync(path.join(pasta, "tef-chave.json")), false);
  assert.equal(existsSync(path.join(pasta, "tef-pareamento.json")), false);
  assert.equal(existsSync(path.join(pasta, "version.json")), true);
  const manifesto = readFileSync(path.join(pasta, "manifesto.txt"), "utf8");
  assert.match(manifesto, /^omitido tef-chave\.json [0-9a-f]{64}$/m);
  assert.match(manifesto, /^conectorVersao 1\.3\.19$/m);
  const copia = readFileSync(path.join(pasta, "version.json"));
  const digest = createHash("sha256").update(copia).digest("hex");
  assert.match(manifesto, new RegExp(`^copiado version\\.json ${digest}$`, "m"));
  assert.equal(readdirSync(pasta).some((nome) => nome.endsWith(".pos")), false);

  const vigia = executar(["--vigiar"]);
  assert.equal(vigia.status, 0, vigia.stdout + vigia.stderr);
  const vigiaMapa = mapa(vigia.stdout);
  assert.equal(vigiaMapa.get("resultado").at(-1), "VIGILANCIA_OBSERVADA");
  assert.equal(vigiaMapa.get("isolamentoGarantido")[0], "0");
  assert.equal(vigiaMapa.get("dllCarregada").at(-1), "0");

  const incompleta = executar(["--vigiar"], { PGWEB_VIGIA_FALHA: "1" });
  assert.equal(incompleta.status, 8, incompleta.stdout);
  assert.match(incompleta.stdout, /VIGILANCIA_INCOMPLETA/);
  assert.match(incompleta.stdout, /isolamentoGarantido 0/);

  const semAuth = executar(["--init-real", dllKit]);
  assert.equal(semAuth.status, 0, semAuth.stdout + semAuth.stderr);
  const semAuthMapa = mapa(semAuth.stdout);
  assert.equal(semAuthMapa.get("resultado").at(-1), "INIT_DESABILITADO");
  assert.equal(semAuthMapa.get("dllCarregada").at(-1), "0");
  assert.equal(semAuthMapa.get("dllReal").at(-1), "0");
  assert.equal(semAuthMapa.get("initChamado").at(-1), "0");
  const comando = semAuthMapa.get("comando").at(-1);
  assert.match(comando, /\$env:PGWEB_INIT_REAL='AUTORIZAR-PW-IINIT-REAL-4\.1\.50\.924'/);
  assert.match(comando, /PgWebDiagnostico\.exe' --init-real '.*\\20260923-Integracao-PGWebLib_v4\.1\.50\.924\\x64\\PGWebLib\.dll' --autorizado-real/);
  assert.equal(comando.includes(dllKit) || comando.toLowerCase().includes(dllKit.toLowerCase()), true);

  const authSimulada = executar(["--init-real", dllKit, "--autorizado"], {
    PGWEB_INIT_AUTORIZACAO: "AUTORIZAR-PW-IINIT-4.1.50.924",
  });
  assert.equal(authSimulada.status, 0, authSimulada.stdout + authSimulada.stderr);
  assert.equal(mapa(authSimulada.stdout).get("resultado").at(-1), "INIT_DESABILITADO");
  assert.equal(mapa(authSimulada.stdout).get("dllReal").at(-1), "0");

  assert.equal(statSync(path.join(conector, "version.json")).mtimeMs, antesConector);
  assert.equal(statSync(path.join(conector, "data")).mtimeMs, antesDados);
  assert.equal(statSync(producao).mtimeMs, antesProducao);
});
