import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";

export const STATUS_OPERACAO_FISCAL = [
  "rascunho",
  "pronta_para_verificacao",
  "pronta_para_emissao",
  "enviando",
  "aguardando_reconciliacao",
  "autorizada",
  "aguardando_saida",
  "em_transito",
  "recebida",
  "concluida",
  "rejeitada",
  "cancelada",
] as const;

export type StatusOperacaoFiscal = (typeof STATUS_OPERACAO_FISCAL)[number];

export const MENSAGEM_CANCELAMENTO_OPERACAO_COM_SAIDA =
  "Não é possível cancelar esta NF-e porque a saída de estoque já foi processada. O cancelamento fiscal não estorna automaticamente o estoque.";

export function bloqueioCancelamentoOperacaoFiscal(params: {
  saidaEstoqueProcessadaAt?: string | null;
  status?: string | null;
}) {
  const status = String(params.status ?? "");
  if (
    params.saidaEstoqueProcessadaAt ||
    status === "em_transito" ||
    status === "recebida" ||
    status === "concluida"
  ) {
    return MENSAGEM_CANCELAMENTO_OPERACAO_COM_SAIDA;
  }
  return null;
}

const ROTULOS: Record<StatusOperacaoFiscal, string> = {
  rascunho: "Rascunho",
  pronta_para_verificacao: "Pronta para verificação",
  pronta_para_emissao: "Pronta para emissão",
  enviando: "Enviando",
  aguardando_reconciliacao: "Aguardando reconciliação",
  autorizada: "Autorizada",
  aguardando_saida: "Aguardando saída",
  em_transito: "Em trânsito",
  recebida: "Recebida",
  concluida: "Concluída",
  rejeitada: "Rejeitada",
  cancelada: "Cancelada",
};

export function rotuloStatusOperacaoFiscal(status: string) {
  return ROTULOS[status as StatusOperacaoFiscal] ?? status;
}

export const STATUS_OPERACAO_PERMITE_EDICAO_DOCUMENTO = [
  "rascunho",
  "pronta_para_verificacao",
  "pronta_para_emissao",
  "rejeitada",
] as const;

const STATUS_OPERACAO_BLOQUEIA_EDICAO_DOCUMENTO = new Set([
  "enviando",
  "aguardando_reconciliacao",
  "autorizada",
  "aguardando_saida",
  "em_transito",
  "recebida",
  "concluida",
  "cancelada",
]);

export const MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL =
  "Esta NF-e não pode mais ser alterada: a transmissão já começou, o documento foi autorizado, cancelado ou está com situação fiscal pendente.";

export const MENSAGEM_AGUARDANDO_RECONCILIACAO_BLOQUEIA_EDICAO =
  "Esta NF-e está aguardando reconciliação. Todos os campos que alteram o documento fiscal ficam bloqueados.";

export const MENSAGEM_NUMERACAO_IMUTAVEL =
  "A numeração desta NF-e já foi reservada ou a transmissão já começou. Série e número não podem mais ser alterados.";

const STATUS_NUMERACAO_IMUTAVEL = new Set([
  "reservada",
  "enviando",
  "transmitindo_contingencia",
  "aguardando_transmissao_contingencia",
  "aguardando_reconciliacao",
  "autorizada",
  "rejeitada",
  "cancelada",
  "aguardando_inutilizacao",
  "inutilizada",
  "erro_comunicacao",
]);

export function operacaoPodeEditar(status: string) {
  return (
    status === "rascunho" ||
    status === "pronta_para_verificacao" ||
    status === "pronta_para_emissao" ||
    status === "rejeitada"
  );
}

export function statusAposEdicaoDocumentoFiscal(status: string) {
  return status === "pronta_para_emissao" ? "pronta_para_verificacao" : status;
}

/**
 * Fonte única de edição do documento NF-e (itens, pagamento, totais,
 * destinatário e demais campos comerciais/fiscais da operação).
 *
 * `venda_id` materializado NÃO congela a nota: só autorização confirmada
 * ou estado ambíguo / aguardando reconciliação.
 */
export function podeEditarDocumentoFiscal(input: {
  statusOperacao?: string | null;
  emissao?: Parameters<typeof resolverEstadoOperacionalDeEmissaoPersistida>[0] | null;
}): { permitido: boolean; motivo: string | null } {
  const statusOp = String(input.statusOperacao ?? "");
  if (statusOp === "aguardando_reconciliacao") {
    return {
      permitido: false,
      motivo: MENSAGEM_AGUARDANDO_RECONCILIACAO_BLOQUEIA_EDICAO,
    };
  }
  if (STATUS_OPERACAO_BLOQUEIA_EDICAO_DOCUMENTO.has(statusOp)) {
    return { permitido: false, motivo: MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL };
  }

  if (input.emissao) {
    const estado = resolverEstadoOperacionalDeEmissaoPersistida(input.emissao);
    if (estado.estado === "reservada") {
      if (
        statusOp &&
        !STATUS_OPERACAO_PERMITE_EDICAO_DOCUMENTO.includes(
          statusOp as (typeof STATUS_OPERACAO_PERMITE_EDICAO_DOCUMENTO)[number]
        )
      ) {
        return { permitido: false, motivo: MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL };
      }
      return { permitido: true, motivo: null };
    }
    if (
      estado.caso === "aguardando_reconciliacao" ||
      estado.documentoFiscalAmbiguo ||
      estado.estado === "ambigua"
    ) {
      return {
        permitido: false,
        motivo: MENSAGEM_AGUARDANDO_RECONCILIACAO_BLOQUEIA_EDICAO,
      };
    }
    if (estado.estado === "em_transmissao") {
      return { permitido: false, motivo: MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL };
    }
    if (estado.podeEditarFiscal) {
      return { permitido: true, motivo: null };
    }
    return { permitido: false, motivo: MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL };
  }

  if (
    statusOp &&
    !STATUS_OPERACAO_PERMITE_EDICAO_DOCUMENTO.includes(
      statusOp as (typeof STATUS_OPERACAO_PERMITE_EDICAO_DOCUMENTO)[number]
    )
  ) {
    return { permitido: false, motivo: MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL };
  }

  return { permitido: true, motivo: null };
}

export function podeEditarNumeracaoFiscal(input: {
  statusOperacao?: string | null;
  emissao?: Parameters<typeof resolverEstadoOperacionalDeEmissaoPersistida>[0] | null;
}): { permitido: boolean; motivo: string | null } {
  const documento = podeEditarDocumentoFiscal(input);
  if (!documento.permitido) {
    return documento;
  }
  const statusEmissao = String(input.emissao?.status ?? "");
  if (statusEmissao && STATUS_NUMERACAO_IMUTAVEL.has(statusEmissao)) {
    return { permitido: false, motivo: MENSAGEM_NUMERACAO_IMUTAVEL };
  }
  return { permitido: true, motivo: null };
}

export function operacaoPodeEmitir(status: string) {
  return status === "pronta_para_emissao" || status === "rejeitada";
}

export function operacaoPodeConfirmarSaida(status: string) {
  return status === "autorizada" || status === "aguardando_saida";
}

export function operacaoPodeConfirmarRecebimento(status: string) {
  return status === "em_transito";
}
