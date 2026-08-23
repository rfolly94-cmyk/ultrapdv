import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";

test("produtos.ativo já existe e não exige migration nova", () => {
  const catalogo = fonte("supabase/migrations/20260816010000_catalogo_online.sql");
  const cadastro = fonte("supabase/migrations/20260815013000_rpc_cadastrar_produto.sql");
  assert.match(catalogo, /ON public.produtos \(empresa_id, catalogo_publicado, ativo\)/);
  assert.match(catalogo, /AND p.ativo = true/);
  assert.match(cadastro, /INSERT INTO public.produtos \(/);
  assert.doesNotMatch(cadastro, /ADD COLUMN.*ativo/);
});

test("cadastro e edição expõem switch Produto ativo", () => {
  const form = fonte("app/produtos/produto-cadastro-form.tsx");
  const actions = fonte("app/produtos/actions.ts");

  assert.match(form, /Produto ativo/);
  assert.match(form, /name="ativo"/);
  assert.match(form, /defaultChecked=\{produto\?\.ativo !== false\}/);
  assert.match(actions, /ativo: formData\.get\("ativo"\) === "1"/);
  assert.match(actions, /ativo: dados\.ativo/);
  assert.match(actions, /update\(\{ ativo: false \}\)/);
});

test("listagem tem badge e filtro Todos / Ativos / Inativos", () => {
  const lista = fonte("app/produtos/produtos-workspace.tsx");
  assert.match(lista, /FiltroStatus = "todos" \| "ativos" \| "inativos"/);
  assert.match(lista, /<option value="todos">Todos<\/option>/);
  assert.match(lista, /<option value="ativos">Ativos<\/option>/);
  assert.match(lista, /<option value="inativos">Inativos<\/option>/);
  assert.match(lista, /status=\{produto\.ativo \? "ativo" : "inativo"\}/);
});

test("menu inativa sem excluir fisicamente e reativa", () => {
  const lista = fonte("app/produtos/produtos-workspace.tsx");
  const actions = fonte("app/produtos/actions.ts");

  assert.match(lista, /Inativar produto/);
  assert.match(lista, /Reativar produto/);
  assert.match(lista, /inativarProduto/);
  assert.doesNotMatch(lista, /label: "Excluir"/);
  assert.match(actions, /export async function inativarProduto/);
  assert.match(actions, /export async function reativarProduto/);
  assert.match(actions, /estoque_atual/);
  assert.match(actions, /quantidade > 0/);

  const inativar = actions.slice(
    actions.indexOf("export async function inativarProduto"),
    actions.indexOf("CADASTRO RÁPIDO")
  );
  assert.doesNotMatch(inativar, /\.delete\(\)/);
  assert.match(inativar, /\.update\(\{ ativo: false \}\)/);
  assert.match(inativar, /\.eq\("empresa_id", empresaId\)/);
});

test("produto com movimentação nunca é excluído fisicamente", () => {
  const actions = fonte("app/produtos/actions.ts");
  const excluir = actions.slice(
    actions.indexOf("export async function excluirOuInativarProduto"),
    actions.indexOf("export async function reativarProduto")
  );
  assert.match(excluir, /estoque_movimentacoes/);
  assert.match(excluir, /vendas_itens/);
  assert.ok(excluir.indexOf("usos > 0") < excluir.indexOf(".update({ ativo: false }"));
});

test("PDV, busca operacional e catálogo público ignoram inativos", () => {
  assert.match(fonte("app/pdv/page.tsx"), /\.eq\("ativo", true\)/);
  assert.match(
    fonte("supabase/migrations/20260816010000_catalogo_online.sql"),
    /AND p\.ativo = true/
  );
  assert.match(fonte("lib/catalogo/regras.ts"), /produtoAtivo/);
});
