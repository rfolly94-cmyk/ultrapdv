import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { MOTOR_PADRAO, PGWEB2_PRODUCAO, horarioIdle } from "./tef-pgweb.mjs";
import { criarBibliotecaMotor, criarPonteNativa } from "./tef-pgweb-ponte.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("o único motor é pgweb e a ponte Pascal não inicia processo", async () => {
  assert.equal(PGWEB2_PRODUCAO, false);
  assert.equal(MOTOR_PADRAO, "pgweb");
  assert.equal(horarioIdle("30"), null);
  assert.ok(horarioIdle("991231235959") instanceof Date);
  await assert.rejects(async () => criarPonteNativa(), /Pascal foi removido/);
  await assert.rejects(
    () => criarBibliotecaMotor({ ensaio: true, motor: "pgweb", modo: "nativo", executavel: "UltraPDVTef.exe" }),
    /Pascal foi removido/
  );
  await assert.rejects(() => criarBibliotecaMotor({ producao: true, ensaio: true, motor: "pgweb" }), /produção permanece bloqueada/);
  await assert.rejects(() => criarBibliotecaMotor({ motor: "acbr-1.3", ensaio: true }), /único motor TEF é pgweb/);
  await assert.rejects(() => criarBibliotecaMotor({ motor: "pgweb" }), /produção permanece bloqueada/);
  const servidor = await readFile(resolve(raiz, "print-agent/src/server.mjs"), "utf8");
  assert.equal(servidor.includes("pgweb-2"), false);
  assert.equal(servidor.includes("tef-pgweb-ponte"), false);
  await assert.rejects(access(resolve(raiz, "tef-agent/UltraPDVTef.lpr")));
  await assert.rejects(access(resolve(raiz, "tef-2/agente/UltraPDVPgWeb.lpr")));
  await assert.rejects(access(resolve(raiz, "tef-2/agente/PgWebLib.pas")));
});

test("o ensaio continua no simulador e não fala com executável", async () => {
  const simulada = await criarBibliotecaMotor({ ensaio: true, motor: "pgweb", roteiro: "aprovada" });
  assert.equal(simulada.real, false);
  assert.equal(simulada.nativa, undefined);
});
