import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { candidatosExecutavelMotor, resolverExecutavelMotor } from "./tef-motor-caminho.mjs";

test("o motor instalado com o Connector tem prioridade sobre o repositório", () => {
  const candidatos = candidatosExecutavelMotor({
    instalado: "C:\\Program Files\\UltraPDV Connector\\bin\\tef\\motor\\UltraPDV.TEF.Host.exe",
    ambiente: "C:\\temp\\host-ambiente.exe",
    repositorio: "C:\\ultrapdv\\UltraPDV.TEF\\src\\UltraPDV.TEF.Host\\bin\\Release\\net8.0\\UltraPDV.TEF.Host.exe",
  });
  const escolhido = resolverExecutavelMotor(candidatos, (arquivo) => arquivo.includes("Program Files") || arquivo.includes("ultrapdv"));
  assert.match(escolhido, /Program Files/);
  const semInstalado = resolverExecutavelMotor(candidatos, (arquivo) => arquivo.includes("ultrapdv"));
  assert.match(semInstalado, /UltraPDV\.TEF\.Host\.exe$/);
  assert.equal(resolverExecutavelMotor(candidatos, () => false), null);
  const versao = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8"));
  const pacote = JSON.parse(readFileSync(new URL("../tef-pacote.json", import.meta.url), "utf8"));
  const nsi = readFileSync(new URL("../installer/ultrapdv-connector.nsi", import.meta.url), "utf8");
  assert.equal(versao.version, "1.3.47");
  assert.equal(pacote.motor, "bin/tef/motor/UltraPDV.TEF.Host.exe");
  assert.equal(pacote.executavel, undefined);
  assert.match(nsi, /bin\\tef\\motor/);
  assert.match(readFileSync(new URL("../installer/build.ps1", import.meta.url), "utf8"), /UltraPDV\.TEF\.Host\.csproj/);
});
