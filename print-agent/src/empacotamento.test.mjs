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
    "tef.mjs",
    "tef-pendencia.mjs",
    "tef-vinculo.mjs",
    "tef-prova.mjs",
    "tef-pareamento.mjs",
    "tef-recuperacao.mjs",
    "pagina-status.html",
    "stop.mjs",
    "verify.mjs",
  ]) {
    assert.equal(arquivos.includes(nome), true, nome);
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

test("pacote sem tef-prova.mjs falha na verificacao", async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-app-"));
  try {
    for (const nome of resolverGrafo(src)) {
      if (nome === "tef-prova.mjs") {
        continue;
      }
      await fs.copyFile(path.join(src, nome), path.join(pasta, nome));
    }
    assert.throws(
      () => verificarImportsEmpacotados(pasta),
      /tef-prova\.mjs/
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
  assert.doesNotMatch(instalacao, /RMDir/);
});
