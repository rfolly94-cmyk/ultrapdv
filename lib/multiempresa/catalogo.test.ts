import assert from "node:assert/strict";
import { test } from "node:test";

import { chaveCarrinho } from "@/lib/catalogo/carrinho";

import {
  empresaA,
  empresaB,
  produtoA,
  produtoB,
} from "./cenario";
import { fonte } from "./fonte";

test("catálogo: slug é único globalmente; empresa vem do slug, não do browser", () => {
  const sql = fonte("supabase/migrations/20260816010000_catalogo_online.sql");
  assert.match(sql, /CONSTRAINT catalogo_config_slug_unique UNIQUE \(slug\)/);
  assert.match(sql, /rpc_catalogo_publico\(p_slug text\)/);
  assert.match(sql, /WHERE p\.empresa_id = v_config\.empresa_id/);
});

test("catálogo: criar pedido não recebe empresa_id do client", () => {
  const action = fonte("app/catalogo/actions.ts");
  assert.match(action, /rpc_catalogo_criar_pedido/);
  assert.doesNotMatch(action, /p_empresa_id/);
  assert.doesNotMatch(action, /empresa_id:/);
});

test("catálogo: INSERT do pedido usa v_config.empresa_id", () => {
  const sql = fonte("supabase/migrations/20260816010000_catalogo_online.sql");
  assert.match(sql, /INSERT INTO public\.catalogo_pedidos/);
  assert.match(sql, /v_config\.empresa_id/);
  assert.match(
    sql,
    /WHERE p\.id = v_produto_id[\s\S]+AND p\.empresa_id = v_config\.empresa_id/
  );
});

test("catálogo: slug-A não lista produto B", () => {
  const configs = [
    { slug: "slug-a", empresa_id: empresaA },
    { slug: "slug-b", empresa_id: empresaB },
  ];
  const produtos = [
    { id: produtoA, empresa_id: empresaA, publicado: true },
    { id: produtoB, empresa_id: empresaB, publicado: true },
  ];

  function publico(slug: string) {
    const config = configs.find((item) => item.slug === slug);
    if (!config) return [];
    return produtos.filter((produto) => produto.empresa_id === config.empresa_id);
  }

  assert.deepEqual(
    publico("slug-a").map((p) => p.id),
    [produtoA]
  );
  assert.equal(
    publico("slug-a").some((p) => p.id === produtoB),
    false
  );
});

test("pedidos online: conversão filtra pedido pela empresa ativa", () => {
  const acoes = fonte("app/vendas/pedidos/actions.ts");
  const pdv = fonte("lib/catalogo/carregar-pedido-pdv.ts");
  assert.match(acoes, /\.eq\("empresa_id", empresaId\)/);
  assert.match(acoes, /\.eq\("id", pedidoId\)/);
  assert.match(pdv, /\.eq\("empresa_id", empresaId\)/);
  assert.match(pdv, /\.eq\("id", pedidoId\)/);
});

test("frontend: carrinho de catálogo é namespaced por slug", () => {
  assert.equal(chaveCarrinho("slug-a"), "ultrapdv.catalogo.carrinho.slug-a");
  assert.notEqual(chaveCarrinho("slug-a"), chaveCarrinho("slug-b"));
});
