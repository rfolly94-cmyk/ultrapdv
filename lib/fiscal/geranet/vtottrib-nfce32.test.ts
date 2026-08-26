import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import {
  conferirSomaItensFiscaisComVenda,
  distribuirDescontoItens,
  valorTotalNotaGeranet,
} from "@/lib/fiscal/distribuir-desconto-itens";
import { montarPayloadNfceGeranet } from "@/lib/fiscal/geranet/montar-payload-nfce";
import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  baseInformativaTributosItem,
  calcularTotaisItemGeranet,
  montarItemGeranet,
  valorAproximadoTributosNota,
  valorAproximadoTributosSobreBase,
} from "@/lib/fiscal/geranet/montar-item";

const NCM_CASO = "85299020";
const CFOP_CASO = "5405";
const CSOSN_CASO = "500";
const PIS_CASO = "07";
const COFINS_CASO = "07";

function grupoCaso(overrides?: { pisCst?: string; cofinsCst?: string }) {
  return {
    cfopInterno: CFOP_CASO,
    cfopInterestadual: "6405",
    icmsCstCsosn: CSOSN_CASO,
    pisCst: overrides?.pisCst ?? PIS_CASO,
    pisAliquota: 0,
    cofinsCst: overrides?.cofinsCst ?? COFINS_CASO,
    cofinsAliquota: 0,
    cstIbscbs: "000",
    classificacaoIbscbs: "000001",
    aliquotaIbsUf: 0,
    aliquotaIbsMunicipio: 0,
    aliquotaCbs: 0,
    percentualReducaoIbsUf: 0,
    percentualReducaoIbsMunicipio: 0,
    percentualReducaoCbs: 0,
  };
}

function montarCaso(input: {
  quantidade?: number;
  valorUnitario: number;
  desconto?: number;
  ncm?: string;
  origem?: string | null;
  crt?: 1 | 2 | 3 | 4;
  pisCst?: string;
  cofinsCst?: string;
  modelo?: "55" | "65";
}) {
  const modelo = input.modelo ?? "65";
  return montarItemGeranet({
    produto: {
      codigo: "1",
      nome: "Frontal A12 C/ Aro Diamond",
      unidadeMedida: "UN",
      precoVenda: input.valorUnitario,
    },
    fiscal: {
      ncm: input.ncm ?? NCM_CASO,
      cest: "",
      origemProduto: input.origem ?? "0",
    },
    grupo: grupoCaso({
      pisCst: input.pisCst,
      cofinsCst: input.cofinsCst,
    }),
    operacao: "interna",
    quantidade: input.quantidade ?? 1,
    valorUnitario: input.valorUnitario,
    desconto: input.desconto ?? 0,
    codigoRegimeTributario: input.crt ?? 1,
    ambiente: "1",
    dataEmissao: "2026-08-24",
    modelo,
    perfilIpi: modelo === "55" ? "NAO_CONTRIBUINTE" : null,
  });
}

function payloadNfce(item: ReturnType<typeof montarCaso>["item"], pagamento: {
  tipo?: string;
  valor: number;
  troco?: number;
}) {
  return montarPayloadNfceGeranet({
    emitente: {
      cnpj: "12345678000190",
      inscricaoEstadual: "123456789",
      razaoSocial: "EMPRESA A",
      nomeFantasia: "EMPRESA A",
      logradouro: "Rua A",
      numero: "1",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
      codigoRegimeTributario: 1,
    },
    config: {
      ambiente: "1",
      serie: 1,
      numeroNota: 32,
      idCsc: "1",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      dataEmissao: "2026-08-24 10:00:00",
      dataSaida: "2026-08-24 10:00:00",
      fusoHorario: "America/Cuiaba",
    },
    segredos: { csc: "abc" },
    item,
    pagamento: {
      tipo: pagamento.tipo ?? "01",
      valor: pagamento.valor,
      indicadorPagamento: "0",
      troco: pagamento.troco ?? 0,
    },
    codigoNumerico: "12345678",
  });
}

function payloadNfe(item: ReturnType<typeof montarCaso>["item"], pagamento: {
  valor: number;
  troco?: number;
}) {
  return montarPayloadNfeGeranet({
    ambiente: "2",
    ufEmitente: "MT",
    certificadoDigital: "CERT",
    senhaCertificadoDigital: "SENHA",
    emitente: {
      cnpj: "12345678000190",
      inscricaoEstadual: "123456789",
      razaoSocial: "EMPRESA A",
      nomeFantasia: "EMPRESA A",
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
      dataSaida: "2026-08-24 10:00:00",
      dataEmissao: "2026-08-24 10:00:00",
      fusoHorario: "America/Cuiaba",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      tipo: "1",
      finalidade: "1",
    },
    pagamento: {
      troco: pagamento.troco ?? 0,
      detalhamento: [
        { tipo: "01", valor: pagamento.valor, indicadorPagamento: "0" },
      ],
    },
    itens: [item],
  });
}

test("1. produto R$ 55 sem desconto: bruto=líquido; vTotTrib vazio pede cálculo automático", () => {
  const { item, valorBrutoItem, valorLiquidoFiscal } = montarCaso({
    valorUnitario: 55,
  });
  const totais = calcularTotaisItemGeranet({
    quantidade: 1,
    valorUnitario: 55,
  });
  assert.equal(item.valorTotal, "55.00");
  assert.equal(Number(item.desconto), 0);
  assert.equal(valorBrutoItem, 55);
  assert.equal(valorLiquidoFiscal, 55);
  assert.equal(baseInformativaTributosItem(totais), 55);
  assert.equal(item.vTotTrib, "");
  assert.equal("valorAproximadoTributos" in item, false);
});

test("2. NFC-e 32 / venda 64: desconto R$ 50 usa líquido 5 como base informativa", () => {
  const { item, valorBrutoItem, valorLiquidoFiscal } = montarCaso({
    valorUnitario: 55,
    desconto: 50,
  });
  const totais = calcularTotaisItemGeranet({
    quantidade: 1,
    valorUnitario: 55,
    desconto: 50,
  });

  assert.equal(item.valorTotal, "55.00");
  assert.equal(Number(item.desconto).toFixed(2), "50.00");
  assert.equal(valorBrutoItem, 55);
  assert.equal(valorLiquidoFiscal, 5);
  assert.equal(baseInformativaTributosItem(totais), 5);

  const vTotTribNoBruto = valorAproximadoTributosSobreBase(55, 20);
  const vTotTribNoLiquido = valorAproximadoTributosSobreBase(
    baseInformativaTributosItem(totais),
    20
  );
  assert.equal(vTotTribNoBruto, 11);
  assert.equal(vTotTribNoLiquido, 1);
  assert.equal(item.vTotTrib, "");
  assert.notEqual(item.vTotTrib, "11.00");
  assert.notEqual(item.vTotTrib, "1.00");
});

test("3. desconto parcial", () => {
  const totais = calcularTotaisItemGeranet({
    quantidade: 1,
    valorUnitario: 55,
    desconto: 10.5,
  });
  assert.equal(baseInformativaTributosItem(totais), 44.5);
  assert.equal(valorAproximadoTributosSobreBase(44.5, 20), 8.9);
});

test("4. desconto de 100%: base informativa 0, nunca negativa", () => {
  const totais = calcularTotaisItemGeranet({
    quantidade: 1,
    valorUnitario: 55,
    desconto: 55,
  });
  assert.equal(baseInformativaTributosItem(totais), 0);
  assert.equal(valorAproximadoTributosSobreBase(0, 20), 0);
});

test("5. múltiplos itens: total informativo deriva da soma dos itens", () => {
  const a = baseInformativaTributosItem(
    calcularTotaisItemGeranet({ quantidade: 1, valorUnitario: 55, desconto: 50 })
  );
  const b = baseInformativaTributosItem(
    calcularTotaisItemGeranet({ quantidade: 2, valorUnitario: 10, desconto: 0 })
  );
  assert.equal(a, 5);
  assert.equal(b, 20);
  assert.equal(
    valorAproximadoTributosNota([
      valorAproximadoTributosSobreBase(a, 20),
      valorAproximadoTributosSobreBase(b, 20),
    ]),
    5
  );
});

test("6. desconto rateado entre itens reutiliza distribuirDescontoItens", () => {
  const origem = [
    { id: "a", quantidade: 1, valorUnitario: 40, desconto: 0 },
    { id: "b", quantidade: 1, valorUnitario: 60, desconto: 0 },
  ];
  const rateio = distribuirDescontoItens({
    descontoVenda: 10,
    itens: origem,
  });
  const bases = rateio.itens.map((item, indice) =>
    baseInformativaTributosItem(
      calcularTotaisItemGeranet({
        quantidade: origem[indice].quantidade,
        valorUnitario: origem[indice].valorUnitario,
        desconto: item.descontoFiscal,
      })
    )
  );
  assert.equal(bases.reduce((soma, valor) => soma + valor, 0), 90);
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: origem.map((item, indice) => ({
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        desconto: rateio.itens[indice].descontoFiscal,
      })),
      valorTotalVenda: 90,
    }),
    null
  );

  const itensMontados = origem.map((origemItem, indice) =>
    montarCaso({
      valorUnitario: origemItem.valorUnitario,
      desconto: rateio.itens[indice].descontoFiscal,
    }).item
  );
  assert.equal(
    Number(itensMontados[0].desconto).toFixed(2),
    Number(rateio.itens[0].descontoFiscal).toFixed(2)
  );
  assert.equal(
    Number(itensMontados[1].desconto).toFixed(2),
    Number(rateio.itens[1].descontoFiscal).toFixed(2)
  );
  assert.equal(itensMontados[0].valorTotal, "40.00");
  assert.equal(itensMontados[1].valorTotal, "60.00");
  assert.equal(itensMontados[0].vTotTrib, "");
  assert.equal(itensMontados[1].vTotTrib, "");
});

test("7. arredondamento monetário a 2 casas, sem negativo", () => {
  assert.equal(valorAproximadoTributosSobreBase(5.555, 20), 1.11);
  assert.equal(valorAproximadoTributosSobreBase(0.01, 20), 0);
  assert.equal(baseInformativaTributosItem({
    valorBrutoItem: 1,
    valorLiquidoFiscal: -0.004,
    desconto: 1.004,
    frete: 0,
    seguro: 0,
    outro: 0,
  }), 0);
});

test("8 e 9. vTotTrib do item e do total usam a base líquida, não o bruto", () => {
  const item = valorAproximadoTributosSobreBase(5, 20);
  const total = valorAproximadoTributosNota([item]);
  assert.equal(item, 1);
  assert.equal(total, 1);
  assert.notEqual(valorAproximadoTributosSobreBase(55, 20), item);
});

test("10. vNF / valorTotal da nota continua o líquido e não muda com a base informativa", () => {
  const { item } = montarCaso({ valorUnitario: 55, desconto: 50 });
  assert.equal(
    valorTotalNotaGeranet([
      {
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        desconto: item.desconto,
        valorTotal: item.valorTotal,
      },
    ]),
    "5.00"
  );
  assert.equal(item.valorTotal, "55.00");
});

test("11. correção não altera ICMS/CSOSN", () => {
  const { item } = montarCaso({ valorUnitario: 55, desconto: 50 });
  assert.equal(item.icmsCsosn, CSOSN_CASO);
  assert.equal(item.icmsCst, undefined);
  assert.equal(item.cfop, CFOP_CASO);
});

test("12. correção não altera PIS/COFINS", () => {
  const { item } = montarCaso({ valorUnitario: 55, desconto: 50 });
  assert.equal(item.pisCst, PIS_CASO);
  assert.equal(item.cofinsCst, COFINS_CASO);
});

test("13. pagamento, troco e totais não mudam; contrato IBPT automático da Geranet", () => {
  const { item } = montarCaso({ valorUnitario: 55, desconto: 50 });
  const payload = payloadNfce(item, { valor: 5, troco: 0 });
  assert.equal(payload.nfe.pagamento.detalhamento[0].valor, 5);
  assert.equal(payload.nfe.pagamento.troco, 0);
  assert.equal(payload.nfe.empresa.ibptAutomatico, "sim");
  assert.equal(payload.nfe.itens[0].vTotTrib, "");
  assert.equal(payload.nfe.itens[0].valorTotal, "55.00");
  assert.equal(Number(payload.nfe.itens[0].desconto).toFixed(2), "50.00");
  assert.doesNotMatch(JSON.stringify(payload.nfe.itens[0]), /"vTotTrib":"[1-9]/);
  assert.doesNotMatch(fonte("lib/fiscal/geranet/montar-payload-nfce.ts"), /\b20\s*%/);
});

test("14. NFC-e normal reusa montarItemGeranet + payload Geranet", () => {
  const emitir = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  assert.match(emitir, /montarItemGeranet/);
  assert.match(emitir, /montarPayloadNfceGeranet/);
  assert.doesNotMatch(emitir, /vTotTrib|ibpt|IBPT|valorAproximadoTributos/);
});

test("15. contingência reusa o mesmo montarItemGeranet", () => {
  const contingencia = fonte(
    "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts"
  );
  assert.match(contingencia, /montarItemGeranet/);
  assert.doesNotMatch(contingencia, /vTotTrib|ibpt|IBPT/);
});

test("16. isolamento multiempresa: CRT/item não carregam empresa_id do cliente", () => {
  const a = montarCaso({ valorUnitario: 55, desconto: 50, crt: 1 });
  const b = montarCaso({
    valorUnitario: 55,
    desconto: 50,
    crt: 1,
    ncm: "85177099",
    pisCst: "49",
    cofinsCst: "49",
  });
  assert.notEqual(empresaA, empresaB);
  assert.equal(a.item.ncmProduto, NCM_CASO);
  assert.equal(b.item.ncmProduto, "85177099");
  assert.equal(a.item.pisCst, PIS_CASO);
  assert.equal(b.item.pisCst, "49");
});

test("17. origem cadastral: NCM do produto, CFOP/CSOSN/PIS/COFINS do grupo; emissão usa snapshot; sem fallback 07/20%", () => {
  const emitir = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  const item = fonte("lib/fiscal/geranet/montar-item.ts");
  const formProduto = fonte("app/produtos/produto-fiscal-form.tsx");
  const formGrupo = fonte("app/produtos/grupos-fiscais/grupo-fiscal-form.tsx");

  assert.match(formProduto, /produtos_fiscal/);
  assert.match(formProduto, /NCM, CEST e origem pertencem ao produto/);
  assert.match(formGrupo, /name="cfop_interno"/);
  assert.match(formGrupo, /name="icms_cst_csosn"/);
  assert.match(formGrupo, /name="pis_cst"/);
  assert.match(formGrupo, /name="cofins_cst"/);

  assert.match(emitir, /resolverTributacaoItemVenda/);
  assert.match(emitir, /tributacao\.valor\.ncm/);
  assert.match(emitir, /tributacao\.valor\.cfop/);
  assert.match(emitir, /tributacao\.valor\.icms/);
  assert.match(emitir, /tributacao\.valor\.pis/);
  assert.match(emitir, /tributacao\.valor\.cofins/);
  assert.doesNotMatch(emitir, /itemVenda\.ncm \?\?/);
  assert.doesNotMatch(emitir, /itemVenda\.cfop \?\?/);
  assert.doesNotMatch(emitir, /itemVenda\.icms_cst_csosn \?\?/);
  assert.doesNotMatch(emitir, /itemVenda\.pis_cst \?\?/);
  assert.doesNotMatch(emitir, /itemVenda\.cofins_cst \?\?/);

  assert.doesNotMatch(emitir, /\?\? ["']07["']/);
  assert.doesNotMatch(item, /\b20\b.*vTotTrib|vTotTrib.*\b20\b/);
  assert.doesNotMatch(item, /hardcode|IBPT_FIXO|percentual = 20/);
  assert.match(item, /origemProduto\s*\?\?\s*"0"/);
  assert.match(item, /VTOTTRIB_CALCULO_AUTOMATICO_GERANET/);
  assert.doesNotMatch(item, /modelo === ["']65["']/);
  assert.match(
    fonte("lib/fiscal/geranet/montar-payload-nfce.ts"),
    /ibptAutomatico:\s*IBPT_AUTOMATICO_GERANET/
  );
  assert.match(
    fonte("lib/fiscal/geranet/montar-payload-nfe.ts"),
    /ibptAutomatico:\s*IBPT_AUTOMATICO_GERANET/
  );
});

test("18. NF-e 55 reutiliza o mesmo contrato IBPT automático da NFC-e 65", () => {
  const { item } = montarCaso({
    valorUnitario: 55,
    desconto: 50,
    modelo: "55",
  });
  const payload = payloadNfe(item, { valor: 5 });
  const nfeItem = payload.nfe.itens[0] as typeof item;

  assert.equal(item.valorTotal, "55.00");
  assert.equal(Number(item.desconto).toFixed(2), "50.00");
  assert.equal(item.vTotTrib, "");
  assert.equal(payload.nfe.empresa.ibptAutomatico, "sim");
  assert.equal(nfeItem.vTotTrib, "");
  assert.equal(payload.nfe.modelo, "55");
  assert.equal(payload.nfe.ambiente, "2");
  assert.equal(payload.nfe.pagamento.detalhamento[0].valor, 5);
  assert.equal(payload.nfe.pagamento.troco, 0);
  assert.equal(item.ncmProduto, NCM_CASO);
  assert.equal(item.cest, "");
  assert.equal(item.cfop, CFOP_CASO);
  assert.equal(item.icmsCsosn, CSOSN_CASO);
  assert.equal(item.pisCst, PIS_CASO);
  assert.equal(item.cofinsCst, COFINS_CASO);
  assert.equal(
    valorTotalNotaGeranet([
      {
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        desconto: item.desconto,
        valorTotal: item.valorTotal,
      },
    ]),
    "5.00"
  );

  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const emitirAvulsa = fonte("app/api/fiscal/geranet/nfe55-emitir/route.ts");
  assert.match(emitirVenda, /montarItemGeranet/);
  assert.match(emitirVenda, /montarPayloadNfeGeranet/);
  assert.match(emitirAvulsa, /montarItemGeranet/);
  assert.match(emitirAvulsa, /montarPayloadNfeGeranet/);
  assert.doesNotMatch(emitirVenda, /vTotTrib|ibptAutomatico|IBPT_FIXO/);
  assert.doesNotMatch(emitirAvulsa, /vTotTrib|ibptAutomatico|IBPT_FIXO/);
});

test("19. NF-e 55 sem desconto: bruto=líquido; mesmo contrato automático", () => {
  const { item, valorBrutoItem, valorLiquidoFiscal } = montarCaso({
    valorUnitario: 55,
    desconto: 0,
    modelo: "55",
  });
  const payload = payloadNfe(item, { valor: 55 });

  assert.equal(item.valorTotal, "55.00");
  assert.equal(Number(item.desconto), 0);
  assert.equal(valorBrutoItem, 55);
  assert.equal(valorLiquidoFiscal, 55);
  assert.equal(item.vTotTrib, "");
  assert.equal(payload.nfe.empresa.ibptAutomatico, "sim");
  assert.equal(
    valorTotalNotaGeranet([
      {
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        desconto: item.desconto,
        valorTotal: item.valorTotal,
      },
    ]),
    "55.00"
  );
  assert.equal(payload.nfe.pagamento.detalhamento[0].valor, 55);
  assert.equal(item.icmsCsosn, CSOSN_CASO);
  assert.equal(item.pisCst, PIS_CASO);
  assert.equal(item.cofinsCst, COFINS_CASO);
});
