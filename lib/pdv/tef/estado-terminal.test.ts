import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { decidirSituacaoTerminalComputador, type TerminalTefAtivo } from "./estado-terminal";

const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DISPOSITIVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function terminal(parcial: Partial<TerminalTefAtivo> = {}): TerminalTefAtivo {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    codigo: "001",
    dispositivoId: DISPOSITIVO,
    estabelecimento: "SMARTCELL",
    pontoCaptura: "001",
    temPendencia: false,
    ...parcial,
  };
}

test("computador já autorizado nesta empresa não pede novo pareamento", () => {
  assert.equal(
    decidirSituacaoTerminalComputador({
      dispositivoId: DISPOSITIVO,
      empresaSessaoId: EMPRESA_A,
      vinculoLocalEmpresaId: EMPRESA_A,
      terminalDestaEmpresa: terminal(),
      dispositivoDeOutraEmpresa: false,
    }),
    "vinculado"
  );
});

test("terminal de outra empresa não libera dados nem novo pareamento", () => {
  assert.equal(
    decidirSituacaoTerminalComputador({
      dispositivoId: DISPOSITIVO,
      empresaSessaoId: EMPRESA_A,
      vinculoLocalEmpresaId: EMPRESA_B,
      terminalDestaEmpresa: null,
      dispositivoDeOutraEmpresa: true,
    }),
    "outra_empresa"
  );
  assert.equal(
    decidirSituacaoTerminalComputador({
      dispositivoId: DISPOSITIVO,
      empresaSessaoId: EMPRESA_A,
      vinculoLocalEmpresaId: null,
      terminalDestaEmpresa: null,
      dispositivoDeOutraEmpresa: true,
    }),
    "outra_empresa"
  );
});

test("computador sem terminal desta empresa pode parear", () => {
  assert.equal(
    decidirSituacaoTerminalComputador({
      dispositivoId: DISPOSITIVO,
      empresaSessaoId: EMPRESA_A,
      vinculoLocalEmpresaId: null,
      terminalDestaEmpresa: null,
      dispositivoDeOutraEmpresa: false,
    }),
    "parear"
  );
  assert.equal(
    decidirSituacaoTerminalComputador({
      dispositivoId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      empresaSessaoId: EMPRESA_A,
      vinculoLocalEmpresaId: null,
      terminalDestaEmpresa: null,
      dispositivoDeOutraEmpresa: false,
    }),
    "parear"
  );
});

test("a checagem de outra empresa não seleciona dados do estabelecimento", () => {
  const fonte = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "persistencia.ts"),
    "utf8"
  );
  const inicio = fonte.indexOf("export async function dispositivoAtivoDeOutraEmpresa");
  const fim = fonte.indexOf("export async function salvarConfigTefEmpresa");
  const trecho = fonte.slice(inicio, fim);
  assert.ok(inicio > 0);
  assert.match(trecho, /select\("empresa_id"\)/);
  assert.doesNotMatch(trecho, /estabelecimento|ponto_captura|chave_publica/);
});
