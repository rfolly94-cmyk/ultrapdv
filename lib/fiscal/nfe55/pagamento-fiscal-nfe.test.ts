import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  faturaNfePadrao,
  faturaParaPayloadGeranet,
  gerarParcelasFaturaNfe,
  validarFaturaParaEmissaoNfe,
} from "@/lib/fiscal/nfe55/fatura-nfe";
import {
  MENSAGEM_DUPLICATA_SEM_TPAG_14,
  MENSAGEM_TPAG_14_SEM_DUPLICATA,
  MENSAGEM_TPAG_14_VPAG_ZERO,
  MENSAGEM_TPAG_91_VPAG_DIFERENTE_ZERO,
  TPAG_DUPLICATA_MERCANTIL,
  TPAG_PAGAMENTO_POSTERIOR,
  conferenciaComercialNfeComDuplicata,
  faturaPermitidaNoPayloadNfe,
  mapearDetalhamentoFiscalNfe55,
  mesclarPagamentoDuplicataMercantil,
  saldoDuplicataMercantilCentavos,
  validarPagamentoFiscalNfe55,
} from "@/lib/fiscal/nfe55/pagamento-fiscal-nfe";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const formaPix = {
  id: "pix",
  codigo: "PIX",
  codigo_fiscal: "20",
  permite_fiado: false,
};
const formaCartao = {
  id: "card",
  codigo: "CREDITO",
  codigo_fiscal: "03",
  permite_fiado: false,
};
const formaFiado = {
  id: "fiado",
  codigo: "FIADO",
  codigo_fiscal: "05",
  permite_fiado: true,
};
const formaDuplicata = {
  id: "dup",
  codigo: "DUPLICATA",
  codigo_fiscal: "14",
  permite_fiado: false,
};
const formaDinheiro = {
  id: "din",
  codigo: "DINHEIRO",
  codigo_fiscal: "01",
  permite_fiado: false,
};

function payload(detalhamento: ReturnType<typeof mapearDetalhamentoFiscalNfe55>, fatura?: Parameters<typeof montarPayloadNfeGeranet>[0]["fatura"]) {
  return montarPayloadNfeGeranet({
    ambiente: "2",
    ufEmitente: "MT",
    certificadoDigital: "CERT",
    senhaCertificadoDigital: "SENHA",
    emitente: {
      cnpj: "42741754000142",
      inscricaoEstadual: "138856729",
      razaoSocial: "EMPRESA TESTE",
      logradouro: "Rua A",
      numero: "1",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
      codigoRegimeTributario: 1,
    },
    destinatario: {
      cpf: "52998224725",
      consumidorFinal: "1",
      indicadorIEdestinatario: "9",
      logradouro: "Rua B",
      numero: "2",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
    },
    config: {
      serie: 1,
      numeroNota: 1,
      codigoNumerico: "12345678",
      dataSaida: "2026-08-19 12:00:00",
      dataEmissao: "2026-08-19 12:00:00",
      fusoHorario: "America/Cuiaba",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      tipo: "1",
      finalidade: "1",
    },
    pagamento: { troco: 0, detalhamento },
    fatura,
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  }) as { nfe: { pagamento: unknown; fatura?: unknown } };
}

test("venda à vista não envia fatura nem tPag 91", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [{ id: "din", codigo_fiscal: "01", valor: 1000 }],
    formas: [formaDinheiro],
  });
  assert.deepEqual(detalhamento, [
    { tipo: "01", valor: 1000, indicadorPagamento: "0" },
  ]);
  const nfe = payload(detalhamento);
  assert.equal("fatura" in nfe.nfe, false);
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 1000,
      troco: 0,
      fatura: null,
    }),
    null
  );
});

test("venda 100% a prazo / Carteira vira tPag 91 com vPag 0", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [{ id: "fiado", codigo_fiscal: "05", valor: 1000 }],
    formas: [formaFiado],
  });
  assert.deepEqual(detalhamento, [
    { tipo: TPAG_PAGAMENTO_POSTERIOR, valor: 0, indicadorPagamento: "1" },
  ]);
  const nfe = payload(detalhamento);
  assert.deepEqual(nfe.nfe.pagamento, {
    troco: 0,
    detalhamento: [{ tipo: "91", valor: 0, indicadorPagamento: "1" }],
  });
  assert.equal("fatura" in nfe.nfe, false);
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 1000,
      troco: 0,
      fatura: null,
    }),
    null
  );
});

test("rejeita tPag 91 com vPag diferente de zero", () => {
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento: [{ tipo: "91", valor: 700, indicadorPagamento: "1" }],
      totalNfe: 700,
      troco: 0,
      fatura: null,
    }),
    MENSAGEM_TPAG_91_VPAG_DIFERENTE_ZERO
  );
});

test("PIX + Pagamento Posterior: vPag do PIX e tPag 91 com 0", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [
      { id: "pix", codigo_fiscal: "20", valor: 300 },
      { id: "fiado", codigo_fiscal: "05", valor: 700 },
    ],
    formas: [formaPix, formaFiado],
  });
  assert.deepEqual(detalhamento, [
    { tipo: "20", valor: 300, indicadorPagamento: "0" },
    { tipo: "91", valor: 0, indicadorPagamento: "1" },
  ]);
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 1000,
      troco: 0,
      fatura: null,
    }),
    null
  );
});

test("cartão + Pagamento Posterior", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [
      { id: "card", codigo_fiscal: "03", valor: 300 },
      { id: "fiado", codigo_fiscal: "05", valor: 700 },
    ],
    formas: [formaCartao, formaFiado],
  });
  assert.deepEqual(detalhamento, [
    { tipo: "03", valor: 300, indicadorPagamento: "0" },
    { tipo: "91", valor: 0, indicadorPagamento: "1" },
  ]);
});

test("Duplicata Mercantil 1 parcela exige tPag 14 e dup", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [{ id: "dup", codigo_fiscal: "14", valor: 1000 }],
    formas: [formaDuplicata],
  });
  assert.deepEqual(detalhamento, [
    { tipo: TPAG_DUPLICATA_MERCANTIL, valor: 1000, indicadorPagamento: "1" },
  ]);
  const fatura = faturaParaPayloadGeranet(
    faturaNfePadrao({ numero: "83", valorCentavos: 100000, primeiroVencimento: "2026-09-28" })
  );
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 1000,
      troco: 0,
      fatura,
    }),
    null
  );
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 1000,
      troco: 0,
      fatura: null,
    }),
    MENSAGEM_TPAG_14_SEM_DUPLICATA
  );
});

test("Duplicata Mercantil com várias parcelas fecha o líquido", () => {
  const faturaModelo = faturaNfePadrao({
    numero: "83",
    valorCentavos: 100000,
    primeiroVencimento: "2026-09-28",
  });
  faturaModelo.duplicatas = gerarParcelasFaturaNfe({
    valorLiquidoCentavos: 100000,
    quantidade: 3,
    primeiroVencimento: "2026-09-28",
    intervaloDias: 30,
  });
  assert.equal(
    validarFaturaParaEmissaoNfe({
      temDuplicataMercantil: true,
      fatura: faturaModelo,
      totalAPrazoCentavos: 100000,
    }),
    null
  );
  const fatura = faturaParaPayloadGeranet(faturaModelo);
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento: [{ tipo: "14", valor: 1000, indicadorPagamento: "1" }],
      totalNfe: 1000,
      troco: 0,
      fatura,
    }),
    null
  );
});

test("dup sem tPag 14 é rejeitada", () => {
  const fatura = faturaParaPayloadGeranet(
    faturaNfePadrao({ numero: "1", valorCentavos: 100000, primeiroVencimento: "2026-09-28" })
  );
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento: [{ tipo: "91", valor: 0, indicadorPagamento: "1" }],
      totalNfe: 1000,
      troco: 0,
      fatura,
    }),
    MENSAGEM_DUPLICATA_SEM_TPAG_14
  );
  assert.equal(
    faturaPermitidaNoPayloadNfe(
      [{ tipo: "91", valor: 0, indicadorPagamento: "1" }],
      fatura
    ),
    null
  );
});

test("fiado da Carteira nunca vira tPag 14", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [{ id: "fiado", codigo_fiscal: "14", valor: 1000 }],
    formas: [{ ...formaFiado, codigo_fiscal: "14" }],
  });
  assert.deepEqual(detalhamento, [
    { tipo: "91", valor: 0, indicadorPagamento: "1" },
  ]);
});

test("emissão da NF-e 55 mapeia 91 e não lê Carteira para duplicata", () => {
  const emitir = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const carregar = fonte("lib/fiscal/nfe55/carregar-formulario-nfe.ts");
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  assert.match(emitir, /mapearDetalhamentoFiscalNfe55/);
  assert.match(emitir, /validarPagamentoFiscalNfe55/);
  assert.match(emitir, /duplicataMercantilCentavos/);
  assert.doesNotMatch(emitir, /faturaDeTitulosCarteira/);
  assert.doesNotMatch(carregar, /faturaDeTitulosCarteira/);
  assert.match(form, /temPagamentoPosterior/);
  assert.match(fonte("components/fiscal/nfe55/nfe-fatura-cobranca.tsx"), /Pagamento Posterior/);
  assert.match(fonte("components/fiscal/nfe55/nfe-fatura-cobranca.tsx"), /Pago\/outras formas/);
  assert.match(fonte("components/fiscal/nfe55/nfe-pagamento-venda.tsx"), /tPag 91/);
  assert.match(fonte("lib/fiscal/operacoes/status-operacao.ts"), /podeEditarDocumentoFiscal/);
});

test("NF-e 70 totalmente Duplicata Mercantil 1x: tPag 14 / vPag 70 / dup 70", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [],
    formas: [],
    duplicataMercantilCentavos: 7000,
  });
  assert.deepEqual(detalhamento, [
    { tipo: TPAG_DUPLICATA_MERCANTIL, valor: 70, indicadorPagamento: "1" },
  ]);
  const faturaModelo = faturaNfePadrao({
    numero: "1",
    valorCentavos: 7000,
    primeiroVencimento: "2026-09-28",
  });
  const fatura = faturaParaPayloadGeranet(faturaModelo);
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 70,
      troco: 0,
      fatura,
    }),
    null
  );
  const nfe = payload(detalhamento, fatura);
  assert.deepEqual(nfe.nfe.pagamento, {
    troco: 0,
    detalhamento: [{ tipo: "14", valor: 70, indicadorPagamento: "1" }],
  });
  assert.deepEqual(nfe.nfe.fatura, {
    numero: "1",
    valor: 70,
    desconto: 0,
    valorLiquido: 70,
    duplicatas: [
      {
        numero: "001",
        dataVencimento: "2026-09-28",
        valor: 70,
      },
    ],
  });
});

test("Duplicata Mercantil 2x em NF-e 70: vPag 70 e dup 35+35", () => {
  const faturaModelo = faturaNfePadrao({
    numero: "1",
    valorCentavos: 7000,
    primeiroVencimento: "2026-09-28",
  });
  faturaModelo.duplicatas = gerarParcelasFaturaNfe({
    valorLiquidoCentavos: 7000,
    quantidade: 2,
    primeiroVencimento: "2026-09-28",
    intervaloDias: 30,
  });
  assert.equal(faturaModelo.duplicatas[0]?.valorCentavos, 3500);
  assert.equal(faturaModelo.duplicatas[1]?.valorCentavos, 3500);
  const fatura = faturaParaPayloadGeranet(faturaModelo);
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento: [{ tipo: "14", valor: 70, indicadorPagamento: "1" }],
      totalNfe: 70,
      troco: 0,
      fatura,
    }),
    null
  );
});

test("centavos em 3 parcelas somam o líquido da Duplicata Mercantil", () => {
  const parcelas = gerarParcelasFaturaNfe({
    valorLiquidoCentavos: 10001,
    quantidade: 3,
    primeiroVencimento: "2026-09-28",
    intervaloDias: 30,
  });
  assert.equal(parcelas.length, 3);
  assert.equal(
    parcelas.reduce((soma, item) => soma + item.valorCentavos, 0),
    10001
  );
  assert.equal(parcelas[0]?.valorCentavos, 3333);
  assert.equal(parcelas[1]?.valorCentavos, 3333);
  assert.equal(parcelas[2]?.valorCentavos, 3335);
  const faturaModelo = faturaNfePadrao({
    numero: "1",
    valorCentavos: 10001,
    primeiroVencimento: "2026-09-28",
  });
  faturaModelo.duplicatas = parcelas;
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento: [{ tipo: "14", valor: 100.01, indicadorPagamento: "1" }],
      totalNfe: 100.01,
      troco: 0,
      fatura: faturaParaPayloadGeranet(faturaModelo),
    }),
    null
  );
});

test("PIX 300 + Duplicata 700 em NF-e 1000", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [{ id: "pix", codigo_fiscal: "20", valor: 300 }],
    formas: [formaPix],
    duplicataMercantilCentavos: 70000,
  });
  assert.deepEqual(detalhamento, [
    { tipo: "20", valor: 300, indicadorPagamento: "0" },
    { tipo: "14", valor: 700, indicadorPagamento: "1" },
  ]);
  const faturaModelo = faturaNfePadrao({
    numero: "1",
    valorCentavos: 70000,
    primeiroVencimento: "2026-09-28",
  });
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 1000,
      troco: 0,
      fatura: faturaParaPayloadGeranet(faturaModelo),
    }),
    null
  );
  assert.equal(
    saldoDuplicataMercantilCentavos({
      totalNfeCentavos: 100000,
      pagamentosImediatosCentavos: 30000,
    }),
    70000
  );
});

test("Dinheiro 200 + Duplicata 800", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [{ id: "din", codigo_fiscal: "01", valor: 200 }],
    formas: [formaDinheiro],
    duplicataMercantilCentavos: 80000,
  });
  assert.deepEqual(detalhamento, [
    { tipo: "01", valor: 200, indicadorPagamento: "0" },
    { tipo: "14", valor: 800, indicadorPagamento: "1" },
  ]);
  const faturaModelo = faturaNfePadrao({
    numero: "1",
    valorCentavos: 80000,
    primeiroVencimento: "2026-09-28",
  });
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 1000,
      troco: 0,
      fatura: faturaParaPayloadGeranet(faturaModelo),
    }),
    null
  );
});

test("tPag 14 com vPag 0 deve falhar", () => {
  const fatura = faturaParaPayloadGeranet(
    faturaNfePadrao({ numero: "1", valorCentavos: 7000, primeiroVencimento: "2026-09-28" })
  );
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento: [{ tipo: "14", valor: 0, indicadorPagamento: "1" }],
      totalNfe: 70,
      troco: 0,
      fatura,
    }),
    MENSAGEM_TPAG_14_VPAG_ZERO
  );
});

test("tPag 91 continua com vPag 0 e ignora injeção de duplicata", () => {
  const detalhamento = mapearDetalhamentoFiscalNfe55({
    pagamentos: [{ id: "fiado", codigo_fiscal: "05", valor: 70 }],
    formas: [formaFiado],
    duplicataMercantilCentavos: 7000,
  });
  assert.deepEqual(detalhamento, [
    { tipo: TPAG_PAGAMENTO_POSTERIOR, valor: 0, indicadorPagamento: "1" },
  ]);
  assert.equal(
    validarPagamentoFiscalNfe55({
      detalhamento,
      totalNfe: 70,
      troco: 0,
      fatura: null,
    }),
    null
  );
});

test("mescla Duplicata Mercantil no rascunho sem duplicar tPag 14", () => {
  const mesclado = mesclarPagamentoDuplicataMercantil({
    pagamentos: [{ formaPagamentoId: "pix", valorCentavos: 30000 }],
    formas: [formaPix, formaDuplicata],
    coberturaDuplicataCentavos: 70000,
  });
  assert.deepEqual(mesclado, [
    { formaPagamentoId: "pix", valorCentavos: 30000 },
    { formaPagamentoId: "dup", valorCentavos: 70000 },
  ]);
  const conferencia = conferenciaComercialNfeComDuplicata({
    valorTotal: 1000,
    pagamentos: [{ status: "confirmado", valor: 300 }],
    coberturaDuplicataCentavos: 70000,
  });
  assert.equal(conferencia.ok, true);
});
