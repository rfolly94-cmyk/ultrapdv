import assert from "node:assert/strict";
import { test } from "node:test";

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
import { buscarDaEmpresaAtiva } from "./app-layer";
import { buscarPorIdComRls, inserirUnicoPorEmpresa } from "./rls-memoria";

const MIGRACAO =
  "supabase/migrations/20260827120000_produtos_validade_lotes.sql";

test("estoque_lotes: RLS e FK composta isolam empresas", () => {
  const sql = fonte(MIGRACAO);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(
    sql,
    /FOREIGN KEY \(empresa_id, produto_id\)\s+REFERENCES public\.produtos\(empresa_id, id\)/
  );
  assert.match(sql, /UNIQUE \(empresa_id, produto_id, codigo_lote\)/);
  assert.match(sql, /ix_estoque_lotes_fefo/);
  assert.match(sql, /eh_contador_da_empresa/);
  assert.doesNotMatch(sql, /supabase db reset/);
});

test("estoque_lotes: A lê A e não lê B", () => {
  const lotes = [
    {
      id: "lote-a",
      empresa_id: empresaA,
      produto_id: produtoA,
      codigo_lote: "L1",
    },
    {
      id: "lote-b",
      empresa_id: empresaB,
      produto_id: produtoB,
      codigo_lote: "L1",
    },
  ];

  assert.equal(
    buscarPorIdComRls(lotes, usuarioA, vinculosPadrao, "lote-a")?.codigo_lote,
    "L1"
  );
  assert.equal(
    buscarPorIdComRls(lotes, usuarioA, vinculosPadrao, "lote-b"),
    null
  );
  assert.equal(
    buscarPorIdComRls(lotes, usuarioB, vinculosPadrao, "lote-a"),
    null
  );
});

test("estoque_lotes: mesmo código de lote pode existir em empresas diferentes", () => {
  const lotes: Array<{
    empresa_id: string;
    produto_id: string;
    codigo_lote: string;
  }> = [];
  inserirUnicoPorEmpresa(
    lotes,
    { empresa_id: empresaA, produto_id: produtoA, codigo_lote: "L1" },
    (lote) => `${lote.produto_id}:${lote.codigo_lote}`
  );
  inserirUnicoPorEmpresa(
    lotes,
    { empresa_id: empresaB, produto_id: produtoB, codigo_lote: "L1" },
    (lote) => `${lote.produto_id}:${lote.codigo_lote}`
  );
  assert.equal(lotes.length, 2);
  assert.throws(
    () =>
      inserirUnicoPorEmpresa(
        lotes,
        { empresa_id: empresaA, produto_id: produtoA, codigo_lote: "L1" },
        (lote) => `${lote.produto_id}:${lote.codigo_lote}`
      ),
    /unique_violation/
  );
});

test("actions de lote não aceitam empresa_id do cliente e recusam produto cruzado", () => {
  const actions = fonte("app/produtos/actions.ts");
  const lote = actions.slice(
    actions.indexOf("async function carregarEstoqueAtualProduto"),
    actions.indexOf("export async function atualizarPublicacaoCatalogo")
  );
  assert.match(lote, /getContexto\(\)/);
  assert.match(lote, /\.eq\("empresa_id", empresaId\)/);
  assert.match(lote, /\.eq\("produto_id", produtoId\)/);
  assert.match(lote, /Produto não encontrado nesta empresa/);
  assert.match(lote, /validarQuantidadeContraEstoque/);
  assert.doesNotMatch(lote, /input\.empresaId|formData\.get\("empresa_id"\)/);
  assert.equal(
    buscarDaEmpresaAtiva(
      [{ id: produtoB, empresa_id: empresaB }],
      empresaA,
      produtoB
    ),
    null
  );
});

test("ativar ou desativar validade não apaga lotes nem altera estoque_atual", () => {
  const actions = fonte("app/produtos/actions.ts");
  const controle = actions.slice(
    actions.indexOf("export async function salvarControleValidadeProduto"),
    actions.indexOf("export async function salvarLoteProduto")
  );
  assert.match(controle, /controlar_validade: controlar === true/);
  assert.doesNotMatch(controle, /estoque_lotes/);
  assert.doesNotMatch(controle, /estoque_atual/);
});
