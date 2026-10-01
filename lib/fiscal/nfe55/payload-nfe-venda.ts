import { aplicarValorTotalNotaGeranet } from "@/lib/fiscal/geranet/diagnostico-total-nota";
import type { ItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import {
  montarPayloadNfeGeranet,
  type AmbienteNfeGeranet,
  type ConsumidorFinalNfe,
  type FaturaNfeGeranet,
  type IndicadorIeDestinatarioNfe,
  type ModalidadeFreteNfe,
  type PagamentoNfeGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  enderecoEntregaDoSnapshotParaGeranet,
} from "@/lib/fiscal/nfe55/endereco-entrega";
import {
  autorizadosXmlDoSnapshotParaGeranet,
} from "@/lib/fiscal/nfe55/autorizados-xml";
import { responsavelTecnicoDoCadastroFiscal } from "@/lib/fiscal/nfe55/responsavel-tecnico";
import {
  montarInformacaoAdicionalFisco,
  montarInformacaoComplementarNfe,
  textoUsuarioInfAdFiscoNfe,
  textoUsuarioInfCplNfe,
} from "@/lib/fiscal/nfe55/infos-adicionais";
import { ieDestinatarioParaGeranet } from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import { transporteNfeParaPayloadGeranet } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import { resolverPayloadCabecalhoNfe } from "@/lib/fiscal/nfe55/cabecalho-fiscal";

/** Número só em memória. Nunca persistir. */
export const NUMERO_NOTA_PREVIEW_NFE = 0;

/** Código numérico só em memória. Nunca persistir. */
export const CODIGO_NUMERICO_PREVIEW_NFE = "00000000";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export type PreparadaParaPayloadNfeVenda = {
  empresaId: string;
  empresa: {
    cnpj: unknown;
    razao_social: unknown;
    nome_fantasia: unknown;
  };
  fiscal: {
    telefone: unknown;
    email: unknown;
    logradouro: unknown;
    numero: unknown;
    complemento: unknown;
    bairro: unknown;
    municipio: unknown;
    codigo_municipio_ibge: unknown;
    cep: unknown;
    tipo_atividade: unknown;
    informacao_complementar_padrao: unknown;
    indicador_presenca_padrao: unknown;
    indicativo_intermediador_padrao: unknown;
  };
  cliente: {
    tipo_pessoa: unknown;
    inscricao_estadual: unknown;
    nome: unknown;
    nome_fantasia: unknown;
    telefone: unknown;
    email: unknown;
    logradouro: unknown;
    numero: unknown;
    complemento: unknown;
    bairro: unknown;
    municipio: unknown;
    codigo_municipio_ibge: unknown;
    cep: unknown;
  };
  documento: string;
  clienteUf: string;
  indicadorIe: IndicadorIeDestinatarioNfe;
  consumidorFinal: ConsumidorFinalNfe;
  ieEmitente: string;
  ufEmitente: string;
  crt: number;
  ambiente: AmbienteNfeGeranet;
  fusoHorario: string;
  dataHoraFiscal: string;
  certificado: string;
  senhaCertificado: string;
  snapshotOperacao: unknown;
  operacaoVenda: {
    empresa_id?: unknown;
    natureza_descricao?: unknown;
    fin_nfe?: unknown;
    tp_nf?: unknown;
    informacao_adicional_fisco?: unknown;
    informacao_complementar_usuario?: unknown;
  } | null;
  natureza: {
    id: string;
    descricao: unknown;
    fin_nfe: unknown;
    tp_nf: unknown;
  };
  modalidadeFrete: string;
  venda: { numero: unknown };
  transporteResolvido: { dados: unknown };
  trocoVenda: number;
  detalhamentoFiscal: PagamentoNfeGeranet["detalhamento"];
  faturaGeranet: FaturaNfeGeranet | null;
  itensFiscais: ItemGeranet[];
  csrtResult: { error?: unknown; data?: unknown };
};

export type CabecalhoPayloadNfeVenda = ReturnType<
  typeof resolverPayloadCabecalhoNfe
>;

export type IdentidadePayloadNfeVenda = {
  descricao: string;
  tpNf: "0" | "1";
  finNfe: "1" | "2" | "3" | "4";
};

function operacaoDaEmpresa(
  preparada: PreparadaParaPayloadNfeVenda
) {
  return (
    preparada.operacaoVenda != null &&
    String(preparada.operacaoVenda.empresa_id) ===
      String(preparada.empresaId)
  );
}

export function argumentosCabecalhoNfeVenda(
  preparada: PreparadaParaPayloadNfeVenda
) {
  const daEmpresa = operacaoDaEmpresa(preparada);
  return {
    snapshot: preparada.snapshotOperacao,
    finNfeOperacao: daEmpresa
      ? texto(preparada.operacaoVenda?.fin_nfe)
      : null,
    finNfeNatureza: texto(preparada.natureza.fin_nfe),
    tpNfOperacao: daEmpresa
      ? texto(preparada.operacaoVenda?.tp_nf)
      : null,
    indicadorPresencaPadraoEmpresa: texto(
      preparada.fiscal.indicador_presenca_padrao
    ),
    indicativoIntermediadorPadraoEmpresa: texto(
      preparada.fiscal.indicativo_intermediador_padrao
    ),
    dataHoraEmissao: preparada.dataHoraFiscal,
  };
}

export function argumentosIdentidadeInicialNfeVenda(
  preparada: PreparadaParaPayloadNfeVenda,
  cabecalhoNfe: CabecalhoPayloadNfeVenda
) {
  return {
    naturezaId: preparada.natureza.id,
    descricao:
      texto(preparada.operacaoVenda?.natureza_descricao) ||
      texto(preparada.natureza.descricao),
    tpNf: cabecalhoNfe.tpNf || texto(preparada.natureza.tp_nf),
    finNfe: cabecalhoNfe.finNfe || texto(preparada.natureza.fin_nfe),
  };
}

/**
 * Monta o contrato Geranet da NF-e da venda.
 * Não reserva número, não grava e não transmite.
 * numeroNota e codigoNumerico vêm do chamador:
 * reais na emissão, fictícios na prévia.
 */
export function montarPayloadNfeVendaPreparada(input: {
  preparada: PreparadaParaPayloadNfeVenda;
  logomarca?: string | null;
  serie: string | number;
  numeroNota: string | number;
  codigoNumerico: string;
  dataSaida: string;
  dataEmissao: string;
  indicadorPresenca: string;
  indicativoIntermediador: string;
  tpNf: string | null;
  identidade: IdentidadePayloadNfeVenda;
}) {
  const {
    preparada: p,
    identidade,
  } = input;
  const daEmpresa = operacaoDaEmpresa(p);
  const modalidadeFrete = p.modalidadeFrete as ModalidadeFreteNfe;

  const payload = montarPayloadNfeGeranet({
    ambiente: p.ambiente,
    ufEmitente: p.ufEmitente,
    certificadoDigital: p.certificado,
    senhaCertificadoDigital: p.senhaCertificado,
    emitente: {
      logomarca: input.logomarca,
      cnpj: p.empresa.cnpj as string,
      inscricaoEstadual: p.ieEmitente,
      razaoSocial: p.empresa.razao_social as string,
      nomeFantasia: p.empresa.nome_fantasia as string | null,
      telefone: p.fiscal.telefone as string | null,
      email: p.fiscal.email as string | null,
      logradouro: p.fiscal.logradouro as string,
      numero: p.fiscal.numero as string,
      complemento: p.fiscal.complemento as string | null,
      bairro: p.fiscal.bairro as string,
      municipio: p.fiscal.municipio as string,
      codigoMunicipio: p.fiscal.codigo_municipio_ibge as string,
      uf: p.ufEmitente,
      cep: p.fiscal.cep as string,
      codigoRegimeTributario: p.crt,
      tipoAtividade: (p.fiscal.tipo_atividade ?? "3") as string,
      informacaoComplementar: p.fiscal
        .informacao_complementar_padrao as string | null,
    },
    destinatario: {
      cpf: p.cliente.tipo_pessoa === "F" ? p.documento : "",
      cnpj: p.cliente.tipo_pessoa === "J" ? p.documento : "",
      inscricaoEstadual: ieDestinatarioParaGeranet({
        indicadorIEdestinatario: p.indicadorIe,
        inscricaoEstadual: p.cliente.inscricao_estadual as string | null,
      }),
      razaoSocial: p.cliente.nome as string,
      nomeFantasia: p.cliente.nome_fantasia as string | null,
      consumidorFinal: p.consumidorFinal,
      indicadorIEdestinatario: p.indicadorIe,
      telefone: p.cliente.telefone as string | null,
      email: p.cliente.email as string | null,
      logradouro: p.cliente.logradouro as string,
      numero: p.cliente.numero as string,
      complemento: p.cliente.complemento as string | null,
      bairro: p.cliente.bairro as string,
      municipio: p.cliente.municipio as string,
      codigoMunicipio: p.cliente.codigo_municipio_ibge as string,
      codigoPais: "1058",
      nomePais: "Brasil",
      uf: p.clienteUf,
      cep: p.cliente.cep as string,
      entrega: enderecoEntregaDoSnapshotParaGeranet(p.snapshotOperacao),
    },
    autorizadosXml: autorizadosXmlDoSnapshotParaGeranet(p.snapshotOperacao),
    responsavelTecnico: responsavelTecnicoDoCadastroFiscal({
      fiscal: p.fiscal,
      csrt: p.csrtResult.error
        ? null
        : (p.csrtResult.data as string | null | undefined),
    }),
    config: {
      serie: input.serie,
      numeroNota: input.numeroNota,
      codigoNumerico: input.codigoNumerico,
      dataSaida: input.dataSaida,
      dataEmissao: input.dataEmissao,
      fusoHorario: p.fusoHorario,
      indicadorPresenca: input.indicadorPresenca,
      indicativoIntermediador: input.indicativoIntermediador,
      naturezaOperacao: identidade.descricao,
      informacaoAdicionalFisco: montarInformacaoAdicionalFisco({
        textoUsuario: textoUsuarioInfAdFiscoNfe({
          snapshot: p.snapshotOperacao,
          coluna: daEmpresa
            ? (p.operacaoVenda?.informacao_adicional_fisco as string | null)
            : null,
        }),
      }),
      informacaoComplementar: montarInformacaoComplementarNfe({
        textosAutomaticos: [],
        padraoEmpresa: p.fiscal.informacao_complementar_padrao as string | null,
        textoUsuario: textoUsuarioInfCplNfe({
          snapshot: p.snapshotOperacao,
          coluna: daEmpresa
            ? (p.operacaoVenda?.informacao_complementar_usuario as
                | string
                | null)
            : null,
        }),
      }),
      tipo: (input.tpNf || identidade.tpNf) as "0" | "1",
      frete:
        modalidadeFrete,
      finalidade: identidade.finNfe,
      numeroVenda: p.venda.numero as string | number | null,
    },
    transporte: transporteNfeParaPayloadGeranet(p.transporteResolvido.dados),
    pagamento: {
      troco: p.trocoVenda,
      detalhamento: p.detalhamentoFiscal,
    },
    fatura: p.faturaGeranet,
    itens: p.itensFiscais,
  });

  const diagnosticoTotal = aplicarValorTotalNotaGeranet({
    modelo: "55",
    nfe: payload.nfe,
    itensFiscais: p.itensFiscais,
  });

  return { payload, diagnosticoTotal };
}

const CAMPOS_SO_DEPOIS_DA_RESERVA = new Set([
  "numeroNotaEmitir",
  "codigoNumerico",
  "serie",
]);

export function camposFiscaisEquivalentesNfe(
  payload: { nfe: Record<string, unknown> }
) {
  const nfe = { ...payload.nfe };
  for (const campo of CAMPOS_SO_DEPOIS_DA_RESERVA) {
    delete nfe[campo];
  }
  delete nfe.certificadoDigital;
  delete nfe.senhaCertificadoDigital;
  if (nfe.empresa && typeof nfe.empresa === "object") {
    const empresa = { ...(nfe.empresa as Record<string, unknown>) };
    delete empresa.serie;
    delete empresa.logomarca;
    nfe.empresa = empresa;
  }
  return nfe;
}
