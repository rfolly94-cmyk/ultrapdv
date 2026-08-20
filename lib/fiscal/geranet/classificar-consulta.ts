import { documentoFiscalEhPlaceholder, hexDocumentoFiscalPersistivel } from "@/lib/fiscal/documento-fiscal";
import {
  ehErroTecnicoAmbiguo,
  ehFalhaNfeConsulta4,
  ehRejeicaoFiscalConclusiva,
  ehRejeicaoFiscalReal,
  emissaoRejeicaoTecnicaRecuperavel,
  MENSAGEM_FALHA_TECNICA_CONSULTA,
  mensagemFalhaConsultaSefaz,
} from "./classificar-emissao";

export type SituacaoConsultaFiscal =
  | "autorizada"
  | "rejeitada"
  | "cancelada"
  | "processando"
  | "nao_encontrada"
  | "falha_consulta";

export type EmissaoParaConsulta = {
  id: string;
  modelo: string;
  serie: number | string;
  numero: number | string;
  ambiente: number | string;
  status: string;
  tipo_emissao?: string | null;
  chave_acesso?: string | null;
  protocolo?: string | null;
  codigo_numerico?: string | null;
  origem_id?: string | null;
  origem_tipo?: string | null;
  numero_venda?: string | null;
  xml_hex?: string | null;
  pdf_hex?: string | null;
  xml_contingencia_hex?: string | null;
  pdf_contingencia_hex?: string | null;
  enviada_at?: string | null;
  autorizada_at?: string | null;
  cancelada_at?: string | null;
  geranet_log_id?: number | string | null;
  resposta_resumo?: Record<string, unknown> | null;
  cstat?: string | null;
  motivo?: string | null;
  geranet_http_status?: number | null;
  erro_comunicacao?: string | null;
};

export type LogGeranetResumo = {
  id: number | null;
  endpoint: string | null;
  criado_em: string | null;
  http_status: number | null;
  sucesso: boolean | null;
  chave: string | null;
  protocolo: string | null;
  cstat: string | null;
  numero: string | null;
  situacao: string | null;
  mensagem: string | null;
  xml: string | null;
  pdf: string | null;
  modelo: string | null;
  serie: string | null;
  ambiente: string | null;
  codigo_numerico: string | null;
  numero_venda: string | null;
  contingencia: string | null;
};

export type ResultadoClassificacaoConsulta = {
  situacao: SituacaoConsultaFiscal;
  status_local: string;
  mensagem: string;
  chave: string | null;
  protocolo: string | null;
  cstat: string | null;
  motivo: string | null;
  xml: string | null;
  pdf: string | null;
  log_id: number | null;
  geranet_http_status: number | null;
  geranet_situacao: string | null;
};

const CHAVES_SECRETAS =
  /certificado|senha|api.?key|token|authorization|csc|csrt|password|secret/i;

export function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

const JANELA_ANTES_MS = 60 * 60 * 1000;
const JANELA_DEPOIS_MS = 24 * 60 * 60 * 1000;

export function instanteDentroDaJanelaTransmissao(
  enviadaAt: string | null | undefined,
  criadoEm: string | null | undefined
) {
  if (!texto(enviadaAt) || !texto(criadoEm)) {
    return true;
  }

  const enviada = Date.parse(String(enviadaAt));
  const criado = Date.parse(String(criadoEm));

  if (Number.isNaN(enviada) || Number.isNaN(criado)) {
    return true;
  }

  return (
    criado >= enviada - JANELA_ANTES_MS &&
    criado <= enviada + JANELA_DEPOIS_MS
  );
}

export function logDentroDaJanelaTransmissao(
  emissao: Pick<EmissaoParaConsulta, "enviada_at" | "chave_acesso">,
  log: Pick<LogGeranetResumo, "criado_em" | "chave">
) {
  const chaveEmissao = somenteDigitos(emissao.chave_acesso);
  const chaveLog = somenteDigitos(log.chave);

  if (chaveEmissao.length === 44 && chaveLog === chaveEmissao) {
    return true;
  }

  return instanteDentroDaJanelaTransmissao(
    emissao.enviada_at,
    log.criado_em
  );
}

export function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function objeto(valor: unknown): Record<string, unknown> {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }

  return {};
}

export function array(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

export function numeroFiscal(valor: unknown) {
  const digits = somenteDigitos(valor);
  if (!digits) {
    return "";
  }

  return String(BigInt(digits));
}

export function sanitizarConsultaGeranet(valor: unknown): unknown {
  if (valor === null || valor === undefined) {
    return valor;
  }

  if (Array.isArray(valor)) {
    return valor.map(sanitizarConsultaGeranet);
  }

  if (typeof valor !== "object") {
    if (typeof valor === "string") {
      const bruto = valor.trim();
      if (bruto.startsWith("{") || bruto.startsWith("[")) {
        try {
          return sanitizarConsultaGeranet(JSON.parse(bruto));
        } catch {
          return valor.length > 400 ? "[omitido]" : valor;
        }
      }

      if (valor.length > 400) {
        return "[omitido]";
      }
    }

    return valor;
  }

  const saida: Record<string, unknown> = {};

  for (const [chave, conteudo] of Object.entries(
    valor as Record<string, unknown>
  )) {
    if (CHAVES_SECRETAS.test(chave)) {
      saida[chave] = "[REDACTED]";
      continue;
    }

    if (/^(xml|pdf)$/i.test(chave)) {
      saida[chave] = texto(conteudo) ? "[presente]" : "";
      continue;
    }

    saida[chave] = sanitizarConsultaGeranet(conteudo);
  }

  return saida;
}

export function extrairCamposLog(
  logResumo: Record<string, unknown>,
  detalhe?: Record<string, unknown>
): LogGeranetResumo {
  const log = objeto(detalhe?.log);
  const payload = objeto(log.payload);
  const resposta = objeto(log.resposta);
  const nfe = objeto(payload.nfe);
  const empresa = objeto(nfe.empresa);

  return {
    id: Number(logResumo.id ?? log.id) || null,
    endpoint: texto(logResumo.endpoint ?? log.endpoint) || null,
    criado_em: texto(logResumo.criado_em ?? log.criado_em) || null,
    http_status:
      Number(logResumo.http_status ?? log.http_status ?? resposta.http_status) ||
      null,
    sucesso:
      typeof logResumo.sucesso === "boolean"
        ? logResumo.sucesso
        : typeof log.sucesso === "boolean"
          ? log.sucesso
          : null,
    chave: somenteDigitos(resposta.chave) || null,
    protocolo: somenteDigitos(resposta.protocolo) || null,
    cstat: texto(resposta.cstat) || null,
    numero: texto(resposta.numero ?? nfe.numeroNotaEmitir) || null,
    situacao: texto(resposta.situacao).toLowerCase() || null,
    mensagem: texto(resposta.mensagem) || null,
    xml: texto(resposta.xml) || null,
    pdf: texto(resposta.pdf) || null,
    modelo: texto(nfe.modelo ?? payload.modelo) || null,
    serie: texto(empresa.serie ?? nfe.serie) || null,
    ambiente: texto(nfe.ambiente ?? payload.ambiente) || null,
    codigo_numerico: texto(nfe.codigoNumerico) || null,
    numero_venda: texto(nfe.numeroVenda) || null,
    contingencia: texto(nfe.contingencia).toLowerCase() || null,
  };
}

export function logCompativelComEmissao(
  emissao: EmissaoParaConsulta,
  log: LogGeranetResumo
) {
  const chaveEmissao = somenteDigitos(emissao.chave_acesso);
  const chaveLog = somenteDigitos(log.chave);

  if (chaveEmissao.length === 44 && chaveLog.length === 44) {
    return chaveEmissao === chaveLog;
  }

  const modeloOk =
    texto(log.modelo) === "" || texto(log.modelo) === texto(emissao.modelo);

  const serieOk =
    texto(log.serie) === "" ||
    numeroFiscal(log.serie) === numeroFiscal(emissao.serie);

  const numeroOk =
    texto(log.numero) === "" ||
    numeroFiscal(log.numero) === numeroFiscal(emissao.numero);

  const ambienteOk =
    texto(log.ambiente) === "" ||
    numeroFiscal(log.ambiente) === numeroFiscal(emissao.ambiente);

  if (!modeloOk || !serieOk || !numeroOk || !ambienteOk) {
    return false;
  }

  const logIdConhecido = Number(emissao.geranet_log_id) || 0;
  if (logIdConhecido && Number(log.id) === logIdConhecido) {
    // log original já identificado; não descartar por janela de horário
  } else if (!logDentroDaJanelaTransmissao(emissao, log)) {
    return false;
  }

  if (
    texto(log.codigo_numerico) &&
    texto(emissao.codigo_numerico) &&
    texto(log.codigo_numerico) !== texto(emissao.codigo_numerico)
  ) {
    return false;
  }

  const numeroVendaLog = texto(log.numero_venda);
  const numerosVendaAceitos = new Set(
    [texto(emissao.origem_id), texto(emissao.numero_venda)].filter(Boolean)
  );
  const numeroVendaOk =
    !numeroVendaLog ||
    numerosVendaAceitos.size === 0 ||
    numerosVendaAceitos.has(numeroVendaLog);

  const cnfOk =
    Boolean(texto(log.codigo_numerico)) &&
    texto(log.codigo_numerico) === texto(emissao.codigo_numerico);

  const temIdentidadeForte =
    cnfOk ||
    (Boolean(numeroVendaLog) &&
      numeroVendaOk &&
      numerosVendaAceitos.has(numeroVendaLog)) ||
    chaveLog.length === 44;

  if (!numeroVendaOk && !cnfOk && chaveLog.length !== 44) {
    return false;
  }

  const camposBasicos =
    texto(log.modelo) !== "" &&
    texto(log.serie) !== "" &&
    texto(log.numero) !== "";

  return camposBasicos && (temIdentidadeForte || !texto(emissao.codigo_numerico));
}

export function classificarLogEmitir(
  log: LogGeranetResumo,
  emissao: EmissaoParaConsulta
): SituacaoConsultaFiscal {
  const cstat = texto(log.cstat);
  const situacao = texto(log.situacao).toLowerCase();
  const mensagem = texto(log.mensagem);
  const chave = somenteDigitos(log.chave);
  const protocolo = somenteDigitos(log.protocolo);
  const http = Number(log.http_status ?? 0);

  if (cstat === "101" || cstat === "135" || cstat === "151" || cstat === "155") {
    return "cancelada";
  }

  if (cstat === "204" && chave.length === 44) {
    return "autorizada";
  }

  if (
    (situacao === "sucesso" || log.sucesso === true) &&
    chave.length === 44
  ) {
    return "autorizada";
  }

  if (http === 202 || log.contingencia === "sim") {
    if (chave.length === 44 && protocolo) {
      return "autorizada";
    }

    if (
      emissao.tipo_emissao === "contingencia_offline" &&
      (texto(log.xml) || http === 202)
    ) {
      return "processando";
    }
  }

  if (cstat === "204") {
    return "processando";
  }

  if (
    ehRejeicaoFiscalReal({
      cstat,
      situacao,
      mensagem,
      httpStatus: http,
    }) ||
    ehRejeicaoFiscalConclusiva({
      cstat,
      situacao,
      mensagem,
      httpStatus: http,
    })
  ) {
    return "rejeitada";
  }

  if (situacao === "erro" || log.sucesso === false) {
    return "processando";
  }

  if (http >= 500 || http === 0) {
    return "processando";
  }

  return "processando";
}

export function classificarLogCancelar(log: LogGeranetResumo): boolean {
  const cstat = texto(log.cstat);
  const situacao = texto(log.situacao).toLowerCase();

  return (
    situacao === "sucesso" ||
    log.sucesso === true ||
    cstat === "101" ||
    cstat === "135" ||
    cstat === "151" ||
    cstat === "155"
  );
}

const CLASSIFICACAO_AMBIGUA_RESUMO = new Set([
  "erro_tecnico",
  "ambigua",
  "aguardando_reconciliacao",
]);

const MENSAGEM_PROCESSAMENTO_REMOTO =
  /ainda está sendo processado|em processamento|aguardando processamento|aguardando retorno|documento pendente|status pendente/i;

export function evidenciaProcessamentoRemotoNaoConclusivo(evidencia?: {
  situacao?: string | null;
  cstat?: string | null;
  motivo?: string | null;
  geranet_http_status?: number | null;
  erro_comunicacao?: string | null;
}) {
  const mensagem = `${evidencia?.motivo ?? ""} ${evidencia?.erro_comunicacao ?? ""}`;
  const cstat = texto(evidencia?.cstat);
  const http = Number(evidencia?.geranet_http_status ?? 0);
  const situacao = texto(evidencia?.situacao).toLowerCase();

  if (
    ehFalhaNfeConsulta4({
      mensagem,
      cstat,
      httpStatus: evidencia?.geranet_http_status,
    }) ||
    ehErroTecnicoAmbiguo({
      mensagem,
      cstat,
      httpStatus: evidencia?.geranet_http_status,
    })
  ) {
    return false;
  }

  if (situacao === "processando" || http === 202) {
    return true;
  }

  if (cstat === "103" || cstat === "104" || cstat === "105") {
    return true;
  }

  return MENSAGEM_PROCESSAMENTO_REMOTO.test(mensagem);
}

export function decidirStatusLocal(
  statusAtual: string,
  situacao: SituacaoConsultaFiscal,
  evidencia?: {
    cstat?: string | null;
    motivo?: string | null;
    geranet_http_status?: number | null;
    erro_comunicacao?: string | null;
    modelo?: string | null;
  }
) {
  if (statusAtual === "cancelada") {
    return "cancelada";
  }

  if (statusAtual === "autorizada") {
    return situacao === "cancelada" ? "cancelada" : "autorizada";
  }

  if (situacao === "autorizada") {
    return "autorizada";
  }

  if (situacao === "cancelada") {
    return "cancelada";
  }

  if (situacao === "rejeitada") {
    return "rejeitada";
  }

  if (
    texto(evidencia?.modelo) === "65" &&
    ehFalhaNfeConsulta4({
      mensagem: `${evidencia?.motivo ?? ""} ${evidencia?.erro_comunicacao ?? ""}`,
      cstat: evidencia?.cstat,
      httpStatus: evidencia?.geranet_http_status,
    })
  ) {
    return "aguardando_reconciliacao";
  }

  if (
    statusAtual === "rejeitada" &&
    emissaoRejeicaoTecnicaRecuperavel({
      status: statusAtual,
      cstat: evidencia?.cstat,
      motivo: evidencia?.motivo,
      geranet_http_status: evidencia?.geranet_http_status,
      erro_comunicacao: evidencia?.erro_comunicacao,
    })
  ) {
    return "aguardando_reconciliacao";
  }

  if (
    evidenciaProcessamentoRemotoNaoConclusivo({
      ...evidencia,
      situacao,
    })
  ) {
    return "aguardando_reconciliacao";
  }

  if (
    situacao === "processando" &&
    statusAtual === "enviando"
  ) {
    return "aguardando_reconciliacao";
  }

  if (
    situacao === "nao_encontrada" &&
    statusAtual === "enviando"
  ) {
    return "aguardando_reconciliacao";
  }

  if (
    statusAtual === "aguardando_reconciliacao" &&
    (situacao === "processando" ||
      situacao === "nao_encontrada" ||
      situacao === "falha_consulta")
  ) {
    return "aguardando_reconciliacao";
  }

  return statusAtual;
}

export function mensagemConsulta(
  modelo: string,
  situacao: SituacaoConsultaFiscal,
  cstat: string | null,
  motivo: string | null
) {
  const nome = modelo === "65" ? "NFC-e" : "NF-e";
  const codigo = texto(cstat);

  if (situacao === "autorizada") {
    return `${nome} reconciliada: autorizada.`;
  }

  if (situacao === "rejeitada") {
    return codigo
      ? `${nome} reconciliada: rejeitada — cStat ${codigo}.`
      : `${nome} reconciliada: rejeitada.`;
  }

  if (situacao === "cancelada") {
    return `${nome} reconciliada: cancelada.`;
  }

  if (situacao === "processando") {
    if (ehErroTecnicoAmbiguo({ cstat, mensagem: motivo })) {
      return mensagemFalhaConsultaSefaz(modelo);
    }

    return "Documento ainda está sendo processado.";
  }

  if (situacao === "nao_encontrada") {
    return "Documento ainda não localizado na Geranet. Tente consultar novamente antes de retransmitir.";
  }

  return (
    motivo ||
    "Falha ao consultar a Geranet. O documento permanece em estado seguro."
  );
}

export function montarAtualizacaoEmissao({
  emissao,
  situacao,
  log,
  xml,
  pdf,
  origem,
}: {
  emissao: EmissaoParaConsulta;
  situacao: SituacaoConsultaFiscal;
  log: LogGeranetResumo | null;
  xml?: string | null;
  pdf?: string | null;
  origem: "manual" | "cron";
}) {
  const agora = new Date().toISOString();
  const cstat = texto(log?.cstat) || null;
  const motivo = texto(log?.mensagem) || null;
  const evidenciaConsulta = {
    cstat: cstat || texto(emissao.cstat) || null,
    motivo: motivo || texto(emissao.motivo) || null,
    geranet_http_status: log?.http_status ?? emissao.geranet_http_status,
    erro_comunicacao: emissao.erro_comunicacao,
    modelo: emissao.modelo,
  };
  const statusLocal = decidirStatusLocal(
    emissao.status,
    situacao,
    evidenciaConsulta
  );
  const processamentoRemoto = evidenciaProcessamentoRemotoNaoConclusivo({
    ...evidenciaConsulta,
    situacao,
  });
  const chave = somenteDigitos(log?.chave) || somenteDigitos(emissao.chave_acesso) || null;
  const protocolo =
    somenteDigitos(log?.protocolo) || somenteDigitos(emissao.protocolo) || null;
  const xmlCandidato = texto(xml) || texto(log?.xml) || "";
  const pdfCandidato = texto(pdf) || texto(log?.pdf) || "";
  const xmlFinal = documentoFiscalEhPlaceholder(xmlCandidato)
    ? null
    : hexDocumentoFiscalPersistivel(xmlCandidato, "xml") || xmlCandidato || null;
  const pdfFinal = documentoFiscalEhPlaceholder(pdfCandidato)
    ? null
    : hexDocumentoFiscalPersistivel(pdfCandidato, "pdf") || pdfCandidato || null;

  const consultaSnapshot = {
    em: agora,
    origem,
    situacao_encontrada: situacao,
    status_local: statusLocal,
    log_id: log?.id ?? null,
    endpoint: log?.endpoint ?? null,
    cstat,
    chave: chave ? `${chave.slice(0, 8)}…${chave.slice(-4)}` : null,
    protocolo,
    mensagem: motivo,
    xml_disponivel: Boolean(xmlFinal),
    pdf_disponivel: Boolean(pdfFinal),
  };

  const respostaAnterior = objeto(emissao.resposta_resumo);
  const historicoAnterior = array(respostaAnterior.historico);
  const historico = [...historicoAnterior];
  const classificacaoAnterior = texto(respostaAnterior.classificacao).toLowerCase();
  const situacaoRemotaAnterior = texto(respostaAnterior.situacao_remota).toLowerCase();
  const mensagemSituacao = mensagemConsulta(
    emissao.modelo,
    situacao,
    cstat,
    motivo
  );

  if (
    emissao.status === "rejeitada" &&
    statusLocal !== "rejeitada"
  ) {
    historico.push({
      em: agora,
      tipo: "erro_tecnico_original",
      status: "rejeitada",
      cstat: texto(emissao.cstat) || null,
      motivo: texto(emissao.motivo) || null,
      nota: MENSAGEM_FALHA_TECNICA_CONSULTA,
    });
  }

  historico.push({
    em: agora,
    tipo: "reconciliacao",
    situacao,
    status_local: statusLocal,
  });

  const respostaResumo: Record<string, unknown> = {
    ...respostaAnterior,
    consulta: consultaSnapshot,
    historico,
  };

  if (statusLocal === "autorizada") {
    respostaResumo.classificacao = "autorizada";
    respostaResumo.origem_classificacao = "consulta_geranet";
    respostaResumo.situacao_remota = "autorizada";
  } else if (statusLocal === "rejeitada") {
    respostaResumo.classificacao = "rejeitada";
    respostaResumo.origem_classificacao = "consulta_geranet";
    respostaResumo.situacao_remota = "rejeitada";
  } else if (statusLocal === "cancelada") {
    respostaResumo.classificacao = "cancelada";
    respostaResumo.origem_classificacao = "consulta_geranet";
    respostaResumo.situacao_remota = "cancelada";
  } else if (statusLocal === "aguardando_reconciliacao") {
    if (
      !classificacaoAnterior ||
      classificacaoAnterior === "erro_envio" ||
      !CLASSIFICACAO_AMBIGUA_RESUMO.has(classificacaoAnterior)
    ) {
      respostaResumo.classificacao = "ambigua";
    }

    if (processamentoRemoto) {
      respostaResumo.origem_classificacao = "consulta_geranet";
      respostaResumo.situacao_remota = "processando";
      respostaResumo.mensagem = mensagemSituacao;
    } else if (situacaoRemotaAnterior === "processando") {
      respostaResumo.situacao_remota = "processando";
      respostaResumo.origem_classificacao =
        texto(respostaAnterior.origem_classificacao) || "consulta_geranet";
      if (classificacaoAnterior === "erro_envio" || !classificacaoAnterior) {
        respostaResumo.classificacao = "ambigua";
      }
    } else {
      respostaResumo.origem_classificacao = "consulta_geranet";
      if (!situacaoRemotaAnterior) {
        respostaResumo.situacao_remota =
          situacao === "processando" ? "consulta_tecnica" : situacao;
      }
    }
  }

  const motivoPersistido =
    statusLocal === "autorizada"
      ? motivo || "Autorizado o uso da NF-e."
      : statusLocal === "rejeitada"
        ? motivo || "Documento rejeitado."
        : statusLocal === "cancelada"
          ? motivo || "Documento cancelado."
          : statusLocal === "aguardando_reconciliacao" && processamentoRemoto
            ? mensagemSituacao
            : statusLocal === "aguardando_reconciliacao" &&
                (situacao === "falha_consulta" || situacao === "nao_encontrada") &&
                texto(emissao.motivo)
              ? texto(emissao.motivo)
              : texto(emissao.motivo) || motivo || mensagemSituacao;

  const patch: Record<string, unknown> = {
    status: statusLocal,
    motivo: motivoPersistido,
    resposta_resumo: respostaResumo,
    respondida_at: agora,
  };

  if (log?.id) {
    patch.geranet_log_id = log.id;
  }

  if (cstat) {
    patch.cstat = cstat;
  }

  if (log?.http_status) {
    patch.geranet_http_status = log.http_status;
  }

  if (log?.situacao) {
    patch.geranet_situacao = log.situacao;
  }

  if (statusLocal === "autorizada") {
    if (chave) {
      patch.chave_acesso = chave;
    }

    if (protocolo) {
      patch.protocolo = protocolo;
    }

    patch.erro_comunicacao = null;

    if (!emissao.autorizada_at) {
      patch.autorizada_at = agora;
    }

    if (emissao.tipo_emissao === "contingencia_offline") {
      patch.contingencia_erro = null;
      patch.contingencia_transmitida_at = agora;
    }
  }

  if (statusLocal === "cancelada") {
    if (chave) {
      patch.chave_acesso = chave;
    }

    if (protocolo) {
      patch.protocolo = protocolo;
    }

    if (!emissao.cancelada_at) {
      patch.cancelada_at = agora;
    }
  }

  if (statusLocal === "rejeitada") {
    patch.erro_comunicacao = null;
  }

  if (
    situacao === "processando" ||
    situacao === "nao_encontrada" ||
    situacao === "falha_consulta"
  ) {
    patch.erro_comunicacao =
      situacao === "falha_consulta"
        ? motivo || "Falha ao consultar logs da Geranet."
        : null;
  }

  if (xmlFinal && !texto(emissao.xml_hex)) {
    patch.xml_hex = xmlFinal;
  }

  if (pdfFinal && !texto(emissao.pdf_hex)) {
    patch.pdf_hex = pdfFinal;
  }

  if (
    emissao.tipo_emissao === "contingencia_offline" &&
    situacao === "processando" &&
    xmlFinal &&
    !texto(emissao.xml_contingencia_hex)
  ) {
    patch.xml_contingencia_hex = xmlFinal;
    if (statusLocal === "aguardando_reconciliacao") {
      patch.status = "aguardando_transmissao_contingencia";
    }
  }

  return {
    patch,
    status_local: String(patch.status),
    situacao,
    mensagem: mensagemSituacao,
    chave,
    protocolo,
    cstat,
    motivo,
    snapshot: consultaSnapshot,
  };
}
