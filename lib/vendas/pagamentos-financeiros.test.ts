import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  conferenciaFinanceiraVenda,
  filtrarPagamentosFinanceiros,
  filtrarPagamentosHistorico,
  pagamentoFinanceiramenteValido,
  somarPagamentosLiquidos,
  STATUS_PAGAMENTO_VENDA,
} from "./pagamentos-financeiros";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const casoEdicao55 = [
  { status: "cancelado", valor: 30, forma: "Dinheiro" },
  { status: "cancelado", valor: 25, forma: "Cartão de Débito" },
  { status: "confirmado", valor: 55, forma: "Dinheiro" },
];

test("status financeiros reais do banco são confirmado e cancelado", () => {
  assert.equal(STATUS_PAGAMENTO_VENDA.confirmado, "confirmado");
  assert.equal(STATUS_PAGAMENTO_VENDA.cancelado, "cancelado");
  assert.equal(pagamentoFinanceiramenteValido("confirmado"), true);
  assert.equal(pagamentoFinanceiramenteValido("cancelado"), false);
  assert.equal(pagamentoFinanceiramenteValido("estornado"), false);
  assert.equal(pagamentoFinanceiramenteValido(null), false);
});

test("edição 55: dinheiro 30 + débito 25 cancelados + dinheiro 55 vigente = líquidos 55", () => {
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: 55,
    pagamentos: casoEdicao55,
    troco: 0,
  });

  assert.equal(somarPagamentosLiquidos({ pagamentos: casoEdicao55 }), 55);
  assert.equal(conferencia.pagamentosLiquidos, 55);
  assert.equal(conferencia.valorVenda, 55);
  assert.equal(conferencia.diferenca, 0);
  assert.equal(conferencia.ok, true);
  assert.equal(
    casoEdicao55.reduce((total, item) => total + item.valor, 0),
    110
  );
  assert.deepEqual(
    filtrarPagamentosFinanceiros(casoEdicao55).map((item) => item.forma),
    ["Dinheiro"]
  );
  assert.deepEqual(
    filtrarPagamentosHistorico(casoEdicao55).map((item) => item.forma),
    ["Dinheiro", "Cartão de Débito"]
  );
});

test("A) dinheiro 100 → PIX 100: somente o PIX vigente entra no líquido", () => {
  const pagamentos = [
    { status: "cancelado", valor: 100 },
    { status: "confirmado", valor: 100 },
  ];
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: 100,
    pagamentos,
  });
  assert.equal(conferencia.pagamentosLiquidos, 100);
  assert.equal(conferencia.ok, true);
});

test("B) dinheiro 50 + débito 50 → dinheiro 100", () => {
  const pagamentos = [
    { status: "cancelado", valor: 50 },
    { status: "cancelado", valor: 50 },
    { status: "confirmado", valor: 100 },
  ];
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: 100,
    pagamentos,
  });
  assert.equal(conferencia.pagamentosLiquidos, 100);
  assert.equal(conferencia.ok, true);
});

test("C) total 100 → 80 com dinheiro 80", () => {
  const pagamentos = [
    { status: "cancelado", valor: 100 },
    { status: "confirmado", valor: 80 },
  ];
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: 80,
    pagamentos,
  });
  assert.equal(conferencia.pagamentosLiquidos, 80);
  assert.equal(conferencia.ok, true);
});

test("D) duas edições: somente a versão vigente forma o líquido", () => {
  const pagamentos = [
    { status: "cancelado", valor: 30 },
    { status: "cancelado", valor: 25 },
    { status: "cancelado", valor: 55 },
    { status: "confirmado", valor: 55 },
  ];
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: 55,
    pagamentos,
  });
  assert.equal(conferencia.pagamentosLiquidos, 55);
  assert.equal(filtrarPagamentosHistorico(pagamentos).length, 3);
  assert.equal(
    pagamentos.reduce((total, item) => total + item.valor, 0),
    165
  );
  assert.equal(conferencia.ok, true);
});

test("troco da venda é descontado só dos pagamentos confirmados", () => {
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: 50,
    pagamentos: [
      { status: "cancelado", valor: 100 },
      { status: "confirmado", valor: 80 },
    ],
    troco: 30,
  });
  assert.equal(conferencia.pagamentosLiquidos, 50);
  assert.equal(conferencia.ok, true);
});

test("diferença real continua sendo conferência financeira", () => {
  const conferencia = conferenciaFinanceiraVenda({
    valorTotal: 55,
    pagamentos: [{ status: "confirmado", valor: 40 }],
  });
  assert.equal(conferencia.ok, false);
  assert.equal(conferencia.pagamentosLiquidos, 40);
});

test("RPC de edição cancela confirmados e insere novos confirmados, sem apagar", () => {
  const rpc = fonte(
    "supabase/migrations/20260815011000_fix_rpc_editar_venda_ambiguidade.sql"
  );
  assert.match(rpc, /SET status = 'cancelado'/);
  assert.match(rpc, /AND vp\.status = 'confirmado'/);
  assert.match(rpc, /INSERT INTO public\.vendas_pagamentos/);
  assert.match(rpc, /'confirmado'/);
  assert.doesNotMatch(rpc, /DELETE FROM public\.vendas_pagamentos/);
});

test("conferência NF-e/NFC-e e detalhe usam a regra única, não a soma crua", () => {
  const nfe = fonte("app/vendas/[id]/nfe/page.tsx");
  const nfce = fonte("app/vendas/[id]/nfce/page.tsx");
  const detalhe = fonte("app/vendas/[id]/page.tsx");
  const lista = fonte("app/vendas/page.tsx");
  const editar = fonte("app/pdv/editar-actions.ts");
  const emitirNfe = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const emitirNfce = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");

  for (const fonteArquivo of [nfe, nfce, detalhe, lista, emitirNfe, emitirNfce]) {
    assert.match(fonteArquivo, /conferenciaFinanceiraVenda|filtrarPagamentosFinanceiros|pagamentoFinanceiramenteValido/);
  }

  assert.match(nfe, /conferenciaFinanceiraVenda/);
  assert.match(nfce, /conferenciaFinanceiraVenda/);
  assert.match(detalhe, /filtrarPagamentosHistorico/);
  assert.match(editar, /revalidatePath/);
  assert.doesNotMatch(emitirNfe, /pagamentosConfirmados\.length !==\s*\n?\s*pagamentos\.length/);
  assert.doesNotMatch(emitirNfce, /pagamentosConfirmados\.length !==\s*\n?\s*pagamentos\.length/);
});
