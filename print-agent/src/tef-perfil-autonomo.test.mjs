import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { garantirPerfilAutonomo } from "./tef-perfil-autonomo.mjs";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const DISPOSITIVO = "33333333-3333-4333-8333-333333333333";

test("o perfil novo nasce vazio, é reutilizado e não copia a pasta antiga", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-perfil-"));
  const env = { PROGRAMDATA: raiz };
  const arquivo = path.join(raiz, "UltraPDV", "tef-perfil-autonomo.json");
  const antigo = path.join(raiz, "UltraPDV-TEF", "Producao", "PGWeb", "Data");
  await fs.mkdir(antigo, { recursive: true });
  await fs.writeFile(path.join(antigo, "certificado.crt"), "antigo");
  await fs.writeFile(path.join(antigo, "TSTKEY.ini"), "antigo");
  try {
    const primeiro = await garantirPerfilAutonomo({
      empresaId: EMPRESA,
      dispositivoId: DISPOSITIVO,
      env,
      arquivo,
    });
    assert.equal(primeiro.ok, true);
    assert.equal(primeiro.publico.reutilizado, false);
    assert.match(primeiro.pai, /\\TEF\\Producao\\perfis\\[0-9a-f-]{36}$/i);
    const segundo = await garantirPerfilAutonomo({
      empresaId: EMPRESA,
      dispositivoId: DISPOSITIVO,
      env,
      arquivo,
    });
    assert.equal(segundo.ok, true);
    assert.equal(segundo.publico.reutilizado, true);
    assert.equal(segundo.pai, primeiro.pai);
    const outraEmpresa = await garantirPerfilAutonomo({
      empresaId: "22222222-2222-4222-8222-222222222222",
      dispositivoId: DISPOSITIVO,
      env,
      arquivo,
    });
    assert.equal(outraEmpresa.ok, true);
    assert.notEqual(outraEmpresa.pai, primeiro.pai);
    const nomes = await fs.readdir(path.join(raiz, "UltraPDV", "TEF", "Producao", "perfis"));
    assert.equal(nomes.length, 2);
    assert.equal(await fs.readFile(path.join(antigo, "certificado.crt"), "utf8"), "antigo");
  } finally {
    await fs.rm(raiz, { recursive: true, force: true });
  }
});

test("dados preexistentes bloqueiam outro perfil até o provisionamento explícito", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-perfil-ocupado-"));
  const env = { PROGRAMDATA: raiz };
  const arquivo = path.join(raiz, "UltraPDV", "tef-perfil-autonomo.json");
  try {
    const primeiro = await garantirPerfilAutonomo({
      empresaId: EMPRESA,
      dispositivoId: DISPOSITIVO,
      env,
      arquivo,
    });
    await fs.mkdir(path.join(primeiro.efetivo, "Data"), { recursive: true });
    await fs.writeFile(path.join(primeiro.efetivo, "Data", "certificado.crt"), "novo");
    await fs.writeFile(path.join(primeiro.efetivo, "Data", "file50.pos"), "pos");
    const bloqueado = await garantirPerfilAutonomo({
      empresaId: EMPRESA,
      dispositivoId: DISPOSITIVO,
      env,
      arquivo,
    });
    assert.equal(bloqueado.ok, false);
    assert.equal(bloqueado.codigo, "PERFIL_OCUPADO");
    const explicito = await garantirPerfilAutonomo({
      empresaId: EMPRESA,
      dispositivoId: DISPOSITIVO,
      env,
      arquivo,
      explicito: true,
    });
    assert.equal(explicito.ok, true);
    assert.notEqual(explicito.pai, primeiro.pai);
    assert.equal(await fs.readFile(path.join(primeiro.efetivo, "Data", "file50.pos"), "utf8"), "pos");
    const registro = JSON.parse(await fs.readFile(arquivo, "utf8"));
    const anterior = registro.perfis.find((perfil) => perfil.id === primeiro.publico.id);
    assert.equal(anterior.estado, "bloqueado");
    assert.equal(anterior.motivo, "dados preexistentes");
    const repetido = await garantirPerfilAutonomo({
      empresaId: EMPRESA,
      dispositivoId: DISPOSITIVO,
      env,
      arquivo,
    });
    assert.equal(repetido.pai, explicito.pai);
  } finally {
    await fs.rm(raiz, { recursive: true, force: true });
  }
});
