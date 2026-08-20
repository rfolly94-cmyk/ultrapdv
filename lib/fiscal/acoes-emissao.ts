import { documentoPodeSerAberto } from "@/lib/fiscal/documento-fiscal";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";

export type EmissaoFiscalParaAcoes = {
  modelo?: string | null;
  status?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chaveAcesso?: string | null;
  geranetHttpStatus?: number | null;
  geranetSituacao?: string | null;
  erroComunicacao?: string | null;
};

export type AcoesEmissaoFiscal = {
  podeBaixarXml: boolean;
  podeBaixarPdf: boolean;
  podeCancelar: boolean;
  podeCartaCorrecao: boolean;
  podeConsultar: boolean;
  podeReconciliar: boolean;
  podeRetransmitir: boolean;
  mensagemBloqueioCancelamento: string | null;
};

export function resolverAcoesEmissaoFiscal(params: {
  emissao: EmissaoFiscalParaAcoes;
  statusEventoCancelamento?: string | null;
  politicaCancelamentoPermitido?: boolean | null;
  bloqueioCancelamentoOperacional?: string | null;
}): AcoesEmissaoFiscal {
  const modelo = String(params.emissao.modelo ?? "").trim();
  const status = String(params.emissao.status ?? "").trim();
  const nfeOuNfce = modelo === "55" || modelo === "65";
  const autorizada = status === "autorizada";
  const estado = resolverEstadoOperacionalDeEmissaoPersistida({
    modelo,
    status,
    classificacao: params.emissao.classificacao,
    resposta_resumo: params.emissao.resposta_resumo,
    cstat: params.emissao.cstat,
    motivo: params.emissao.motivo,
    protocolo: params.emissao.protocolo,
    chave_acesso: params.emissao.chaveAcesso,
    geranet_http_status: params.emissao.geranetHttpStatus,
    geranet_situacao: params.emissao.geranetSituacao,
    erro_comunicacao: params.emissao.erroComunicacao,
  });

  const bloqueioOperacional = String(
    params.bloqueioCancelamentoOperacional ?? ""
  ).trim();
  const cancelamentoConcluido =
    String(params.statusEventoCancelamento ?? "").trim() === "sucesso";

  return {
    podeBaixarXml: nfeOuNfce && documentoPodeSerAberto(status),
    podeBaixarPdf: nfeOuNfce && documentoPodeSerAberto(status),
    podeCancelar:
      nfeOuNfce && autorizada && !bloqueioOperacional && !cancelamentoConcluido,
    podeCartaCorrecao:
      modelo === "55" && autorizada && !cancelamentoConcluido,
    podeConsultar: nfeOuNfce && estado.podeConsultar,
    podeReconciliar: estado.podeReconciliar,
    podeRetransmitir: estado.podeRetry,
    mensagemBloqueioCancelamento: bloqueioOperacional || null,
  };
}

export function hrefOrigemEmissaoFiscal(
  origemTipo?: string | null,
  origemId?: string | null
) {
  const tipo = String(origemTipo ?? "").trim();
  const id = String(origemId ?? "").trim();
  if (!id) {
    return null;
  }
  if (tipo === "venda") {
    return `/vendas/${id}`;
  }
  if (tipo === "devolucao_fornecedor") {
    return `/fiscal/entradas/devolucoes/${id}`;
  }
  if (tipo === "operacao_fiscal") {
    return hrefEdicaoOperacaoFiscal(id);
  }
  return null;
}

export function hrefEdicaoOperacaoFiscal(operacaoId: string) {
  const id = String(operacaoId ?? "").trim();
  if (!id) {
    return "/fiscal/nfe/nova";
  }
  return `/fiscal/nfe/${encodeURIComponent(id)}/editar`;
}

export function rotuloOrigemEmissaoFiscal(origemTipo?: string | null) {
  const tipo = String(origemTipo ?? "").trim();
  if (tipo === "devolucao_fornecedor") {
    return "Abrir devolução";
  }
  if (tipo === "venda") {
    return "Abrir venda";
  }
  if (tipo === "operacao_fiscal") {
    return "Abrir NF-e";
  }
  return "Abrir origem";
}

export function rotuloModeloFiscal(modelo?: string | null) {
  if (modelo === "65") {
    return "NFC-e";
  }
  if (modelo === "55") {
    return "NF-e";
  }
  return modelo ? `Modelo ${modelo}` : "Documento fiscal";
}
