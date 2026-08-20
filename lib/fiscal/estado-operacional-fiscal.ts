import {
  ehRejeicaoFiscalConclusiva,
  evidenciaConsultaSefazFalhou,
  evidenciaDaEmissaoPersistida,
  emissaoRejeicaoTecnicaRecuperavel,
  nfce65DeveApenasReconciliar,
  textoEmissao,
} from "@/lib/fiscal/geranet/classificar-emissao";

export type EstadoOperacionalFiscal =
  | "autorizada"
  | "cancelada"
  | "rejeitada_sefaz"
  | "erro_envio"
  | "ambigua"
  | "em_transmissao"
  | "nao_classificada"
  | "reservada"
  | "inutilizacao"
  | "outro";

export type CasoApresentacaoEmissao =
  | "nao_transmitida"
  | "aguardando_reconciliacao"
  | "nao_classificada"
  | "rejeitada"
  | "autorizada"
  | "cancelada"
  | "outro";

export type AcaoPrincipalEmissaoFiscal =
  | "tentar_novamente"
  | "reconciliar"
  | "consultar_diagnostico"
  | "nenhuma";

export type TentativaFiscalParaEstado = {
  classificacao_inicial?: string | null;
  http_status?: number | null;
  cstat?: string | null;
  motivo?: string | null;
  resposta_sanitizada?: unknown;
};

export type EntradaEstadoOperacionalFiscal = {
  modelo?: string | number | null;
  status?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chave_acesso?: string | null;
  chaveAcesso?: string | null;
  geranet_http_status?: number | null;
  geranetHttpStatus?: number | null;
  geranet_situacao?: string | null;
  geranetSituacao?: string | null;
  erro_comunicacao?: string | null;
  erroComunicacao?: string | null;
};

export type EstadoOperacionalFiscalResolvido = {
  estado: EstadoOperacionalFiscal;
  caso: CasoApresentacaoEmissao;
  podeRetry: boolean;
  podeReconciliar: boolean;
  podeConsultar: boolean;
  podeEditarFiscal: boolean;
  documentoFiscalAmbiguo: boolean;
  documentoFiscalSensivel: boolean;
  requerDiagnostico: boolean;
  bloqueiaRetransmissao: boolean;
  consultaGeranetSecundaria: boolean;
  acaoPrincipal: AcaoPrincipalEmissaoFiscal;
  titulo: string;
  descricao: string;
};

const CLASSIFICACAO_AMBIGUA = new Set([
  "erro_tecnico",
  "ambigua",
  "aguardando_reconciliacao",
]);

const STATUS_CONSULTAVEIS = new Set([
  "aguardando_reconciliacao",
  "erro_comunicacao",
  "enviando",
  "autorizada",
  "rejeitada",
  "cancelada",
  "aguardando_transmissao_contingencia",
  "transmitindo_contingencia",
  "aguardando_inutilizacao",
  "inutilizada",
]);

const STATUS_EM_TRANSMISSAO = new Set([
  "enviando",
  "transmitindo_contingencia",
  "aguardando_transmissao_contingencia",
]);

function rotuloDocumento(modelo?: string | number | null) {
  const valor = textoEmissao(modelo);
  if (valor === "65") {
    return "NFC-e";
  }
  if (valor === "55") {
    return "NF-e";
  }
  return valor ? `Modelo ${valor}` : "Documento fiscal";
}

const MENSAGEM_PROCESSAMENTO_REMOTO_PERSISTIDO =
  /ainda está sendo processado|em processamento|aguardando processamento|aguardando retorno|documento pendente|status pendente/i;

function evidenciaProcessamentoRemotoPersistido(
  emissao: EntradaEstadoOperacionalFiscal
) {
  const resumo =
    emissao.resposta_resumo && typeof emissao.resposta_resumo === "object"
      ? (emissao.resposta_resumo as Record<string, unknown>)
      : null;
  const situacaoRemota = textoEmissao(resumo?.situacao_remota).toLowerCase();
  if (situacaoRemota === "processando") {
    return true;
  }

  return MENSAGEM_PROCESSAMENTO_REMOTO_PERSISTIDO.test(
    `${emissao.motivo ?? ""} ${textoEmissao(resumo?.mensagem)}`
  );
}

function descricaoEstadoAmbiguo(emissao: EntradaEstadoOperacionalFiscal) {
  if (evidenciaProcessamentoRemotoPersistido(emissao)) {
    return "Documento ainda está sendo processado pela Geranet. Não retransmita este documento até que a situação fiscal seja confirmada.";
  }

  const nome = rotuloDocumento(emissao.modelo);
  return `Não foi possível confirmar o estado fiscal desta ${nome}. O documento será mantido para reconciliação. Não retransmita enquanto a situação não for confirmada.`;
}

export function classificacaoResumoDaEmissao(respostaResumo: unknown) {
  if (!respostaResumo || typeof respostaResumo !== "object") {
    return null;
  }

  const valor = textoEmissao(
    (respostaResumo as Record<string, unknown>).classificacao
  ).toLowerCase();

  return valor || null;
}

function classificacaoEfetiva(
  emissao: EntradaEstadoOperacionalFiscal,
  ultimaTentativa?: TentativaFiscalParaEstado | null
) {
  const direta = textoEmissao(emissao.classificacao).toLowerCase();
  if (direta) {
    return direta;
  }

  const resumo = classificacaoResumoDaEmissao(emissao.resposta_resumo);
  if (resumo) {
    return resumo;
  }

  const sanitizada = classificacaoResumoDaEmissao(
    ultimaTentativa?.resposta_sanitizada
  );
  if (sanitizada) {
    return sanitizada;
  }

  const inicial = textoEmissao(ultimaTentativa?.classificacao_inicial).toLowerCase();
  if (inicial === "rejeitada") {
    return "rejeitada";
  }
  if (inicial === "aguardando_reconciliacao") {
    return "erro_tecnico";
  }
  if (inicial === "autorizada") {
    return "autorizada";
  }

  return "";
}

function evidenciasPersistidas(emissao: EntradaEstadoOperacionalFiscal) {
  return evidenciaDaEmissaoPersistida({
    cstat: emissao.cstat,
    motivo: emissao.motivo,
    protocolo: emissao.protocolo,
    chave_acesso: emissao.chave_acesso ?? emissao.chaveAcesso,
    geranet_http_status: emissao.geranet_http_status ?? emissao.geranetHttpStatus,
    geranet_situacao: emissao.geranet_situacao ?? emissao.geranetSituacao,
    erro_comunicacao: emissao.erro_comunicacao ?? emissao.erroComunicacao,
  });
}

function montarEstado(params: {
  estado: EstadoOperacionalFiscal;
  caso: CasoApresentacaoEmissao;
  documento: string;
  titulo: string;
  descricao: string;
  podeRetry: boolean;
  podeReconciliar: boolean;
  podeConsultar: boolean;
  podeEditarFiscal: boolean;
  documentoFiscalAmbiguo: boolean;
  documentoFiscalSensivel: boolean;
  requerDiagnostico?: boolean;
  acaoPrincipal: AcaoPrincipalEmissaoFiscal;
  consultaGeranetSecundaria?: boolean;
}): EstadoOperacionalFiscalResolvido {
  const requerDiagnostico = Boolean(params.requerDiagnostico);
  return {
    estado: params.estado,
    caso: params.caso,
    podeRetry: params.podeRetry,
    podeReconciliar: params.podeReconciliar,
    podeConsultar: params.podeConsultar,
    podeEditarFiscal: params.podeEditarFiscal,
    documentoFiscalAmbiguo: params.documentoFiscalAmbiguo,
    documentoFiscalSensivel: params.documentoFiscalSensivel,
    requerDiagnostico,
    bloqueiaRetransmissao:
      params.documentoFiscalAmbiguo ||
      params.estado === "em_transmissao" ||
      params.estado === "nao_classificada",
    consultaGeranetSecundaria: Boolean(params.consultaGeranetSecundaria),
    acaoPrincipal: params.acaoPrincipal,
    titulo: params.titulo,
    descricao: params.descricao,
  };
}

/**
 * Fonte canônica do estado operacional fiscal.
 * UI, botões, bloqueios e server actions devem consumir só este resolver.
 */
export function resolverEstadoOperacionalFiscal(
  emissao: EntradaEstadoOperacionalFiscal,
  ultimaTentativa?: TentativaFiscalParaEstado | null
): EstadoOperacionalFiscalResolvido {
  const documento = rotuloDocumento(emissao.modelo);
  const status = textoEmissao(emissao.status);
  const classificacao = classificacaoEfetiva(emissao, ultimaTentativa);
  const evidencias = evidenciasPersistidas(emissao);
  const podeConsultar = STATUS_CONSULTAVEIS.has(status);
  const cstatConclusivo = ehRejeicaoFiscalConclusiva({
    ...evidencias,
    cstat: ultimaTentativa?.cstat ?? evidencias.cstat,
    mensagem: `${evidencias.mensagem ?? ""} ${ultimaTentativa?.motivo ?? ""}`,
  });

  if (status === "autorizada") {
    return montarEstado({
      estado: "autorizada",
      caso: "autorizada",
      documento,
      titulo: `${documento} autorizada`,
      descricao: "Documento autorizado. Não retransmita.",
      podeRetry: false,
      podeReconciliar: false,
      podeConsultar,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: false,
      documentoFiscalSensivel: true,
      acaoPrincipal: "nenhuma",
    });
  }

  if (status === "cancelada") {
    return montarEstado({
      estado: "cancelada",
      caso: "cancelada",
      documento,
      titulo: `${documento} cancelada`,
      descricao: "Documento cancelado. Não retransmita.",
      podeRetry: false,
      podeReconciliar: false,
      podeConsultar,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: false,
      documentoFiscalSensivel: true,
      acaoPrincipal: "nenhuma",
    });
  }

  if (status === "aguardando_inutilizacao" || status === "inutilizada") {
    return montarEstado({
      estado: "inutilizacao",
      caso: "outro",
      documento,
      titulo: documento,
      descricao: "",
      podeRetry: false,
      podeReconciliar: false,
      podeConsultar,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: false,
      documentoFiscalSensivel: true,
      acaoPrincipal: "nenhuma",
    });
  }

  if (STATUS_EM_TRANSMISSAO.has(status)) {
    return montarEstado({
      estado: "em_transmissao",
      caso: "aguardando_reconciliacao",
      documento,
      titulo: "Emissão pendente de reconciliação",
      descricao:
        "Não retransmita este documento até confirmar a situação fiscal.",
      podeRetry: false,
      podeReconciliar: true,
      podeConsultar: true,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: true,
      documentoFiscalSensivel: true,
      acaoPrincipal: "reconciliar",
    });
  }

  if (status === "aguardando_reconciliacao" || CLASSIFICACAO_AMBIGUA.has(classificacao)) {
    return montarEstado({
      estado: "ambigua",
      caso: "aguardando_reconciliacao",
      documento,
      titulo: "Emissão pendente de reconciliação",
      descricao: descricaoEstadoAmbiguo(emissao),
      podeRetry: false,
      podeReconciliar: true,
      podeConsultar: true,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: true,
      documentoFiscalSensivel: true,
      acaoPrincipal: "reconciliar",
    });
  }

  if (
    cstatConclusivo ||
    (status === "rejeitada" &&
      !emissaoRejeicaoTecnicaRecuperavel({
        status,
        cstat: emissao.cstat,
        motivo: emissao.motivo,
        geranet_http_status:
          emissao.geranet_http_status ?? emissao.geranetHttpStatus,
        erro_comunicacao: emissao.erro_comunicacao ?? emissao.erroComunicacao,
      }))
  ) {
    if (status === "rejeitada" || cstatConclusivo) {
      return montarEstado({
        estado: "rejeitada_sefaz",
        caso: "rejeitada",
        documento,
        titulo: `${documento} rejeitada pela SEFAZ`,
        descricao: "Corrija a pendência e tente novamente.",
        podeRetry: true,
        podeReconciliar: false,
        podeConsultar,
        podeEditarFiscal: true,
        documentoFiscalAmbiguo: false,
        documentoFiscalSensivel: false,
        acaoPrincipal: "tentar_novamente",
      });
    }
  }

  if (status === "rejeitada") {
    return montarEstado({
      estado: "ambigua",
      caso: "aguardando_reconciliacao",
      documento,
      titulo: "Emissão pendente de reconciliação",
      descricao:
        "Não retransmita este documento até confirmar a situação fiscal.",
      podeRetry: false,
      podeReconciliar: true,
      podeConsultar: true,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: true,
      documentoFiscalSensivel: true,
      acaoPrincipal: "reconciliar",
    });
  }

  if (status === "erro_comunicacao" && classificacao === "erro_envio") {
    const forcarReconciliacaoNfce =
      textoEmissao(emissao.modelo) === "65" &&
      nfce65DeveApenasReconciliar({
        status,
        cstat: emissao.cstat,
        motivo: emissao.motivo,
        protocolo: emissao.protocolo,
        chave_acesso: emissao.chave_acesso ?? emissao.chaveAcesso,
        geranet_http_status:
          emissao.geranet_http_status ?? emissao.geranetHttpStatus,
        geranet_situacao: emissao.geranet_situacao ?? emissao.geranetSituacao,
        erro_comunicacao: emissao.erro_comunicacao ?? emissao.erroComunicacao,
      });

    if (forcarReconciliacaoNfce) {
      return montarEstado({
        estado: "ambigua",
        caso: "aguardando_reconciliacao",
        documento,
        titulo: "Emissão pendente de reconciliação",
        descricao:
          "Não retransmita este documento até confirmar a situação fiscal.",
        podeRetry: false,
        podeReconciliar: true,
        podeConsultar: true,
        podeEditarFiscal: false,
        documentoFiscalAmbiguo: true,
        documentoFiscalSensivel: true,
        acaoPrincipal: "reconciliar",
      });
    }

    return montarEstado({
      estado: "erro_envio",
      caso: "nao_transmitida",
      documento,
      titulo: `${documento} não transmitida`,
      descricao:
        "A Geranet recusou ou não aceitou a solicitação antes de uma confirmação de envio à SEFAZ.",
      podeRetry: true,
      podeReconciliar: false,
      podeConsultar: true,
      podeEditarFiscal: true,
      documentoFiscalAmbiguo: false,
      documentoFiscalSensivel: false,
      acaoPrincipal: "tentar_novamente",
      consultaGeranetSecundaria: true,
    });
  }

  if (status === "erro_comunicacao") {
    if (evidenciaConsultaSefazFalhou(evidencias) && classificacao === "") {
      return montarEstado({
        estado: "nao_classificada",
        caso: "nao_classificada",
        documento,
        titulo: "Situação fiscal ainda não classificada",
        descricao: "Consulte o diagnóstico antes de retransmitir.",
        podeRetry: false,
        podeReconciliar: false,
        podeConsultar: true,
        podeEditarFiscal: false,
        documentoFiscalAmbiguo: false,
        documentoFiscalSensivel: true,
        requerDiagnostico: true,
        acaoPrincipal: "consultar_diagnostico",
        consultaGeranetSecundaria: true,
      });
    }

    return montarEstado({
      estado: "nao_classificada",
      caso: "nao_classificada",
      documento,
      titulo: "Situação fiscal ainda não classificada",
      descricao: "Consulte o diagnóstico antes de retransmitir.",
      podeRetry: false,
      podeReconciliar: false,
      podeConsultar: true,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: false,
      documentoFiscalSensivel: true,
      requerDiagnostico: true,
      acaoPrincipal: "consultar_diagnostico",
      consultaGeranetSecundaria: true,
    });
  }

  if (status === "reservada") {
    return montarEstado({
      estado: "reservada",
      caso: "outro",
      documento,
      titulo: documento,
      descricao: "",
      podeRetry: false,
      podeReconciliar: false,
      podeConsultar: false,
      podeEditarFiscal: false,
      documentoFiscalAmbiguo: false,
      documentoFiscalSensivel: false,
      acaoPrincipal: "nenhuma",
    });
  }

  return montarEstado({
    estado: "outro",
    caso: "outro",
    documento,
    titulo: documento,
    descricao: "",
    podeRetry: false,
    podeReconciliar: false,
    podeConsultar,
    podeEditarFiscal: false,
    documentoFiscalAmbiguo: false,
    documentoFiscalSensivel: false,
    acaoPrincipal: "nenhuma",
  });
}

export function entradaEstadoOperacionalDeEmissao(emissao: {
  modelo?: string | number | null;
  status?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chave_acesso?: string | null;
  chaveAcesso?: string | null;
  geranet_http_status?: number | null;
  geranetHttpStatus?: number | null;
  geranet_situacao?: string | null;
  geranetSituacao?: string | null;
  erro_comunicacao?: string | null;
  erroComunicacao?: string | null;
}): EntradaEstadoOperacionalFiscal {
  return {
    modelo: emissao.modelo,
    status: emissao.status,
    classificacao:
      emissao.classificacao ??
      classificacaoResumoDaEmissao(emissao.resposta_resumo),
    resposta_resumo: emissao.resposta_resumo,
    cstat: emissao.cstat,
    motivo: emissao.motivo,
    protocolo: emissao.protocolo,
    chave_acesso: emissao.chave_acesso ?? emissao.chaveAcesso,
    geranet_http_status: emissao.geranet_http_status ?? emissao.geranetHttpStatus,
    geranet_situacao: emissao.geranet_situacao ?? emissao.geranetSituacao,
    erro_comunicacao: emissao.erro_comunicacao ?? emissao.erroComunicacao,
  };
}

export function resolverEstadoOperacionalDeEmissaoPersistida(
  emissao: Parameters<typeof entradaEstadoOperacionalDeEmissao>[0],
  ultimaTentativa?: TentativaFiscalParaEstado | null
) {
  return resolverEstadoOperacionalFiscal(
    entradaEstadoOperacionalDeEmissao(emissao),
    ultimaTentativa
  );
}
