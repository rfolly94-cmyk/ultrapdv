import { aplicarValorTotalNotaGeranet } from "@/lib/fiscal/geranet/diagnostico-total-nota";
import type { ItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import {
  montarPayloadNfeGeranet,
  type FaturaNfeGeranet,
  type PagamentoNfeGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfe";
import { enderecoEntregaDoSnapshotParaGeranet } from "@/lib/fiscal/nfe55/endereco-entrega";
import { autorizadosXmlDoSnapshotParaGeranet } from "@/lib/fiscal/nfe55/autorizados-xml";
import { responsavelTecnicoDoCadastroFiscal } from "@/lib/fiscal/nfe55/responsavel-tecnico";
import {
  montarInformacaoAdicionalFisco,
  montarInformacaoComplementarNfe,
  textoUsuarioInfAdFiscoNfe,
  textoUsuarioInfCplNfe,
} from "@/lib/fiscal/nfe55/infos-adicionais";
import { transporteNfeParaPayloadGeranet } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import { resolverPayloadCabecalhoNfe } from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import { assertIdentidadeFiscalNfe } from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  camposFiscaisEquivalentesNfe,
} from "@/lib/fiscal/nfe55/payload-nfe-venda";

export { camposFiscaisEquivalentesNfe };

export type PreparadaParaPayloadNfeOperacao = {
  operacao: {
    snapshot_fiscal?: unknown;
    fin_nfe?: unknown;
    tp_nf?: unknown;
    informacao_complementar_usuario?: unknown;
    informacao_adicional_fisco?: unknown;
  };
  empresa: {
    cnpj?: unknown;
    razao_social?: unknown;
    nome_fantasia?: unknown;
  };
    fiscal: {
      empresa_id?: string | null;
      fuso_horario?: string | null;
      telefone?: unknown;
      email?: unknown;
    logradouro?: unknown;
    numero?: unknown;
    complemento?: unknown;
    bairro?: unknown;
    municipio?: unknown;
    codigo_municipio_ibge?: unknown;
    cep?: unknown;
    tipo_atividade?: unknown;
    informacao_complementar_padrao?: unknown;
    indicador_presenca_padrao?: unknown;
    indicativo_intermediador_padrao?: unknown;
    responsavel_tecnico_cnpj?: unknown;
    responsavel_tecnico_contato?: unknown;
    responsavel_tecnico_email?: unknown;
    responsavel_tecnico_fone?: unknown;
    responsavel_tecnico_id_csrt?: unknown;
  };
  crt: string | number;
  ambiente: "1" | "2";
  ufEmitente: string;
  ieEmitente: string;
  certificado: string;
  senhaCertificado: string;
  destinatario: Record<string, unknown>;
  naturezaCongelada: {
    id: string;
    descricao: string;
    tp_nf: string;
    fin_nfe: string;
  };
  transporte: unknown;
  itensFiscais: ItemGeranet[];
  detalhamentoFiscal: PagamentoNfeGeranet["detalhamento"];
  faturaGeranet: FaturaNfeGeranet | null;
  troco: number;
  csrt: string | null | undefined;
};

export function montarPayloadNfeOperacaoPreparada(input: {
  preparada: PreparadaParaPayloadNfeOperacao;
  logomarca: string | null | undefined;
  serie: number | string;
  numeroNota: number | string;
  codigoNumerico: string;
  dataHora: string;
  fusoHorario: string;
}) {
  const p = input.preparada;
  const identidade = assertIdentidadeFiscalNfe({
    naturezaId: p.naturezaCongelada.id,
    descricao: p.naturezaCongelada.descricao,
    tpNf: p.naturezaCongelada.tp_nf,
    finNfe: p.naturezaCongelada.fin_nfe,
  });
  const cabecalhoNfe = resolverPayloadCabecalhoNfe({
    snapshot: p.operacao.snapshot_fiscal,
    finNfeOperacao: (p.operacao.fin_nfe ?? null) as string | null,
    finNfeNatureza: identidade.finNfe,
    tpNfOperacao: (p.operacao.tp_nf ?? null) as string | null,
    indicadorPresencaPadraoEmpresa: (p.fiscal.indicador_presenca_padrao ?? null) as string | null,
    indicativoIntermediadorPadraoEmpresa: (p.fiscal.indicativo_intermediador_padrao ?? null) as string | null,
    dataHoraEmissao: input.dataHora,
  });
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
      logradouro: String(p.fiscal.logradouro ?? ""),
      numero: String(p.fiscal.numero ?? ""),
      complemento: (p.fiscal.complemento ?? null) as string | null,
      bairro: String(p.fiscal.bairro ?? ""),
      municipio: String(p.fiscal.municipio ?? ""),
      codigoMunicipio: String(p.fiscal.codigo_municipio_ibge ?? ""),
      uf: p.ufEmitente,
      cep: String(p.fiscal.cep ?? ""),
      codigoRegimeTributario: p.crt as "1" | "2" | "3" | "4",
      tipoAtividade: (p.fiscal.tipo_atividade ?? "3") as "1" | "2" | "3",
      informacaoComplementar: p.fiscal.informacao_complementar_padrao as string | null,
    },
    destinatario: {
      ...(p.destinatario as {
        cpf?: string;
        cnpj?: string;
        inscricaoEstadual: string;
        razaoSocial: string;
        nomeFantasia?: string | null;
        consumidorFinal: "0" | "1";
        indicadorIEdestinatario: "1" | "2" | "9";
        telefone?: string | null;
        email?: string | null;
        logradouro: string;
        numero: string;
        complemento?: string | null;
        bairro: string;
        municipio: string;
        codigoMunicipio: string;
        uf: string;
        cep: string;
      }),
      codigoPais: "1058",
      nomePais: "Brasil",
      entrega: enderecoEntregaDoSnapshotParaGeranet(p.operacao.snapshot_fiscal),
    },
    autorizadosXml: autorizadosXmlDoSnapshotParaGeranet(p.operacao.snapshot_fiscal),
    responsavelTecnico: responsavelTecnicoDoCadastroFiscal({
      fiscal: p.fiscal,
      csrt: p.csrt,
    }),
    config: {
      serie: input.serie,
      numeroNota: input.numeroNota,
      codigoNumerico: input.codigoNumerico,
      dataSaida: cabecalhoNfe.dataSaida,
      dataEmissao: cabecalhoNfe.dataEmissao,
      fusoHorario: input.fusoHorario,
      indicadorPresenca: cabecalhoNfe.indicadorPresenca || "9",
      indicativoIntermediador: cabecalhoNfe.indicativoIntermediador || "0",
      naturezaOperacao: identidade.descricao,
      tipo: (cabecalhoNfe.tpNf || identidade.tpNf) as "0" | "1",
      finalidade: (cabecalhoNfe.finNfe || identidade.finNfe) as "1" | "2" | "3" | "4",
      frete: ((p.transporte as { mod_frete?: string } | null)?.mod_frete ?? "9") as "0" | "1" | "2" | "3" | "4" | "9",
      informacaoAdicionalFisco: montarInformacaoAdicionalFisco({
        textoUsuario: textoUsuarioInfAdFiscoNfe({
          snapshot: p.operacao.snapshot_fiscal,
          coluna: p.operacao.informacao_adicional_fisco as string | null,
        }),
      }),
      informacaoComplementar: montarInformacaoComplementarNfe({
        textosAutomaticos: [],
        padraoEmpresa: p.fiscal.informacao_complementar_padrao as string | null,
        textoUsuario: textoUsuarioInfCplNfe({
          snapshot: p.operacao.snapshot_fiscal,
          coluna: p.operacao.informacao_complementar_usuario as string | null,
        }),
      }),
    },
    transporte: transporteNfeParaPayloadGeranet(p.transporte),
    pagamento: {
      troco: p.troco,
      detalhamento: p.detalhamentoFiscal,
    },
    fatura: p.faturaGeranet,
    itens: p.itensFiscais,
  });
  aplicarValorTotalNotaGeranet({
    modelo: "55",
    nfe: payload.nfe,
    itensFiscais: p.itensFiscais,
  });
  return { payload, identidade };
}
