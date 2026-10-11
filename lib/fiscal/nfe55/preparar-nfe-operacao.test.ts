import assert from "node:assert/strict";
import { test } from "node:test";

import type { ItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import { ocultarSegredosPayloadNfe } from "@/lib/fiscal/geranet/montar-payload-nfe";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  camposFiscaisEquivalentesNfe,
  montarPayloadNfeOperacaoPreparada,
  type PreparadaParaPayloadNfeOperacao,
} from "@/lib/fiscal/nfe55/payload-nfe-operacao";
import { resolverCfopEfetivo } from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  CODIGO_NUMERICO_PREVIEW_NFE,
  NUMERO_NOTA_PREVIEW_NFE,
} from "@/lib/fiscal/nfe55/payload-nfe-venda";

const preview = fonte("app/api/fiscal/geranet/nfe-preview-operacao/route.ts");
const preparar = fonte("lib/fiscal/nfe55/preparar-nfe-operacao.ts");
const emitir = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");

test("preview por operação não transmite, não reserva, não cria venda nem emissão", () => {
  assert.match(preview, /modo:\s*"preview"/);
  assert.match(preview, /prepararNfeOperacao/);
  assert.match(preview, /ocultarSegredosPayloadNfe/);
  assert.match(preview, /NUMERO_NOTA_PREVIEW_NFE/);
  assert.match(preview, /CODIGO_NUMERICO_PREVIEW_NFE/);
  assert.doesNotMatch(preview, /rpc_reservar_emissao_fiscal/);
  assert.doesNotMatch(preview, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(preview, /chamarGeranet/);
  assert.doesNotMatch(preview, /fiscal_emissoes/);
  assert.doesNotMatch(preview, /rpc_finalizar_venda_pdv/);
  assert.doesNotMatch(preview, /emitirVendaOperacaoFiscal/);
  assert.doesNotMatch(preview, /from\("vendas"\)/);
  assert.doesNotMatch(preview, /from\("vendas_itens"\)/);
  assert.doesNotMatch(preview, /\.update\(/);
  assert.doesNotMatch(preparar, /rpc_reservar_emissao_fiscal/);
  assert.doesNotMatch(preparar, /claimTentativaEmissaoFiscal/);
  assert.doesNotMatch(preparar, /chamarGeranet/);
  assert.doesNotMatch(preparar, /fiscal_emissoes/);
  assert.doesNotMatch(preparar, /rpc_finalizar_venda_pdv/);
  assert.doesNotMatch(preparar, /from\("vendas"\)/);
  assert.doesNotMatch(preparar, /from\("vendas_itens"\)/);
  assert.match(preparar, /modo === "emissao"/);
  assert.match(preparar, /fiscal_operacoes_itens/);
  assert.match(preparar, /valorUnitario: item\.valor_unitario/);
  assert.match(preparar, /precoVenda: item\.valor_unitario/);
});

test("emissão da operação usa o mesmo motor e só depois reserva e transmite", () => {
  const posPreparar = emitir.indexOf("prepararNfeOperacao");
  const posReserva = emitir.indexOf("rpc_reservar_emissao_fiscal");
  const posClaim = emitir.indexOf("await claimTentativaEmissaoFiscal");
  const posGeranet = emitir.indexOf("await chamarGeranet");
  assert.ok(posPreparar >= 0 && posPreparar < posReserva);
  assert.ok(posReserva < posClaim && posClaim < posGeranet);
  assert.match(emitir, /modo:\s*"emissao"/);
  assert.match(emitir, /montarPayloadNfeOperacaoPreparada/);
});

test("formulário visualiza por operacaoId depois de salvar o rascunho", () => {
  assert.match(form, /VisualizarNfeOperacaoButton/);
  assert.match(form, /salvarAntesDaPrevia/);
  assert.match(form, /persistirRascunho\(\)/);
  assert.match(form, /atualizarItemOperacaoFiscal/);
  assert.doesNotMatch(
    form.slice(form.indexOf("async function salvarAntesDaPrevia"), form.indexOf("function emitir")),
    /nfe-emitir-operacao|nfe-emitir-venda|prepararVendaParaEmissaoNfe/
  );
});

function preparada(valorUnitario: string): PreparadaParaPayloadNfeOperacao {
  const item = {
    numeroPedido: "",
    numeroItemPedido: "",
    desconto: "0.00000000",
    frete: "0.00000000",
    seguro: "0.00000000",
    outro: "0.00000000",
    quantidade: "1.00000000",
    valorUnitario,
    valorTotal: "120.00",
    vTotTrib: "",
    informacaoAdicional: "",
    ncmProduto: "85171231",
    cest: "",
    tipoItem: "00",
    eanProduto: "SEM GTIN",
    codigoProduto: "1",
    nomeProduto: "Produto X",
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
    operacao: {
      snapshot_fiscal: {},
      fin_nfe: "1",
      tp_nf: "1",
      informacao_complementar_usuario: "",
      informacao_adicional_fisco: "",
    },
    empresa: {
      cnpj: "42741754000142",
      razao_social: "EMPRESA TESTE",
      nome_fantasia: "TESTE",
    },
    fiscal: {
      telefone: "",
      email: "",
      logradouro: "Rua A",
      numero: "1",
      complemento: "",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigo_municipio_ibge: "5103403",
      cep: "78000000",
      tipo_atividade: "3",
      informacao_complementar_padrao: "",
      indicador_presenca_padrao: "1",
      indicativo_intermediador_padrao: "0",
    },
    crt: "1",
    ambiente: "2",
    ufEmitente: "MT",
    ieEmitente: "123456789",
    certificado: "CERTIFICADO",
    senhaCertificado: "SENHA",
    destinatario: {
      cpf: "12345678901",
      cnpj: "",
      inscricaoEstadual: "",
      razaoSocial: "CLIENTE",
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
    naturezaCongelada: {
      id: "nat-1",
      descricao: "Venda",
      tp_nf: "1",
      fin_nfe: "1",
    },
    transporte: { mod_frete: "9" },
    itensFiscais: [item],
    detalhamentoFiscal: [{ tipo: "01", valor: 120, indicadorPagamento: "0" }],
    faturaGeranet: null,
    troco: 0,
    csrt: null,
  };
}

test("item alterado para 120 aparece no preview e coincide com a emissão antes do número", () => {
  const base = preparada("120.00000000");
  const previewPayload = montarPayloadNfeOperacaoPreparada({
    preparada: base,
    logomarca: null,
    serie: 1,
    numeroNota: NUMERO_NOTA_PREVIEW_NFE,
    codigoNumerico: CODIGO_NUMERICO_PREVIEW_NFE,
    dataHora: "2026-10-02 10:00:00",
    fusoHorario: "America/Cuiaba",
  });
  const emissaoPayload = montarPayloadNfeOperacaoPreparada({
    preparada: base,
    logomarca: null,
    serie: 1,
    numeroNota: 159,
    codigoNumerico: "12345678",
    dataHora: "2026-10-02 10:00:00",
    fusoHorario: "America/Cuiaba",
  });
  const item = previewPayload.payload.nfe.itens?.[0] as { valorUnitario?: string; valorTotal?: string };
  assert.equal(item?.valorUnitario, "120.00000000");
  assert.equal(item?.valorTotal, "120.00");
  assert.deepEqual(
    camposFiscaisEquivalentesNfe(previewPayload.payload),
    camposFiscaisEquivalentesNfe(emissaoPayload.payload)
  );
  const limpo = ocultarSegredosPayloadNfe(previewPayload.payload) as {
    certificadoDigital?: string;
    senhaCertificadoDigital?: string;
  };
  assert.equal(limpo.certificadoDigital, "[REDACTED]");
  assert.equal(limpo.senhaCertificadoDigital, "[REDACTED]");
});

const grupoVendas = {
  nome: "Vendas",
  cfopInterno: "5405",
  cfopInterestadual: "6102",
};

function resolverGrupoVenda(tipoDestino: "interna" | "interestadual", regras: Parameters<typeof resolverCfopEfetivo>[0]["regras"] = []) {
  return resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino,
    grupoFiscal: grupoVendas,
    naturezaId: "nat-venda",
    grupoFiscalId: "grupo-vendas",
    regras,
    empresaIdAtiva: "emp",
    naturezaPadrao: true,
    naturezaDescricao: "Venda de Mercadoria",
  });
}

test("preparar operação entrega cfop interno e interestadual do grupo ao resolver", () => {
  assert.match(preparar, /cfop_interno,\s*cfop_interestadual/);
  assert.match(preparar, /cfopInterno:\s*grupo\.cfop_interno/);
  assert.match(preparar, /cfopInterestadual:\s*grupo\.cfop_interestadual/);

  const interna = resolverGrupoVenda("interna");
  assert.equal(interna.ok, true);
  if (interna.ok) assert.equal(interna.cfop, "5405");

  const interestadual = resolverGrupoVenda("interestadual");
  assert.equal(interestadual.ok, true);
  if (interestadual.ok) assert.equal(interestadual.cfop, "6102");

  const semCfop = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    grupoFiscal: { nome: "Vendas" },
    naturezaId: "nat-venda",
    grupoFiscalId: "grupo-vendas",
    regras: [],
    empresaIdAtiva: "emp",
    naturezaPadrao: true,
    naturezaDescricao: "Venda de Mercadoria",
  });
  assert.equal(semCfop.ok, false);
  if (!semCfop.ok) {
    assert.match(semCfop.mensagem, /CFOP de venda não encontrado no grupo fiscal/);
  }

  const comRegra = resolverGrupoVenda("interna", [
    {
      empresaId: "emp",
      naturezaId: "nat-venda",
      grupoFiscalId: "grupo-vendas",
      tipoDestino: "interna",
      cfop: "5102",
      ativo: true,
    },
  ]);
  assert.equal(comRegra.ok, true);
  if (comRegra.ok) {
    assert.equal(comRegra.cfop, "5102");
    assert.equal(comRegra.origem, "regra_natureza");
  }
});

test("preview da operação não depende de vendaId", () => {
  assert.match(preview, /operacaoId/);
  assert.doesNotMatch(preview, /vendaId/);
  assert.match(preparar, /tipo !== "bonificacao" && tipo !== "transferencia" && tipo !== "venda"/);
});
