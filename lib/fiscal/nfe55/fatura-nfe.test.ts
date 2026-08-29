import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  adicionarDiasIsoLocal,
  faturaDeTitulosCarteira,
  faturaNfeDoSnapshot,
  faturaNfePadrao,
  faturaParaPayloadGeranet,
  gerarParcelasFaturaNfe,
  indicadorPagamentoDetalheNfe,
  numeroParcelaNfe,
  snapshotFaturaNfe,
  somaDuplicatasCentavos,
  totalAPrazoFaturaCentavos,
  validarFaturaParaEmissaoNfe,
} from "@/lib/fiscal/nfe55/fatura-nfe";
import { mesclarSnapshotOperacao } from "@/lib/fiscal/nfe55/pagamentos-rascunho";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

function payloadBase(extra: {
  fatura?: Parameters<typeof montarPayloadNfeGeranet>[0]["fatura"];
  detalhamento?: Parameters<typeof montarPayloadNfeGeranet>[0]["pagamento"]["detalhamento"];
}) {
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
    pagamento: {
      troco: 0,
      detalhamento: extra.detalhamento ?? [
        { tipo: "01", valor: 340, indicadorPagamento: "0" },
      ],
    },
    fatura: extra.fatura,
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  }) as {
    nfe: {
      pagamento: unknown;
      fatura?: unknown;
    };
  };
}

test("A) venda à vista não envia nfe.fatura", () => {
  const payload = payloadBase({});
  assert.equal("fatura" in payload.nfe, false);
  assert.ok(payload.nfe.pagamento);
});

test("B) venda a prazo 1x envia fatura + 1 duplicata", () => {
  const fatura = faturaNfePadrao({
    numero: "83",
    valorCentavos: 34000,
    primeiroVencimento: "2026-09-28",
  });
  assert.equal(fatura.duplicatas.length, 1);
  assert.equal(fatura.duplicatas[0]?.numero, "001");
  const geranet = faturaParaPayloadGeranet(fatura);
  const payload = payloadBase({
    fatura: geranet,
    detalhamento: [{ tipo: "05", valor: 340, indicadorPagamento: "1" }],
  });
  assert.deepEqual(payload.nfe.fatura, geranet);
});

test("C/D) 3 parcelas fecham o líquido, inclusive 100/3", () => {
  const tres = gerarParcelasFaturaNfe({
    valorLiquidoCentavos: 34000,
    quantidade: 3,
    primeiroVencimento: "2026-09-28",
    intervaloDias: 30,
  });
  assert.equal(tres.map((item) => item.valorCentavos).join(","), "11333,11333,11334");
  assert.equal(somaDuplicatasCentavos(tres), 34000);
  assert.equal(tres[1]?.dataVencimento, "2026-10-28");
  const cem = gerarParcelasFaturaNfe({
    valorLiquidoCentavos: 10000,
    quantidade: 3,
    primeiroVencimento: "2026-09-28",
    intervaloDias: 30,
  });
  assert.equal(cem.map((item) => item.valorCentavos).join(","), "3333,3333,3334");
  assert.equal(somaDuplicatasCentavos(cem), 10000);
});

test("vencimento usa calendário local e não desloca 1 dia por UTC", () => {
  assert.equal(adicionarDiasIsoLocal("2026-09-28", 30), "2026-10-28");
  assert.equal(adicionarDiasIsoLocal("2026-01-31", 1), "2026-02-01");
  assert.equal(numeroParcelaNfe(2), "002");
});

test("E) rascunho persiste e relê fatura no snapshot JSONB", () => {
  const fatura = faturaNfePadrao({
    numero: "83",
    valorCentavos: 34000,
    primeiroVencimento: "2026-09-28",
  });
  fatura.duplicatas = gerarParcelasFaturaNfe({
    valorLiquidoCentavos: 34000,
    quantidade: 2,
    primeiroVencimento: "2026-09-28",
    intervaloDias: 30,
  });
  const snapshot = mesclarSnapshotOperacao(
    { pagamentos_rascunho: [{ formaPagamentoId: "x", valorCentavos: 34000 }] },
    snapshotFaturaNfe({ condicao: "prazo", fatura })
  );
  const lida = faturaNfeDoSnapshot(snapshot);
  assert.equal(lida?.numero, "83");
  assert.equal(lida?.duplicatas.length, 2);
  assert.equal(lida?.duplicatas[1]?.valorCentavos, 17000);
  assert.equal(lida?.duplicatas[1]?.dataVencimento, "2026-10-28");
  const vista = mesclarSnapshotOperacao(
    snapshot,
    snapshotFaturaNfe({ condicao: "vista", fatura: null })
  );
  assert.equal(faturaNfeDoSnapshot(vista), null);
});

test("F) Carteira existente vira fatura fiscal sem criar título novo", () => {
  const fatura = faturaDeTitulosCarteira({
    empresaId: "emp-a",
    vendaId: "venda-83",
    numeroFatura: "83",
    titulos: [
      {
        empresa_id: "emp-a",
        venda_id: "venda-83",
        numero_venda: 83,
        valor_original: 340,
        vencimento: "2026-09-28",
        status: "ABERTO",
      },
    ],
  });
  assert.equal(fatura?.origem, "carteira");
  assert.equal(fatura?.valorCentavos, 34000);
  assert.equal(fatura?.duplicatas[0]?.numero, "001");
  const outraEmpresa = faturaDeTitulosCarteira({
    empresaId: "emp-a",
    vendaId: "venda-83",
    titulos: [
      {
        empresa_id: "emp-b",
        venda_id: "venda-83",
        valor_original: 999,
        vencimento: "2026-09-28",
        status: "ABERTO",
      },
    ],
  });
  assert.equal(outraEmpresa, null);
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  assert.doesNotMatch(actions, /from\("carteira_cliente_titulos"\)\.insert/);
  assert.doesNotMatch(fonte("lib/fiscal/nfe55/fatura-nfe.ts"), /from\("carteira_cliente_titulos"\)/);
});

test("venda mista: fatura cobre só o fiado", () => {
  assert.equal(
    totalAPrazoFaturaCentavos({
      condicao: "prazo",
      totalNfeCentavos: 34000,
      totalFiadoCentavos: 24000,
    }),
    24000
  );
  const fatura = faturaNfePadrao({
    numero: "83",
    valorCentavos: 24000,
    primeiroVencimento: "2026-09-28",
  });
  assert.equal(
    validarFaturaParaEmissaoNfe({
      condicao: "prazo",
      fatura,
      totalAPrazoCentavos: 24000,
      totalVistaCentavos: 10000,
    }),
    null
  );
  assert.equal(
    indicadorPagamentoDetalheNfe({
      temFatura: true,
      vendaInteiraAPrazo: false,
      permiteFiado: false,
    }),
    "0"
  );
  assert.equal(
    indicadorPagamentoDetalheNfe({
      temFatura: true,
      vendaInteiraAPrazo: false,
      permiteFiado: true,
    }),
    "1"
  );
});

test("payload sanitizado 2x R$ 170 usa nomes Geranet", () => {
  const fatura = faturaNfePadrao({
    numero: "83",
    valorCentavos: 34000,
    primeiroVencimento: "2026-09-28",
    codigoPagamento: "05",
  });
  fatura.duplicatas = gerarParcelasFaturaNfe({
    valorLiquidoCentavos: 34000,
    quantidade: 2,
    primeiroVencimento: "2026-09-28",
    intervaloDias: 30,
    codigoPagamento: "05",
  });
  const geranet = faturaParaPayloadGeranet(fatura);
  assert.deepEqual(geranet, {
    numero: "83",
    valor: 340,
    desconto: 0,
    valorLiquido: 340,
    duplicatas: [
      {
        numero: "001",
        dataVencimento: "2026-09-28",
        valor: 170,
        codigoPagamento: "05",
      },
      {
        numero: "002",
        dataVencimento: "2026-10-28",
        valor: 170,
        codigoPagamento: "05",
      },
    ],
  });
  const payload = payloadBase({
    fatura: geranet,
    detalhamento: [{ tipo: "05", valor: 340, indicadorPagamento: "1" }],
  });
  assert.deepEqual(payload.nfe.pagamento, {
    troco: 0,
    detalhamento: [{ tipo: "05", valor: 340, indicadorPagamento: "1" }],
  });
  assert.ok(payload.nfe.fatura);
});

test("builder e emissão da venda usam nfe.fatura do snapshot", () => {
  const builder = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  const emitir = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const cobranca = fonte("components/fiscal/nfe55/nfe-fatura-cobranca.tsx");
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const carregar = fonte("lib/fiscal/nfe55/carregar-formulario-nfe.ts");
  assert.match(builder, /fatura:/);
  assert.match(builder, /duplicatas/);
  assert.match(builder, /dataVencimento/);
  assert.match(builder, /valorLiquido/);
  assert.match(emitir, /faturaParaPayloadGeranet/);
  assert.match(emitir, /faturaNfeDoSnapshot/);
  assert.match(form, /NfeFaturaCobranca/);
  assert.match(cobranca, /Fatura e parcelas/);
  assert.match(cobranca, /Gerar parcelas/);
  assert.match(cobranca, /Recalcular parcelas/);
  assert.match(actions, /snapshotFaturaNfe/);
  assert.match(carregar, /faturaNfeDoSnapshot/);
  assert.match(carregar, /carteira_cliente_titulos/);
  assert.match(carregar, /eq\("empresa_id", empresaId\)/);
});
