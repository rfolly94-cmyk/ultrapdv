import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import { montarDadosCloneProduto, nomeProdutoCopia } from "./clonar";

const origem = {
  nome: "Refrigerante 2L",
  descricao: "Garrafa PET",
  categoria_id: "cat-1",
  marca_id: "marca-1",
  grupo_fiscal_id: "grupo-1",
  ncm: "22021000",
  cest: "0300100",
  origem_produto: "0",
  unidade_medida: "UN",
  preco_custo: 4.5,
  preco_venda: 8.9,
  ativo: true,
  catalogo_publicado: true,
  catalogo_descricao: "Oferta da semana",
  catalogo_destaque: true,
  catalogo_mostrar_preco: true,
  controlar_validade: true,
};

test("clone copia cadastro, comercial, fiscal e catálogo", () => {
  const clone = montarDadosCloneProduto(origem);
  assert.equal(clone.nome, "Refrigerante 2L - CÓPIA");
  assert.equal(clone.descricao, "Garrafa PET");
  assert.equal(clone.categoria_id, "cat-1");
  assert.equal(clone.marca_id, "marca-1");
  assert.equal(clone.grupo_fiscal_id, "grupo-1");
  assert.equal(clone.ncm, "22021000");
  assert.equal(clone.cest, "0300100");
  assert.equal(clone.origem_produto, "0");
  assert.equal(clone.unidade_medida, "UN");
  assert.equal(clone.preco_custo, 4.5);
  assert.equal(clone.preco_venda, 8.9);
  assert.equal(clone.catalogo_publicado, true);
  assert.equal(clone.catalogo_descricao, "Oferta da semana");
  assert.equal(clone.catalogo_destaque, true);
  assert.equal(clone.controlar_validade, true);
});

test("clone não copia id, código, EAN, estoque, lotes nem imagem", () => {
  const clone = montarDadosCloneProduto(origem);
  assert.equal("id" in clone, false);
  assert.equal(clone.codigo, "");
  assert.equal(clone.codigo_barras, null);
  assert.equal(clone.catalogo_imagem_path, null);
  assert.equal("quantidade" in clone, false);
  assert.equal("estoque" in clone, false);
  assert.equal("lotes" in clone, false);
  assert.equal("data_validade" in clone, false);
});

test("nome da cópia não duplica o sufixo", () => {
  assert.equal(nomeProdutoCopia("Água"), "Água - CÓPIA");
  assert.equal(nomeProdutoCopia("Água - CÓPIA"), "Água - CÓPIA");
});

test("clonar abre novo cadastro sem gravar produto automaticamente", () => {
  const lista = fonte("app/produtos/produtos-workspace.tsx");
  const page = fonte("app/produtos/page.tsx");
  const form = fonte("app/produtos/produto-cadastro-form.tsx");
  const actions = fonte("app/produtos/actions.ts");

  assert.match(lista, /Clonar produto/);
  assert.match(lista, /\/produtos\?novo=1&clonar=\$\{produto\.id\}/);
  assert.match(page, /montarDadosCloneProduto/);
  assert.match(page, /clonar\?: string/);
  assert.match(form, /action=\{cadastrarProduto\}/);
  assert.match(form, /Clonar produto/);
  assert.doesNotMatch(actions, /export async function clonarProduto/);
  assert.match(form, /name="codigo_automatico"/);
});
