import assert from "node:assert/strict";
import { test } from "node:test";

import { ocultarSegredosPayloadNfe } from "@/lib/fiscal/geranet/montar-payload-nfe";
import type { ItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  camposFiscaisEquivalentesNfe,
  CODIGO_NUMERICO_PREVIEW_NFE,
  montarPayloadNfeVendaPreparada,
  NUMERO_NOTA_PREVIEW_NFE,
  type PreparadaParaPayloadNfeVenda,
} from "@/lib/fiscal/nfe55/payload-nfe-venda";

const rotaPreview = fonte("app/api/fiscal/geranet/nfe-preview-venda/route.ts");
const rotaEmissao = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
const preparar = fonte("lib/fiscal/nfe55/preparar-nfe-venda.ts");
const payloadFonte = fonte("lib/fiscal/nfe55/payload-nfe-venda.ts");

test("preview não reserva, não grava tentativa, não transmite e não grava emissão", () => {
  assert.match(rotaPreview, /modo:\s*"preview"/);
  assert.match(rotaPreview, /prepararNfeVenda/);
  assert.match(rotaPreview, /ocultarSegredosPayloadNfe/);
  assert.match(rotaPreview, /NUMERO_NOTA_PREVIEW_NFE/);
  assert.match(rotaPreview, /CODIGO_NUMERICO_PREVIEW_NFE/);
  assert.doesNotMatch(rotaPreview, /rpc_reservar_emissao_fiscal/);
  assert.doesNotMatch(rotaPreview, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(rotaPreview, /chamarGeranet/);
  assert.doesNotMatch(rotaPreview, /fiscal_emissoes/);
  assert.doesNotMatch(rotaPreview, /\.update\(/);
  assert.doesNotMatch(rotaPreview, /snapshot_fiscal/);
  assert.doesNotMatch(rotaPreview, /proximo_numero/);
  assert.doesNotMatch(preparar, /rpc_reservar_emissao_fiscal/);
  assert.doesNotMatch(preparar, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(preparar, /chamarGeranet/);
  assert.doesNotMatch(preparar, /fiscal_emissoes/);
  assert.doesNotMatch(preparar, /from\("vendas_itens"\)[\s\S]{0,80}\.update/);
});

test("gravação de snapshot do destinatário fica só no modo emissão", () => {
  const bloco = preparar.slice(
    preparar.indexOf('modo === "emissao" &&'),
    preparar.indexOf("let pagamentosConfirmados")
  );
  assert.match(bloco, /\.from\("vendas"\)/);
  assert.match(bloco, /snapshot_fiscal/);
  assert.match(bloco, /\.from\("fiscal_operacoes"\)/);
  assert.equal(preparar.indexOf('modo === "emissao" &&') < preparar.indexOf('.from("vendas")\n          .update'), true);
});

test("emissão reutiliza a preparação e só depois reserva, grava snapshot e transmite", () => {
  assert.match(rotaEmissao, /modo:\s*"emissao"/);
  assert.match(rotaEmissao, /prepararNfeVenda/);
  assert.match(rotaEmissao, /montarPayloadNfeVendaPreparada/);
  assert.match(rotaEmissao, /rpc_reservar_emissao_fiscal/);
  assert.match(rotaEmissao, /claimTentativaEmissaoFiscal/);
  assert.match(rotaEmissao, /chamarGeranet/);
  assert.match(rotaEmissao, /from\(\s*"vendas_itens"\s*\)/);
  const posPreparar = rotaEmissao.indexOf("prepararNfeVenda");
  const posSnapshotItem = rotaEmissao.indexOf('from(\n                "vendas_itens"\n              )\n              .update');
  const posReserva = rotaEmissao.indexOf("rpc_reservar_emissao_fiscal");
  const posClaim = rotaEmissao.indexOf("await claimTentativaEmissaoFiscal");
  const posGeranet = rotaEmissao.indexOf("await chamarGeranet");
  assert.ok(posPreparar >= 0 && posPreparar < posReserva);
  assert.ok(posSnapshotItem > posPreparar && posSnapshotItem < posReserva);
  assert.ok(posReserva < posClaim && posClaim < posGeranet);
  assert.match(payloadFonte, /montarPayloadNfeGeranet/);
  assert.match(payloadFonte, /montarItemGeranet|itensFiscais/);
  assert.match(preparar, /montarItemGeranet/);
  assert.match(preparar, /resolverTributacaoItemVenda/);
  assert.match(preparar, /resolverCfopEfetivo/);
  assert.match(preparar, /mapearDetalhamentoFiscalNfe55/);
  assert.match(preparar, /faturaParaPayloadGeranet/);
  assert.match(payloadFonte, /aplicarValorTotalNotaGeranet/);
});

function preparadaBase(): PreparadaParaPayloadNfeVenda {
  const item = {
    numeroPedido: "",
    numeroItemPedido: "",
    desconto: "0.00000000",
    frete: "0.00000000",
    seguro: "0.00000000",
    outro: "0.00000000",
    quantidade: "1.00000000",
    valorUnitario: "10.00000000",
    valorTotal: "10.00",
    vTotTrib: "",
    informacaoAdicional: "",
    ncmProduto: "85171231",
    cest: "2115600",
    tipoItem: "00",
    eanProduto: "SEM GTIN",
    codigoProduto: "1",
    nomeProduto: "Produto",
    cfop: "5102",
    unidadeMedidaProduto: "UN",
    origemProduto: "0",
    icmsCsosn: "102",
    pisCst: "49",
    pisAliquota: "0.0000",
    cofinsCst: "49",
    cofinsAliquota: "0.0000",
    federaisRetido: "nao",
    aliquotaInss: "0.0000",
    aliquotaIrrf: "0.0000",
    aliquotaCsll: "0.0000",
  } as ItemGeranet;

  return {
    empresaId: "empresa-a",
    empresa: {
      cnpj: "42741754000142",
      razao_social: "EMPRESA TESTE",
      nome_fantasia: "TESTE",
    },
    fiscal: {
      telefone: "65999999999",
      email: "fiscal@teste.com",
      logradouro: "Rua A",
      numero: "1",
      complemento: "",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigo_municipio_ibge: "5103403",
      cep: "78000000",
      tipo_atividade: "3",
      informacao_complementar_padrao: "Padrao da empresa",
      indicador_presenca_padrao: "1",
      indicativo_intermediador_padrao: "0",
    },
    cliente: {
      tipo_pessoa: "F",
      inscricao_estadual: "",
      nome: "Cliente Real",
      nome_fantasia: "",
      telefone: "",
      email: "",
      logradouro: "Rua B",
      numero: "2",
      complemento: "",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigo_municipio_ibge: "5103403",
      cep: "78000000",
    },
    documento: "52998224725",
    clienteUf: "MT",
    indicadorIe: "9",
    consumidorFinal: "1",
    ieEmitente: "138856729",
    ufEmitente: "MT",
    crt: 1,
    ambiente: "2",
    fusoHorario: "America/Cuiaba",
    dataHoraFiscal: "2026-08-19 12:00:00",
    snapshotOperacao: null,
    operacaoVenda: null,
    natureza: {
      id: "natureza-1",
      descricao: "Venda",
      fin_nfe: "1",
      tp_nf: "1",
    },
    modalidadeFrete: "9",
    venda: { numero: 83 },
    transporteResolvido: { dados: { mod_frete: "9" } },
    trocoVenda: 0,
    detalhamentoFiscal: [{ tipo: "01", valor: 10, indicadorPagamento: "0" }],
    faturaGeranet: null,
    itensFiscais: [item],
    csrtResult: { data: null },
    certificado: "CERTIFICADO-SECRETO",
    senhaCertificado: "SENHA-SECRETA",
  };
}

test("preview e emissão produzem os mesmos campos fiscais antes da reserva", () => {
  const preparada = preparadaBase();
  const cabecalho = {
    dataSaida: "2026-08-19 12:00:00",
    dataEmissao: "2026-08-19 12:00:00",
    indicadorPresenca: "1",
    indicativoIntermediador: "0",
    tpNf: "1" as const,
  };
  const identidade = {
    descricao: "Venda",
    tpNf: "1" as const,
    finNfe: "1" as const,
  };
  const previa = montarPayloadNfeVendaPreparada({
    preparada,
    logomarca: null,
    serie: 1,
    numeroNota: NUMERO_NOTA_PREVIEW_NFE,
    codigoNumerico: CODIGO_NUMERICO_PREVIEW_NFE,
    ...cabecalho,
    identidade,
  });
  const emissao = montarPayloadNfeVendaPreparada({
    preparada,
    logomarca: null,
    serie: 1,
    numeroNota: 159,
    codigoNumerico: "12345678",
    ...cabecalho,
    identidade,
  });

  assert.equal(previa.payload.nfe.numeroNotaEmitir, "0");
  assert.equal(previa.payload.nfe.codigoNumerico, CODIGO_NUMERICO_PREVIEW_NFE);
  assert.equal(emissao.payload.nfe.numeroNotaEmitir, "159");
  assert.equal(emissao.payload.nfe.codigoNumerico, "12345678");
  assert.deepEqual(
    camposFiscaisEquivalentesNfe(previa.payload),
    camposFiscaisEquivalentesNfe(emissao.payload)
  );
  const fiscal = camposFiscaisEquivalentesNfe(previa.payload);
  const cliente = fiscal.cliente as { cpf?: string; razaoSocial?: string };
  const itens = fiscal.itens as Array<{ cfop?: string; ncmProduto?: string; icmsCsosn?: string }>;
  assert.equal(cliente.cpf, "52998224725");
  assert.equal(itens[0]?.cfop, "5102");
  assert.equal(itens[0]?.ncmProduto, "85171231");
  assert.equal(itens[0]?.icmsCsosn, "102");
  assert.deepEqual(fiscal.pagamento, emissao.payload.nfe.pagamento);
  assert.equal(
    (fiscal as { valorTotal?: string }).valorTotal,
    (emissao.payload.nfe as { valorTotal?: string }).valorTotal
  );
  assert.equal(String(previa.payload.certificadoDigital).includes("SECRETO"), true);
  const seguro = ocultarSegredosPayloadNfe(previa.payload) as {
    certificadoDigital?: string;
    senhaCertificadoDigital?: string;
  };
  assert.equal(seguro.certificadoDigital, "[REDACTED]");
  assert.equal(seguro.senhaCertificadoDigital, "[REDACTED]");
});
