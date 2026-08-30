import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { avaliarPagamentosPdv, formatarCentavosBr } from "@/lib/pdv/pagamentos-teto";
import {
  avaliarPagamentosDigitadosNfe,
  compensarDiferencaSubtotalCatalogo,
  MENSAGEM_PAGAMENTOS_NFE_INCOMPLETOS,
  mensagemPagamentoNfeIncompleto,
  pagamentosNfeFechamTotal,
  sincronizarPagamentoUnicoComTotal,
  textoPagamentoDeCentavos,
} from "./sincronizar-pagamentos";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const pix = "pix-1";
const dinheiro = "din-1";
const cartao = "card-1";
const permite = {
  [pix]: false,
  [dinheiro]: true,
  [cartao]: false,
};

test("aumento do total com pagamento único sincroniza o valor", () => {
  const resultado = sincronizarPagamentoUnicoComTotal({
    totalVendaCentavos: 84000,
    pagamentos: [{ formaPagamentoId: pix, valorCentavos: 67200 }],
    permiteTrocoPorFormaId: permite,
  });
  assert.equal(resultado.sincronizou, true);
  assert.equal(resultado.pagamentos[0]?.valorCentavos, 84000);
});

test("redução do total com pagamento único sincroniza o valor", () => {
  const resultado = sincronizarPagamentoUnicoComTotal({
    totalVendaCentavos: 67200,
    pagamentos: [{ formaPagamentoId: pix, valorCentavos: 84000 }],
    permiteTrocoPorFormaId: permite,
  });
  assert.equal(resultado.sincronizou, true);
  assert.equal(resultado.pagamentos[0]?.valorCentavos, 67200);
});

test("pagamento único já igual ao total não é reescrito", () => {
  const resultado = sincronizarPagamentoUnicoComTotal({
    totalVendaCentavos: 84000,
    pagamentos: [{ formaPagamentoId: pix, valorCentavos: 84000 }],
    permiteTrocoPorFormaId: permite,
  });
  assert.equal(resultado.sincronizou, false);
  assert.equal(resultado.pagamentos[0]?.valorCentavos, 84000);
});

test("múltiplos pagamentos preservam valores e não fecham se faltar", () => {
  const pagamentos = [
    { formaPagamentoId: pix, valorCentavos: 40000 },
    { formaPagamentoId: cartao, valorCentavos: 27200 },
  ];
  const resultado = sincronizarPagamentoUnicoComTotal({
    totalVendaCentavos: 84000,
    pagamentos,
    permiteTrocoPorFormaId: permite,
  });
  assert.equal(resultado.sincronizou, false);
  assert.deepEqual(resultado.pagamentos, pagamentos);
  const avaliacao = avaliarPagamentosPdv({
    totalVendaCentavos: 84000,
    pagamentos: [
      { valorCentavos: 40000, permiteTroco: false },
      { valorCentavos: 27200, permiteTroco: false },
    ],
  });
  assert.equal(avaliacao.restanteCentavos, 16800);
  assert.equal(pagamentosNfeFechamTotal(avaliacao), false);
});

test("dinheiro único abaixo do total sobe para o total", () => {
  const resultado = sincronizarPagamentoUnicoComTotal({
    totalVendaCentavos: 84000,
    pagamentos: [{ formaPagamentoId: dinheiro, valorCentavos: 67200 }],
    permiteTrocoPorFormaId: permite,
  });
  assert.equal(resultado.sincronizou, true);
  assert.equal(resultado.pagamentos[0]?.valorCentavos, 84000);
});

test("dinheiro único acima do total preserva recebido e calcula troco", () => {
  const resultado = sincronizarPagamentoUnicoComTotal({
    totalVendaCentavos: 67200,
    pagamentos: [{ formaPagamentoId: dinheiro, valorCentavos: 84000 }],
    permiteTrocoPorFormaId: permite,
  });
  assert.equal(resultado.sincronizou, false);
  assert.equal(resultado.pagamentos[0]?.valorCentavos, 84000);
  const avaliacao = avaliarPagamentosPdv({
    totalVendaCentavos: 67200,
    pagamentos: [{ valorCentavos: 84000, permiteTroco: true }],
  });
  assert.equal(avaliacao.bloqueado, false);
  assert.equal(avaliacao.trocoCentavos, 16800);
  assert.equal(pagamentosNfeFechamTotal(avaliacao), true);
});

test("compensação de preço fiscal vs catálogo fecha o total comercial", () => {
  const maior = compensarDiferencaSubtotalCatalogo({
    subtotalCatalogoCentavos: 67200,
    subtotalAlvoCentavos: 84000,
    descontoCentavos: 0,
    acrescimoCentavos: 0,
  });
  assert.equal(maior.acrescimoCentavos, 16800);
  assert.equal(maior.descontoCentavos, 0);

  const menor = compensarDiferencaSubtotalCatalogo({
    subtotalCatalogoCentavos: 84000,
    subtotalAlvoCentavos: 67200,
    descontoCentavos: 500,
    acrescimoCentavos: 0,
  });
  assert.equal(menor.descontoCentavos, 17300);
  assert.equal(menor.acrescimoCentavos, 0);
});

test("mensagem de pagamento incompleto usa o total faltante", () => {
  assert.match(mensagemPagamentoNfeIncompleto(16800), /R\$\s*168,00/);
  assert.match(
    mensagemPagamentoNfeIncompleto(16800),
    new RegExp(MENSAGEM_PAGAMENTOS_NFE_INCOMPLETOS)
  );
  assert.equal(textoPagamentoDeCentavos(84000), "840,00");
});

test("tela e actions sincronizam pagamento único e bloqueiam emissão incompleta", () => {
  const editor = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const pagamento = fonte("components/fiscal/nfe55/nfe-pagamento-venda.tsx");
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const teto = fonte("lib/pdv/validar-teto-servidor.ts");
  assert.match(editor, /sincronizarPagamentoUnicoComTotal/);
  assert.match(editor, /pagamentosNfeFechamTotal/);
  assert.match(editor, /pagamentoImpedeEmissao/);
  assert.match(editor, /coberturaDuplicataCentavos/);
  assert.match(pagamento, /restanteCentavos > 0/);
  assert.match(actions, /precoUnitarioCentavos/);
  assert.match(actions, /rejeitarPagamentoIncompleto:\s*true/);
  assert.match(actions, /coberturaDuplicataCentavos/);
  assert.match(actions, /compensarDiferencaSubtotalCatalogo/);
  assert.match(actions, /trocoCentavos:\s*tetoFiscal\.trocoCentavos/);
  assert.match(actions, /venda_id/);
  assert.match(teto, /precoUnitarioCentavos/);
  assert.match(teto, /rejeitarPagamentoIncompleto/);
  assert.match(teto, /coberturaDuplicataCentavos/);
  assert.equal(formatarCentavosBr(16800).includes("168"), true);
});

test("Duplicata Mercantil fecha a conferência comercial sem vPag 0", () => {
  const incompleto = avaliarPagamentosDigitadosNfe({
    totalVendaCentavos: 7000,
    pagamentos: [],
    permiteTrocoPorFormaId: {},
  });
  assert.equal(incompleto.restanteCentavos, 7000);
  assert.equal(pagamentosNfeFechamTotal(incompleto), false);

  const duplicata = avaliarPagamentosDigitadosNfe({
    totalVendaCentavos: 7000,
    pagamentos: [],
    permiteTrocoPorFormaId: {},
    coberturaDuplicataCentavos: 7000,
  });
  assert.equal(duplicata.restanteCentavos, 0);
  assert.equal(pagamentosNfeFechamTotal(duplicata), true);

  const misto = avaliarPagamentosDigitadosNfe({
    totalVendaCentavos: 100000,
    pagamentos: [{ formaPagamentoId: pix, valorTexto: "300,00" }],
    permiteTrocoPorFormaId: permite,
    coberturaDuplicataCentavos: 70000,
  });
  assert.equal(misto.restanteCentavos, 0);
  assert.equal(pagamentosNfeFechamTotal(misto), true);
});
