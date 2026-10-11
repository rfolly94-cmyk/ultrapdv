import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import {
  layoutReciboPadrao,
  montarReciboVenda,
  reciboVendaExemplo,
} from "@/lib/impressao/recibo-layout";
import {
  apresentarReciboVenda,
  type ItemReciboComercial,
  type ItemReciboFiscal,
} from "@/lib/impressao/recibo-apresentacao-fiscal";

function comercial(
  produtoId: string,
  unitario: number,
  quantidade = 1,
  nome = "Produto X"
): ItemReciboComercial {
  return {
    produtoId,
    codigo: "X",
    nome,
    quantidade,
    valorUnitario: unitario,
    desconto: 0,
    total: quantidade * unitario,
  };
}

function fiscal(
  produtoId: string,
  unitario: number,
  quantidade = 1
): ItemReciboFiscal {
  return {
    produtoId,
    quantidade,
    valorUnitario: unitario,
    total: quantidade * unitario,
  };
}

function linhas(apresentacao: ReturnType<typeof apresentarReciboVenda>) {
  const dados = reciboVendaExemplo();
  dados.itens = apresentacao.itens;
  dados.valorProdutos = apresentacao.valorProdutos;
  dados.desconto = apresentacao.desconto;
  dados.acrescimo = apresentacao.acrescimo;
  dados.frete = apresentacao.frete;
  dados.total = apresentacao.total;
  dados.pagamentos = [];
  dados.carteira = null;
  return montarReciboVenda(dados, layoutReciboPadrao()).linhasPdf.join("\n");
}

test("caso 1: preço NF-e 120 não imprime acréscimo de compensação", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("p", 100)],
    itensFiscais: [fiscal("p", 120)],
    valorProdutos: 100,
    desconto: 0,
    acrescimo: 20,
    frete: 0,
    total: 120,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 120);
  assert.equal(recibo.itens[0]?.total, 120);
  assert.equal(recibo.acrescimo, 0);
  assert.equal(recibo.desconto, 0);
  assert.equal(recibo.total, 120);
  assert.equal(recibo.diagnosticoComposicao, null);
  const texto = linhas(recibo);
  assert.match(texto, /120,00/);
  assert.doesNotMatch(texto, /Acrescimo/);
});

test("caso 2: outras despesas reais de 5 continuam no acréscimo", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("p", 100)],
    itensFiscais: [fiscal("p", 120)],
    valorProdutos: 100,
    desconto: 0,
    acrescimo: 25,
    frete: 0,
    total: 125,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 120);
  assert.equal(recibo.itens[0]?.total, 120);
  assert.equal(recibo.acrescimo, 5);
  assert.equal(recibo.total, 125);
  assert.equal(recibo.diagnosticoComposicao, null);
  assert.match(linhas(recibo), /Acrescimo/);
});

test("caso 3: preço menor não imprime desconto artificial", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("p", 100)],
    itensFiscais: [fiscal("p", 80)],
    valorProdutos: 100,
    desconto: 20,
    acrescimo: 0,
    frete: 0,
    total: 80,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 80);
  assert.equal(recibo.itens[0]?.total, 80);
  assert.equal(recibo.desconto, 0);
  assert.equal(recibo.acrescimo, 0);
  assert.equal(recibo.total, 80);
  assert.equal(recibo.diagnosticoComposicao, null);
  assert.doesNotMatch(linhas(recibo), /Desconto/);
});

test("caso 4: desconto comercial real de 5 permanece", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("p", 100)],
    itensFiscais: [fiscal("p", 80)],
    valorProdutos: 100,
    desconto: 25,
    acrescimo: 0,
    frete: 0,
    total: 75,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 80);
  assert.equal(recibo.itens[0]?.total, 80);
  assert.equal(recibo.desconto, 5);
  assert.equal(recibo.acrescimo, 0);
  assert.equal(recibo.total, 75);
  assert.equal(recibo.diagnosticoComposicao, null);
  assert.match(linhas(recibo), /Desconto/);
});

test("caso 5: venda do PDV sem operação fiscal não muda", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("p", 100)],
    itensFiscais: null,
    valorProdutos: 100,
    desconto: 0,
    acrescimo: 20,
    frete: 0,
    total: 120,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 100);
  assert.equal(recibo.itens[0]?.total, 100);
  assert.equal(recibo.acrescimo, 20);
  assert.equal(recibo.desconto, 0);
  assert.equal(recibo.valorProdutos, 100);
  assert.equal(recibo.total, 120);
  assert.equal(recibo.diagnosticoComposicao, null);
  assert.match(linhas(recibo), /Acrescimo/);
});

test("caso 6: frete fica em linha própria e não vira acréscimo", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("p", 100)],
    itensFiscais: [fiscal("p", 120)],
    valorProdutos: 100,
    desconto: 0,
    acrescimo: 20,
    frete: 10,
    total: 130,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 120);
  assert.equal(recibo.itens[0]?.total, 120);
  assert.equal(recibo.acrescimo, 0);
  assert.equal(recibo.frete, 10);
  assert.equal(recibo.total, 130);
  assert.equal(recibo.diagnosticoComposicao, null);
  const texto = linhas(recibo);
  assert.match(texto, /Frete/);
  assert.match(texto, /10,00/);
  assert.doesNotMatch(texto, /Acrescimo/);
});

test("caso 7: mesmo produto repetido casa pela ordem do produto, não pela posição global", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [
      comercial("a", 100, 1, "Produto A1"),
      comercial("b", 40, 1, "Produto B"),
      comercial("a", 100, 1, "Produto A2"),
    ],
    itensFiscais: [
      fiscal("b", 40),
      fiscal("a", 120),
      fiscal("a", 80),
    ],
    valorProdutos: 240,
    desconto: 0,
    acrescimo: 0,
    frete: 0,
    total: 240,
  });
  assert.deepEqual(
    recibo.itens.map((item) => ({ nome: item.nome, valorUnitario: item.valorUnitario, total: item.total })),
    [
      { nome: "Produto A1", valorUnitario: 120, total: 120 },
      { nome: "Produto B", valorUnitario: 40, total: 40 },
      { nome: "Produto A2", valorUnitario: 80, total: 80 },
    ]
  );
  assert.equal(recibo.diagnosticoComposicao, null);
  assert.equal(recibo.total, 240);
});

test("contagem divergente do mesmo produto não troca preço e registra diagnóstico", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("a", 100), comercial("a", 100)],
    itensFiscais: [fiscal("a", 120)],
    valorProdutos: 200,
    desconto: 0,
    acrescimo: 20,
    frete: 0,
    total: 220,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 100);
  assert.equal(recibo.itens[1]?.valorUnitario, 100);
  assert.equal(recibo.acrescimo, 20);
  assert.match(recibo.diagnosticoComposicao ?? "", /manteve os valores comerciais/);
});

test("composição divergente não reescreve o total da venda", () => {
  const recibo = apresentarReciboVenda({
    itensComerciais: [comercial("p", 100)],
    itensFiscais: [fiscal("p", 120)],
    valorProdutos: 100,
    desconto: 0,
    acrescimo: 20,
    frete: 0,
    total: 999,
  });
  assert.equal(recibo.itens[0]?.valorUnitario, 120);
  assert.equal(recibo.total, 999);
  assert.match(recibo.diagnosticoComposicao ?? "", /vendas\.valor_total/);
});

test("recibo não grava venda nem monta payload fiscal", () => {
  const apresentacao = fonte("lib/impressao/recibo-apresentacao-fiscal.ts");
  const loader = fonte("lib/impressao/carregar-recibo.ts");
  assert.match(apresentacao, /compensarDiferencaSubtotalCatalogo/);
  assert.match(apresentacao, /produtoId/);
  assert.doesNotMatch(apresentacao, /prepararNfeVenda|montarPayloadNfe|chamarGeranet|fiscal_emissoes/);
  assert.match(loader, /fiscal_operacoes/);
  assert.match(loader, /tipo_operacao_interno", "venda"/);
  assert.match(loader, /apresentarReciboVenda/);
  assert.doesNotMatch(loader, /\.update\(|rpc_finalizar_venda|prepararNfeVenda|fiscal_emissoes/);
  assert.doesNotMatch(loader, /from\("produtos"\)/);
});
