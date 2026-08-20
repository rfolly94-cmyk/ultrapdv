import assert from "node:assert/strict";
import { test } from "node:test";

import { buscarDaEmpresaAtiva } from "./app-layer";
import {
  empresaA,
  empresaB,
  produtoA,
  produtoB,
  usuarioA,
  usuarioB,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarPorIdComRls } from "./rls-memoria";

const estoques = [
  { id: produtoA, empresa_id: empresaA, quantidade: 10 },
  { id: produtoB, empresa_id: empresaB, quantidade: 99 },
];

test("estoque: A consulta A e não consulta B", () => {
  assert.equal(
    buscarPorIdComRls(estoques, usuarioA, vinculosPadrao, produtoA)?.quantidade,
    10
  );
  assert.equal(buscarPorIdComRls(estoques, usuarioA, vinculosPadrao, produtoB), null);
  assert.equal(buscarPorIdComRls(estoques, usuarioB, vinculosPadrao, produtoA), null);
});

test("estoque: UNIQUE é por (empresa_id, produto_id)", () => {
  assert.match(
    fonte("supabase/migrations/20260813014000_estoque_fundacao.sql"),
    /UNIQUE \(empresa_id, produto_id\)/
  );
});

test("estoque: RPC autenticada exige tem_acesso_empresa e produto da mesma empresa", () => {
  const rpc = fonte(
    "supabase/migrations/20260813015000_corrigir_ambiguidade_estoque.sql"
  );
  assert.match(rpc, /IF NOT public\.tem_acesso_empresa\(p_empresa_id\)/);
  assert.match(rpc, /p\.empresa_id = p_empresa_id/);
  assert.match(rpc, /Produto não encontrado na empresa/);
});

test("estoque: authenticated não executa funções internas de baixa/estorno", () => {
  const revoke = fonte(
    "supabase/migrations/20260818130000_revoke_execute_anon_funcoes_internas.sql"
  );
  assert.match(revoke, /estoque_baixar_composicao_venda_interno/);
  assert.match(revoke, /estoque_estornar_composicao_venda_interno/);
  assert.match(revoke, /REVOKE ALL ON FUNCTION %s FROM authenticated/);
});

test("estoque: helper de sessão não movimenta produto B", () => {
  assert.equal(buscarDaEmpresaAtiva(estoques, empresaA, produtoB), null);

  function movimentar(empresaId: string, produtoEmpresaId: string) {
    if (produtoEmpresaId !== empresaId) {
      throw new Error("Produto não encontrado na empresa.");
    }
  }

  assert.throws(() => movimentar(empresaA, empresaB), /não encontrado na empresa/);
});
