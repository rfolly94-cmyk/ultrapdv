import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditarInstaladorNsi,
  resolverGrafo,
  verificarImportsEmpacotados,
} from "../installer/empacotar-app.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(raiz, "src");
const nsi = path.join(raiz, "installer", "ultrapdv-connector.nsi");

test("o grafo do instalador inclui os modulos TEF e deixa os testes de fora", () => {
  const arquivos = resolverGrafo(src);
  for (const nome of [
    "server.mjs",
    "tef-csharp-ponte.mjs",
    "tef-pendencias-ambiente.mjs",
    "tef-motor-caminho.mjs",
    "pagina-status.html",
    "stop.mjs",
    "verify.mjs",
  ]) {
    assert.equal(arquivos.includes(nome), true, nome);
  }
  for (const antigo of ["tef.mjs", "tef-pasta.mjs", "tef-preparar-pasta.mjs", "tef-venda-nativa.mjs"]) {
    assert.equal(arquivos.includes(antigo), false, antigo);
  }
  assert.equal(arquivos.some((nome) => nome.endsWith(".test.mjs")), false);
});

test("imports resolvem a partir de uma copia empacotada", async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-app-"));
  try {
    for (const nome of resolverGrafo(src)) {
      await fs.copyFile(path.join(src, nome), path.join(pasta, nome));
    }
    verificarImportsEmpacotados(pasta);
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
});

test("pacote sem tef-csharp-ponte.mjs falha na verificacao", async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-app-"));
  try {
    for (const nome of resolverGrafo(src)) {
      if (nome === "tef-csharp-ponte.mjs") {
        continue;
      }
      await fs.copyFile(path.join(src, nome), path.join(pasta, nome));
    }
    assert.throws(
      () => verificarImportsEmpacotados(pasta),
      /tef-csharp-ponte\.mjs/
    );
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
});

test("a atualizacao NSIS preserva ProgramData e o executavel PayGo novo", async () => {
  const texto = await fs.readFile(nsi, "utf8");
  auditarInstaladorNsi(texto);
  const instalacao = texto.split(/Section "Uninstall"/)[0];
  assert.match(instalacao, /CreateDirectory "\$1\\UltraPDV"/);
  assert.doesNotMatch(instalacao, /tef-preparar-pasta\.mjs/);
  assert.doesNotMatch(instalacao, /icacls "\$1\\UltraPDV".*\/T/);
  assert.match(instalacao, /BackupConnectorAnterior/);
  assert.match(texto, /tef-biblioteca\.json/);
  assert.doesNotMatch(instalacao, /RMDir/);
  assert.doesNotMatch(texto, /RMDir\s+\/r\s+"\$INSTDIR"/);
});
