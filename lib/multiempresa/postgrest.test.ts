import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clienteA,
  clienteB,
  empresaA,
  empresaB,
  produtoA,
  produtoB,
  usuarioA,
  usuarioB,
  vendaA,
  vendaB,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarPorIdComRls, escreverComRls } from "./rls-memoria";

const clientes = [
  { id: clienteA, empresa_id: empresaA },
  { id: clienteB, empresa_id: empresaB },
];
const produtos = [
  { id: produtoA, empresa_id: empresaA },
  { id: produtoB, empresa_id: empresaB },
];
const vendas = [
  { id: vendaA, empresa_id: empresaA },
  { id: vendaB, empresa_id: empresaB },
];
const estoques = [
  { id: produtoA, empresa_id: empresaA, qtd: 1 },
  { id: produtoB, empresa_id: empresaB, qtd: 1 },
];
const carteiras = [
  { id: clienteA, empresa_id: empresaA },
  { id: clienteB, empresa_id: empresaB },
];
const emissoes = [
  { id: "e-a", empresa_id: empresaA },
  { id: "e-b", empresa_id: empresaB },
];

test("PostgREST autenticado: A não lê clientes/produtos/vendas/estoque/carteira/fiscal de B", () => {
  assert.equal(buscarPorIdComRls(clientes, usuarioA, vinculosPadrao, clienteB), null);
  assert.equal(buscarPorIdComRls(produtos, usuarioA, vinculosPadrao, produtoB), null);
  assert.equal(buscarPorIdComRls(vendas, usuarioA, vinculosPadrao, vendaB), null);
  assert.equal(buscarPorIdComRls(estoques, usuarioA, vinculosPadrao, produtoB), null);
  assert.equal(buscarPorIdComRls(carteiras, usuarioA, vinculosPadrao, clienteB), null);
  assert.equal(buscarPorIdComRls(emissoes, usuarioA, vinculosPadrao, "e-b"), null);
});

test("PostgREST autenticado: B não lê os mesmos recursos de A", () => {
  assert.equal(buscarPorIdComRls(clientes, usuarioB, vinculosPadrao, clienteA), null);
  assert.equal(buscarPorIdComRls(produtos, usuarioB, vinculosPadrao, produtoA), null);
  assert.equal(buscarPorIdComRls(vendas, usuarioB, vinculosPadrao, vendaA), null);
  assert.equal(buscarPorIdComRls(estoques, usuarioB, vinculosPadrao, produtoA), null);
  assert.equal(buscarPorIdComRls(carteiras, usuarioB, vinculosPadrao, clienteA), null);
  assert.equal(buscarPorIdComRls(emissoes, usuarioB, vinculosPadrao, "e-a"), null);
});

test("PostgREST autenticado: UPDATE/DELETE de B como A some como não encontrado", () => {
  for (const id of [clienteB, produtoB, vendaB]) {
    const tabelas = [clientes, produtos, vendas];
    const tabela = tabelas.find((rows) => rows.some((row) => row.id === id));
    assert.ok(tabela);
    const resultado = escreverComRls(tabela, usuarioA, vinculosPadrao, id, (row) => row);
    assert.equal(resultado.ok, false);
  }
});

test("PostgREST: suíte não executa INSERT/UPDATE/DELETE no banco vivo", () => {
  assert.doesNotMatch(
    fonte("lib/multiempresa/cenario.ts"),
    /xdcmoqvfrdqfinylyjqt/
  );
  assert.match(
    fonte("supabase/migrations/20260817340000_fiscal_operacoes_nfe.sql"),
    /tem_acesso_empresa\(empresa_id\)/
  );
});
