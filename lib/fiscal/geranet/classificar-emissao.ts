import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  cstatNormalizado,
  ehDuplicidadeChaveAcesso,
} from "@/lib/fiscal/geranet/cstat";

export type EvidenciaClassificacaoEmissao = {
  httpOk?: boolean | null;
  httpStatus?: number | null;
  situacao?: string | null;
  cstat?: string | null;
  mensagem?: string | null;
  chave?: string | null;
  protocolo?: string | null;
  /** false somente quando a requisição ainda não saiu (validação local / DNS). */
  transmissaoIniciada?: boolean | null;
};

export type EmissaoParaAcaoFiscal = {
  status?: string | null;
  modelo?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chave_acesso?: string | null;
  geranet_http_status?: number | null;
  geranet_situacao?: string | null;
  erro_comunicacao?: string | null;
};

export type SituacaoRespostaEmitir =
  | "autorizada"
  | "rejeitada"
  | "erro_envio"
  | "aguardando_reconciliacao";

export const MENSAGEM_FALHA_TECNICA_CONSULTA =
  "Falha técnica na consulta do resultado da emissão.";

export const MENSAGEM_FALHA_CONSULTA_SEFAZ =
  "Não foi possível consultar a situação da NFC-e na SEFAZ-MT.\n\nA numeração foi preservada.\n\nTente consultar novamente antes de retransmitir.";

export const TITULO_BLOQUEIO_RETRANSMISSAO =
  "Segurança contra retransmissão";

export const MENSAGEM_BLOQUEIO_RETRANSMISSAO =
  `${TITULO_BLOQUEIO_RETRANSMISSAO}\nA transmissão anterior foi iniciada, mas seu resultado não pôde ser confirmado. Por segurança, não retransmita. Reconcilie primeiro essa transmissão.`;

export const MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO =
  "Esta NF-e possui situação fiscal ainda não confirmada. Reconcilie o documento antes de qualquer nova tentativa.";

export const MENSAGEM_RESULTADO_REMOTO_NAO_CONCLUSIVO =
  "Não foi possível confirmar o estado fiscal desta NF-e. O documento será mantido para reconciliação. Não retransmita enquanto a situação não for confirmada.";

export const MENSAGEM_NFCE65_AGUARDANDO_RECONCILIACAO =
  MENSAGEM_BLOQUEIO_RETRANSMISSAO;

const CSTAT_AUTORIZADA = new Set(["100", "150"]);
const CSTAT_CANCELADA = new Set(["101", "135", "151", "155"]);
const CSTAT_PROCESSANDO = new Set(["103", "104", "105", "204"]);

const ERRO_TECNICO =
  /nfeconsulta4|nferetautorizacao|network subsystem|timeout|etimedout|econnreset|econnrefused|socket|connection reset|connection refused|erro interno:\s*-2|http\s*50[0-4]|erro http:\s*50[0-4]|network is unreachable|subsystem is unusable/i;

const REJEICAO_FISCAL_MENSAGEM =
  /rejei[cç][aã]o(?:\s+\d{3})?\s*:/i;

export function textoEmissao(valor: unknown) {
  return String(valor ?? "").trim();
}

export function cstatFiscal(valor: unknown, mensagem?: unknown) {
  return cstatNormalizado(valor, mensagem) || textoEmissao(valor);
}

export function ehRejeicaoFiscalReal(
  evidencia: EvidenciaClassificacaoEmissao
) {
  if (ehDuplicidadeChaveAcesso(evidencia)) {
    return true;
  }

  const codigo = cstatFiscal(evidencia.cstat, evidencia.mensagem);

  if (!codigo || !/^\d{3}$/.test(codigo)) {
    return false;
  }

  if (CSTAT_AUTORIZADA.has(codigo) || CSTAT_CANCELADA.has(codigo)) {
    return false;
  }

  if (CSTAT_PROCESSANDO.has(codigo)) {
    return false;
  }

  return true;
}

export function ehRejeicaoFiscalConclusiva(
  evidencia: EvidenciaClassificacaoEmissao
) {
  if (ehFalhaNfeConsulta4(evidencia) || ehErroTecnicoAmbiguo(evidencia)) {
    return false;
  }

  const codigo = cstatFiscal(evidencia.cstat, evidencia.mensagem);
  if (codigo === "204") {
    return false;
  }

  if (ehDuplicidadeChaveAcesso(evidencia) || ehRejeicaoFiscalReal(evidencia)) {
    return true;
  }

  return REJEICAO_FISCAL_MENSAGEM.test(textoEmissao(evidencia.mensagem));
}

export function ehErroTecnicoAmbiguo(
  evidencia: EvidenciaClassificacaoEmissao
) {
  if (ehRejeicaoFiscalReal(evidencia) || ehDuplicidadeChaveAcesso(evidencia)) {
    return false;
  }

  const http = evidencia.httpStatus;
  const mensagem = `${evidencia.mensagem ?? ""} ${evidencia.situacao ?? ""}`;

  if (http != null && (Number(http) >= 500 || Number(http) === 0)) {
    return true;
  }

  if (ERRO_TECNICO.test(mensagem)) {
    return true;
  }

  return false;
}

export function ehFalhaNfeConsulta4(
  evidencia: EvidenciaClassificacaoEmissao
) {
  const textoBruto = `${evidencia.mensagem ?? ""} ${evidencia.situacao ?? ""}`;
  return /nfeconsulta4/i.test(textoBruto);
}

export function evidenciaConsultaSefazFalhou(
  evidencia: EvidenciaClassificacaoEmissao
) {
  return ehFalhaNfeConsulta4(evidencia) || ehErroTecnicoAmbiguo(evidencia);
}

export function evidenciaSemTransmissaoRemota(
  evidencia: EvidenciaClassificacaoEmissao
) {
  if (ehRejeicaoFiscalConclusiva(evidencia)) {
    return false;
  }

  if (evidenciaConsultaSefazFalhou(evidencia)) {
    return false;
  }

  if (textoEmissao(evidencia.protocolo)) {
    return false;
  }

  const codigo = cstatFiscal(evidencia.cstat);
  if (codigo && /^\d{3}$/.test(codigo)) {
    return false;
  }

  if (textoEmissao(evidencia.chave).replace(/\D/g, "").length === 44) {
    return false;
  }

  // HTTP 4xx isolado NÃO prova que a requisição não chegou ao processo fiscal.
  // Só libere retry quando o chamador provar que o POST ainda não saiu.
  return evidencia.transmissaoIniciada === false;
}

export function mensagemFalhaConsultaSefaz(modelo?: string | null) {
  const nome = textoEmissao(modelo) === "55" ? "NF-e" : "NFC-e";

  return `Não foi possível consultar a situação da ${nome} na SEFAZ-MT.\n\nA numeração foi preservada.\n\nTente consultar novamente antes de retransmitir.`;
}

export function mensagemResultadoRemotoNaoConclusivo(modelo?: string | null) {
  const nome = textoEmissao(modelo) === "65" ? "NFC-e" : "NF-e";

  return `Não foi possível confirmar o estado fiscal desta ${nome}. O documento será mantido para reconciliação. Não retransmita enquanto a situação não for confirmada.`;
}

export function mensagemBloqueioEmissao(emissao: {
  status?: string | null;
  classificacao?: string | null;
}) {
  const status = textoEmissao(emissao.status);
  if (
    status === "aguardando_reconciliacao" ||
    status === "enviando" ||
    textoEmissao(emissao.classificacao) === "erro_tecnico"
  ) {
    return MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO;
  }

  return MENSAGEM_BLOQUEIO_RETRANSMISSAO;
}

export function extraBloqueioRetransmissaoFiscal(emissao: {
  id?: string | null;
  status?: string | null;
}) {
  const status = textoEmissao(emissao.status);

  return {
    emissao_id: emissao.id ?? null,
    status: status || null,
    resultado: status || null,
    podeRetransmitir: false,
    podeConsultarNovamente: true,
    requer_reconciliacao:
      status === "aguardando_reconciliacao" || status === "enviando",
  };
}

export function montarErroEmitirNaoAutorizada({
  persistencia,
  motivoTecnico,
  emissaoId,
  httpGeranet,
  geranet,
  modelo,
}: {
  persistencia: ReturnType<typeof persistirClassificacaoNaoAutorizada>;
  motivoTecnico: string;
  emissaoId: string;
  httpGeranet?: number | null;
  geranet?: unknown;
  modelo?: string | null;
}) {
  const reconciliar = persistencia.status === "aguardando_reconciliacao";
  const mensagem = persistencia.retransmitir
    ? `${motivoTecnico} A mesma emissão pode ser enviada novamente sem novo número.`
    : mensagemResultadoRemotoNaoConclusivo(modelo);

  return {
    mensagem,
    statusHttp: reconciliar ? 409 : 502,
    extra: {
      emissao_id: emissaoId,
      status: persistencia.status,
      classificacao: persistencia.classificacaoResumo,
      resultado: persistencia.status,
      podeRetransmitir: persistencia.retransmitir,
      podeConsultarNovamente: true,
      requer_reconciliacao: reconciliar,
      mensagem_geranet: motivoTecnico || null,
      http_geranet: httpGeranet ?? null,
      geranet: geranet ?? null,
    },
  };
}

export function resumoErroTecnicoConsulta(mensagem: string | null | undefined) {
  const bruto = textoEmissao(mensagem);

  if (!bruto) {
    return null;
  }

  const http =
    bruto.match(/Erro HTTP:\s*(\d+)/i)?.[1] ??
    bruto.match(/HTTP\s*(\d+)/i)?.[1] ??
    null;
  const rede = /network subsystem is unusable/i.test(bruto)
    ? "Network subsystem is unusable"
    : /timeout|etimedout/i.test(bruto)
      ? "timeout"
      : /serviço de consulta indisponível|service unavailable/i.test(bruto)
        ? "serviço de consulta indisponível"
        : null;

  if (http && rede) {
    return `HTTP ${http} — ${rede}`;
  }

  if (http) {
    return `HTTP ${http}`;
  }

  if (rede) {
    return rede;
  }

  return bruto.length > 180 ? `${bruto.slice(0, 177)}...` : bruto;
}

export function classificarRespostaEmitir(
  evidencia: EvidenciaClassificacaoEmissao
): SituacaoRespostaEmitir {
  const chave = textoEmissao(evidencia.chave).replace(/\D/g, "");
  const protocolo = textoEmissao(evidencia.protocolo);
  const situacao = textoEmissao(evidencia.situacao).toLowerCase();
  const httpOk = Boolean(evidencia.httpOk);
  const codigo = cstatFiscal(evidencia.cstat, evidencia.mensagem);

  if (
    httpOk &&
    situacao === "sucesso" &&
    chave.length === 44 &&
    protocolo.length > 0
  ) {
    return "autorizada";
  }

  if (CSTAT_AUTORIZADA.has(codigo) && chave.length === 44 && protocolo) {
    return "autorizada";
  }

  if (ehDuplicidadeChaveAcesso(evidencia) || ehRejeicaoFiscalReal(evidencia)) {
    return "rejeitada";
  }

  if (ehFalhaNfeConsulta4(evidencia)) {
    return "aguardando_reconciliacao";
  }

  if (codigo === "204" && chave.length === 44 && protocolo) {
    return "autorizada";
  }

  if (evidenciaConsultaSefazFalhou(evidencia) || codigo === "204") {
    return "aguardando_reconciliacao";
  }

  if (ehRejeicaoFiscalConclusiva(evidencia)) {
    return "rejeitada";
  }

  if (evidenciaSemTransmissaoRemota(evidencia)) {
    return "erro_envio";
  }

  return "aguardando_reconciliacao";
}

export function persistirClassificacaoNaoAutorizada(
  classificacao: Exclude<SituacaoRespostaEmitir, "autorizada">
) {
  if (classificacao === "rejeitada") {
    return {
      status: "rejeitada" as const,
      classificacaoResumo: "rejeitada" as const,
      mensagemPadrao: "Documento rejeitado.",
      retransmitir: false as const,
    };
  }

  if (classificacao === "erro_envio") {
    return {
      status: "erro_comunicacao" as const,
      classificacaoResumo: "erro_envio" as const,
      mensagemPadrao: "Falha no envio do documento fiscal.",
      retransmitir: true as const,
    };
  }

  return {
    status: "aguardando_reconciliacao" as const,
    classificacaoResumo: "erro_tecnico" as const,
    mensagemPadrao: MENSAGEM_RESULTADO_REMOTO_NAO_CONCLUSIVO,
    retransmitir: false as const,
  };
}

export function historicoErroTecnico(mensagem: string | null) {
  return {
    em: new Date().toISOString(),
    tipo: "erro_tecnico",
    nota: MENSAGEM_FALHA_TECNICA_CONSULTA,
    mensagem,
  };
}

export function emissaoRejeicaoTecnicaRecuperavel(emissao: {
  status?: string | null;
  cstat?: string | null;
  motivo?: string | null;
  geranet_http_status?: number | null;
  erro_comunicacao?: string | null;
}) {
  if (textoEmissao(emissao.status) !== "rejeitada") {
    return false;
  }

  if (ehRejeicaoFiscalReal({ cstat: emissao.cstat })) {
    return false;
  }

  if (cstatFiscal(emissao.cstat)) {
    return false;
  }

  return ehErroTecnicoAmbiguo({
    cstat: emissao.cstat,
    mensagem: `${emissao.motivo ?? ""} ${emissao.erro_comunicacao ?? ""}`,
    httpStatus: emissao.geranet_http_status,
  });
}

export function emissaoPodeReconciliar(emissao: EmissaoParaAcaoFiscal) {
  return resolverEstadoOperacionalDeEmissaoPersistida(emissao).podeReconciliar;
}

export function evidenciaDaEmissaoPersistida(emissao: {
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chave_acesso?: string | null;
  geranet_http_status?: number | null;
  geranet_situacao?: string | null;
  erro_comunicacao?: string | null;
}): EvidenciaClassificacaoEmissao {
  return {
    httpStatus: emissao.geranet_http_status,
    situacao: emissao.geranet_situacao,
    cstat: emissao.cstat,
    mensagem: `${emissao.motivo ?? ""} ${emissao.erro_comunicacao ?? ""}`,
    protocolo: emissao.protocolo,
    chave: emissao.chave_acesso,
  };
}

export function deveReclassificarComoRejeitada(emissao: {
  status?: string | null;
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chave_acesso?: string | null;
  geranet_http_status?: number | null;
  geranet_situacao?: string | null;
  erro_comunicacao?: string | null;
}) {
  const status = textoEmissao(emissao.status);
  if (status !== "erro_comunicacao" && status !== "aguardando_reconciliacao") {
    return false;
  }

  return (
    classificarRespostaEmitir(evidenciaDaEmissaoPersistida(emissao)) ===
    "rejeitada"
  );
}

function evidenciaDaEmissao(emissao: {
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chave_acesso?: string | null;
  geranet_http_status?: number | null;
  geranet_situacao?: string | null;
  erro_comunicacao?: string | null;
}): EvidenciaClassificacaoEmissao {
  return evidenciaDaEmissaoPersistida(emissao);
}

export function emissaoPodeRetentarEnvio(emissao: EmissaoParaAcaoFiscal) {
  return resolverEstadoOperacionalDeEmissaoPersistida(emissao).podeRetry;
}

/** NFC-e 65: conciliação ou NfeConsulta4 só reconcilia; nunca reabre reserva. */
export function nfce65DeveApenasReconciliar(emissao: {
  status?: string | null;
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chave_acesso?: string | null;
  geranet_http_status?: number | null;
  geranet_situacao?: string | null;
  erro_comunicacao?: string | null;
}) {
  if (textoEmissao(emissao.status) === "aguardando_reconciliacao") {
    return true;
  }

  return ehFalhaNfeConsulta4(evidenciaDaEmissao(emissao));
}

export function acoesEmissaoFiscal(emissao: EmissaoParaAcaoFiscal) {
  const estado = resolverEstadoOperacionalDeEmissaoPersistida(emissao);
  return {
    podeConsultarNovamente: estado.podeConsultar,
    podeRetransmitir: estado.podeRetry,
  };
}

export function acoesEmissaoFiscalNfce65(emissao: EmissaoParaAcaoFiscal) {
  return acoesEmissaoFiscal(emissao);
}

/** Impede retransmitir ESTA emissão. Não se aplica a outras vendas da empresa. */
export function emissaoBloqueiaRetransmissao(emissao: EmissaoParaAcaoFiscal) {
  return resolverEstadoOperacionalDeEmissaoPersistida(emissao)
    .bloqueiaRetransmissao;
}
