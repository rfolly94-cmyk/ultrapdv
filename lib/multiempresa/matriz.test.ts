import assert from "node:assert/strict";
import { test } from "node:test";

import { MATRIZ_ISOLAMENTO } from "./matriz";

test("matriz: cobre os módulos pedidos na FASE 1C", () => {
  const modulos = new Set(MATRIZ_ISOLAMENTO.map((linha) => linha.modulo));
  for (const esperado of [
    "Empresa ativa",
    "Clientes",
    "Produtos",
    "Vendas",
    "Estoque",
    "Carteira",
    "PIX",
    "Fiscal",
    "Catálogo",
    "Usuários/admin",
    "RPCs internas",
    "Cron fiscal",
    "IDOR mensagens",
    "Integridade residual",
  ]) {
    assert.equal(modulos.has(esperado), true, esperado);
  }
});

test("matriz: A→A nunca é bloqueado nas operações de negócio", () => {
  for (const linha of MATRIZ_ISOLAMENTO) {
    if (linha.aParaA === "N/A") continue;
    assert.equal(linha.aParaA, "OK", linha.modulo + " " + linha.operacao);
  }
});

test("matriz: P0 de inflight fiscal foi fechado", () => {
  const inflight = MATRIZ_ISOLAMENTO.find((linha) =>
    /inflight/.test(linha.operacao)
  );
  assert.equal(inflight?.resultado, "PASS");
  assert.equal(inflight?.aParaB, "BLOQUEADO");
  assert.equal(
    MATRIZ_ISOLAMENTO.filter((linha) => linha.resultado === "P0").length,
    0
  );
});

test("matriz: P1 de grupo fiscal foi fechado com FK composta versionada", () => {
  const grupo = MATRIZ_ISOLAMENTO.find((linha) =>
    /produto\.grupo_fiscal_id direto/.test(linha.operacao)
  );
  assert.equal(grupo?.resultado, "PASS");
  assert.equal(grupo?.aParaB, "BLOQUEADO");
  assert.equal(
    MATRIZ_ISOLAMENTO.filter((linha) => linha.resultado === "P1").length,
    0
  );
});
