import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolverRaizAgente } from "./raiz.mjs";
import { carregarVersao } from "./versao.mjs";

const raizPacote = resolverRaizAgente();
const versao = carregarVersao(raizPacote).version;

function ler(relativo) {
  return readFileSync(path.join(raizPacote, relativo), "utf8");
}

test("a versão 1.3.47 distribui a PGWebLib x64, o motor C# e não distribui o agente Pascal", () => {
  assert.equal(versao, "1.3.47");
  const pacote = JSON.parse(ler("tef-pacote.json"));
  const manifesto = JSON.parse(ler("version.json"));
  assert.equal(pacote.executavel, undefined);
  assert.equal(pacote.motor, "bin/tef/motor/UltraPDV.TEF.Host.exe");
  assert.equal(pacote.dll, "bin/tef/PGWebLib.dll");
  assert.equal(pacote.dllVersao, "4.1.50.924");
  assert.equal(manifesto.agenteTef, "");
  assert.equal(pacote.pontoProducao, "6696546");
  assert.equal(pacote.terminalLogico, "117473");
  const build = ler("installer/build.ps1");
  assert.doesNotMatch(build, /UltraPDVTef_/);
  assert.doesNotMatch(build, /lazbuild/);
  assert.match(build, /PGWebLib\.dll/);
  assert.match(build, /UltraPDV\.TEF\.Host\.exe/);
  const hashDe = (relativo) =>
    createHash("sha256").update(readFileSync(path.join(raizPacote, relativo))).digest("hex").toUpperCase();
  for (const legado of [
    "bin/tef/UltraPDVTef.exe",
    "bin/tef/UltraPDVTef_1313.exe",
    "bin/tef/UltraPDVTef_1316.exe",
    "bin/tef/UltraPDVTef_137.exe",
    "bin/tef/UltraPDVTef_138.exe",
    "bin/tef/UltraPDVTef_139.exe",
    "bin/tef/UltraPDVTef_NOVO.exe",
  ]) {
    assert.equal(existsSync(path.join(raizPacote, legado)), false, legado);
  }
  assert.equal(
    hashDe("bin/tef/PGWebLib.dll"),
    "D17AC81323396AE172648935B0B797B74705B1CA01C9AE0CD3B2FF78119D4220"
  );
  const nsi = ler("installer/ultrapdv-connector.nsi");
  assert.equal(nsi.includes("UltraPDV-TEF"), false);
  assert.match(nsi, /PGWebLib\.dll/);
  assert.equal(nsi.includes("tef-preparar-pasta.mjs"), false);
  assert.equal(nsi.includes("certificado.crt"), false);
  assert.doesNotMatch(nsi, /Delete\s+"[^"]*tef-pasta\.json"/);
  const servidor = ler("src/server.mjs");
  assert.match(servidor, /\/tef\/csharp/);
  assert.doesNotMatch(servidor, /GerenciadorPgWeb/);
  assert.doesNotMatch(servidor, /pathname === "\/tef\/venda"/);
  assert.doesNotMatch(servidor, /pathname === "\/tef\/pagamento"/);
});

test("o rodapé usa a versão recebida e não consulta a prova do motor antigo", () => {
  const pagina = ler("src/pagina-status.html");
  assert.match(pagina, /id="rodapeConector"/);
  assert.match(pagina, /data\.version \|\| data\.versao/);
  assert.match(pagina, /id="agenteTef"/);
  assert.doesNotMatch(pagina, /1\.3\.\d+/);
  const servidor = ler("src/server.mjs");
  assert.match(servidor, /pathname === "\/tef\/csharp"/);
  assert.doesNotMatch(servidor, /pathname === "\/tef\/biblioteca\/evidencia"/);
  assert.doesNotMatch(servidor, /tef-chave\.json/);
});

test("o instalador acrescenta o agente novo, guarda backup e não apaga PayGo nem executáveis anteriores", () => {
  const nsi = ler("installer/ultrapdv-connector.nsi");
  const instalacao = nsi.split(/Section "Uninstall"/)[0];
  assert.match(instalacao, /Call StopConnector/);
  assert.match(instalacao, /Call BackupConnectorAnterior/);
  assert.doesNotMatch(instalacao, /TEF_EXE_NAME/);
  assert.match(instalacao, /File "\$\{STAGING_DIR\}\\bin\\tef\\PGWebLib\.dll"/);
  assert.equal(
    instalacao.match(/File "\$\{STAGING_DIR\}\\bin\\tef\\/g)?.length ?? 0,
    1
  );
  assert.doesNotMatch(nsi, /UltraPDVTef_\d+\.exe/);
  assert.doesNotMatch(nsi, /Rename[\s\S]*UltraPDVTef/);
  assert.match(instalacao, /Call RestaurarConnectorAnterior/);
  assert.match(nsi, /version\.json/);
  assert.match(nsi, /tef-biblioteca\.json/);
  assert.doesNotMatch(instalacao, /Delete[\s\S]*UltraPDVTef/);
  assert.doesNotMatch(nsi, /RMDir\s+\/r\s+"\$INSTDIR"/);
  assert.match(nsi, /RMDir "\$INSTDIR\\bin\\tef"/);
  assert.match(nsi, /icacls "\$INSTDIR\\bin\\tef\\producao"/);
  assert.match(nsi, /icacls "\$INSTDIR\\bin\\tef\\TEF"/);
  assert.doesNotMatch(instalacao, /Delete[\s\S]*producao/);
  const pacote = JSON.parse(ler("tef-pacote.json"));
  assert.equal(pacote.diretorioProducao, "C:/ProgramData/UltraPDV/TEF/Producao/PGWeb");
  assert.ok(pacote.preservar.includes("%PROGRAMDATA%\\UltraPDV\\TEF\\Producao"));
  assert.ok(pacote.preservar.includes("%PROGRAMDATA%\\UltraPDV\\tef-biblioteca.json"));
  assert.ok(pacote.preservar.includes("%PROGRAMDATA%\\UltraPDV\\tef-pendencia.json"));
});
