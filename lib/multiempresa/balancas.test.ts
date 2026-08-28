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
import {
  criarVinculoProdutoConfiguracao,
  inserirVinculoConfiguracaoProduto,
  produtosDaConfiguracao,
} from "@/lib/balancas/vinculo";

const MIGRACAO = "supabase/migrations/20260827200000_balancas.sql";

test("balanças: RLS, PLU único por empresa, vínculo por configuração e FK composta", () => {
  const sql = fonte(MIGRACAO);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.balancas_configuracoes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.produtos_balancas/);
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS public\.balancas_configuracoes_produtos/
  );
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(
    sql,
    /FOREIGN KEY \(empresa_id, produto_id\)\s+REFERENCES public\.produtos\(empresa_id, id\)/
  );
  assert.match(
    sql,
    /FOREIGN KEY \(empresa_id, balanca_configuracao_id\)\s+REFERENCES public\.balancas_configuracoes\(empresa_id, id\)/
  );
  assert.match(sql, /UNIQUE \(empresa_id, produto_id\)/);
  assert.match(sql, /UNIQUE \(balanca_configuracao_id, produto_id\)/);
  assert.match(sql, /ux_produtos_balancas_empresa_plu/);
  assert.match(sql, /ON public\.produtos_balancas \(empresa_id, plu\)/);
  assert.match(sql, /validade_etiqueta_dias integer/);
  assert.match(sql, /Não altera estoque_lotes/);
  const dadosGerais = sql.slice(
    sql.indexOf("CREATE TABLE IF NOT EXISTS public.produtos_balancas"),
    sql.indexOf("CREATE TABLE IF NOT EXISTS public.balancas_configuracoes_produtos")
  );
  assert.doesNotMatch(dadosGerais, /enviar_balanca/);
  assert.match(
    sql,
    /balancas_configuracoes_produtos[\s\S]*enviar_balanca boolean NOT NULL DEFAULT true/
  );
  assert.doesNotMatch(sql, /ALTER TABLE public\.produtos\s/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.estoque_lotes/);
  assert.doesNotMatch(sql, /supabase db reset/);
});

test("configuração de balança: A lê A e não lê B", () => {
  const configs = [
    { id: "cfg-a", empresa_id: empresaA, nome: "Toledo A" },
    { id: "cfg-b", empresa_id: empresaB, nome: "Toledo B" },
  ];

  assert.equal(
    buscarPorIdComRls(configs, usuarioA, vinculosPadrao, "cfg-a")?.nome,
    "Toledo A"
  );
  assert.equal(
    buscarPorIdComRls(configs, usuarioA, vinculosPadrao, "cfg-b"),
    null
  );
  assert.equal(
    buscarPorIdComRls(configs, usuarioB, vinculosPadrao, "cfg-a"),
    null
  );
  assert.equal(
    buscarDaEmpresaAtiva(configs, empresaA, "cfg-b"),
    null
  );
});

test("mesmo PLU pode existir em empresas diferentes e não duplica na mesma", () => {
  const vinculos: Array<{
    empresa_id: string;
    produto_id: string;
    plu: string;
  }> = [];

  inserirUnicoPorEmpresa(
    vinculos,
    { empresa_id: empresaA, produto_id: produtoA, plu: "1234" },
    (item) => item.plu
  );
  inserirUnicoPorEmpresa(
    vinculos,
    { empresa_id: empresaB, produto_id: produtoB, plu: "1234" },
    (item) => item.plu
  );
  assert.equal(vinculos.length, 2);
  assert.throws(
    () =>
      inserirUnicoPorEmpresa(
        vinculos,
        { empresa_id: empresaA, produto_id: "p-outro", plu: "1234" },
        (item) => item.plu
      ),
    /unique_violation/
  );
});

test("actions de balança resolvem empresa da sessão e não aceitam empresa_id do cliente", () => {
  const actions = fonte("app/configuracoes/balancas/actions.ts");
  assert.match(actions, /principal", true/);
  assert.match(actions, /ativo", true/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.match(actions, /atribuirPluComRetry/);
  assert.doesNotMatch(actions, /formData\.get\("empresa_id"\)/);
  assert.match(actions, /carregarConfiguracaoDaEmpresa/);
  assert.match(actions, /produtoElegivelBalanca/);
  assert.match(actions, /from\("balancas_configuracoes_produtos"\)/);
  assert.match(actions, /definirVinculoProdutoBalanca/);
  assert.match(actions, /vinculoMesmaEmpresa/);
  assert.match(actions, /resumoExportacao/);
  assert.match(actions, /lerSelecaoModeloDoFormulario/);
  assert.match(actions, /precisaGerarPluVinculo/);
  assert.match(actions, /departamento_padrao/);
  assert.doesNotMatch(actions, /formData\.get\("layout"\)/);
  assert.match(
    fonte("lib/balancas/plu.ts"),
    /listarPlusDaEmpresa/
  );
});

test("uma empresa pode ter várias configurações e o produto vincula só na escolhida", () => {
  const configs = [
    { id: "cfg-acougue", empresa_id: empresaA, nome: "Toledo Açougue" },
    { id: "cfg-padaria", empresa_id: empresaA, nome: "Toledo Padaria" },
  ];
  assert.equal(
    configs.filter((item) => item.empresa_id === empresaA).length,
    2
  );

  const vinculos = [
    criarVinculoProdutoConfiguracao({
      empresaIdSessao: empresaA,
      empresaIdConfig: empresaA,
      empresaIdProduto: empresaA,
      configuracaoId: "cfg-acougue",
      produtoId: produtoA,
    }),
  ];
  const produtos = [
    { produtoId: produtoA, empresaId: empresaA },
    { produtoId: produtoB, empresaId: empresaA },
  ];

  assert.equal(
    produtosDaConfiguracao(produtos, vinculos, "cfg-acougue", empresaA).length,
    1
  );
  assert.equal(
    produtosDaConfiguracao(produtos, vinculos, "cfg-padaria", empresaA).length,
    0
  );
  assert.throws(
    () =>
      inserirVinculoConfiguracaoProduto(
        vinculos,
        criarVinculoProdutoConfiguracao({
          empresaIdSessao: empresaA,
          empresaIdConfig: empresaA,
          empresaIdProduto: empresaA,
          configuracaoId: "cfg-acougue",
          produtoId: produtoA,
        })
      ),
    /unique_violation/
  );
  assert.throws(
    () =>
      criarVinculoProdutoConfiguracao({
        empresaIdSessao: empresaA,
        empresaIdConfig: empresaB,
        empresaIdProduto: empresaA,
        configuracaoId: "cfg-b",
        produtoId: produtoA,
      }),
    /empresa_mismatch/
  );
});
