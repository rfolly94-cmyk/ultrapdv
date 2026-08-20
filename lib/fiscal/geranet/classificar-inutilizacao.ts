export type SituacaoInutilizacao =
  | "inutilizada"
  | "rejeitada"
  | "processando"
  | "nao_encontrada"
  | "falha_consulta"
  | "bloqueada";

export type EmissaoParaInutilizacao = {
  id: string;
  modelo: string;
  serie: number | string;
  numero: number | string;
  ambiente: number | string;
  status: string;
  chave_acesso?: string | null;
  protocolo?: string | null;
  reservada_at?: string | null;
  created_at?: string | null;
  enviada_at?: string | null;
  autorizada_at?: string | null;
  cancelada_at?: string | null;
};

export type EventoInutilizacao = {
  id?: string;
  status: string;
  tentativas?: number | null;
  justificativa?: string | null;
  cstat?: string | null;
  protocolo?: string | null;
  motivo?: string | null;
};

export type LogInutilizacao = {
  id: number | null;
  endpoint: string | null;
  criado_em: string | null;
  http_status: number | null;
  sucesso: boolean | null;
  situacao: string | null;
  mensagem: string | null;
  cstat: string | null;
  protocolo: string | null;
  xml: string | null;
  modelo: string | null;
  serie: string | null;
  ano: string | null;
  numero_inicial: string | null;
  numero_final: string | null;
  ambiente: string | null;
  acao: string | null;
};

const STATUS_AMBIGUOS = new Set([
  "aguardando_reconciliacao",
  "enviando",
  "erro_comunicacao",
  "transmitindo_contingencia",
]);

const STATUS_BLOQUEADOS = new Set([
  "autorizada",
  "cancelada",
  ...STATUS_AMBIGUOS,
]);

const CSTAT_INUTILIZADA = new Set(["102", "241", "563"]);

export function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function numeroFiscal(valor: unknown) {
  const digits = somenteDigitos(valor);
  return digits ? String(BigInt(digits)) : "";
}

export function objeto(valor: unknown): Record<string, unknown> {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }

  return {};
}

export function anoFiscalDaEmissao({
  reservadaAt,
  createdAt,
  fusoHorario,
}: {
  reservadaAt?: string | null;
  createdAt?: string | null;
  fusoHorario?: string | null;
}) {
  const origem = texto(reservadaAt) || texto(createdAt) || new Date().toISOString();
  const data = new Date(origem);
  const fuso = texto(fusoHorario) || "America/Cuiaba";

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
    }).format(data);
  } catch {
    return String(data.getUTCFullYear());
  }
}

export function validarJustificativaInutilizacao(justificativa: unknown) {
  const valor = texto(justificativa);

  if (valor.length < 15) {
    return "A justificativa da inutilização deve ter pelo menos 15 caracteres.";
  }

  if (valor.length > 255) {
    return "A justificativa da inutilização deve ter no máximo 255 caracteres.";
  }

  return null;
}

export function motivoBloqueioInutilizacao(emissao: EmissaoParaInutilizacao) {
  const status = texto(emissao.status);

  if (status === "autorizada") {
    return "Não é possível inutilizar uma numeração já autorizada.";
  }

  if (status === "cancelada") {
    return "Não é possível inutilizar uma numeração de documento cancelado.";
  }

  if (STATUS_AMBIGUOS.has(status)) {
    return "Antes de inutilizar esta numeração, consulte a situação fiscal para confirmar que o documento não foi autorizado.";
  }

  if (status === "inutilizada") {
    return null;
  }

  if (status !== "aguardando_inutilizacao") {
    return `Somente numeração aguardando inutilização pode ser enviada à SEFAZ. Status atual: ${status}.`;
  }

  return null;
}

export function podeIniciarInutilizacao(
  emissao: EmissaoParaInutilizacao,
  evento: EventoInutilizacao | null
): { ok: boolean; motivo: string | null; reutilizar?: boolean } {
  if (texto(emissao.status) === "inutilizada") {
    return {
      ok: true,
      motivo: null,
      reutilizar: true,
    };
  }

  const bloqueio = motivoBloqueioInutilizacao(emissao);
  if (bloqueio) {
    return { ok: false, motivo: bloqueio };
  }

  if (!evento) {
    return { ok: true, motivo: null };
  }

  if (evento.status === "sucesso" && texto(emissao.status) === "inutilizada") {
    return { ok: true, motivo: null, reutilizar: true };
  }

  if (
    evento.status === "processando" ||
    evento.status === "aguardando_reconciliacao"
  ) {
    return {
      ok: false,
      motivo:
        "Já existe uma inutilização enviada com resultado pendente. Consulte a situação fiscal; não reenvie automaticamente.",
    };
  }

  return { ok: true, motivo: null };
}

export function reservaAposTentativaAnterior(statusExistente: string | null) {
  const status = texto(statusExistente);

  if (!status) {
    return "criar_nova" as const;
  }

  if (status === "inutilizada") {
    return "criar_nova" as const;
  }

  if (status === "aguardando_inutilizacao") {
    return "bloquear" as const;
  }

  return "reusar" as const;
}

export function classificarRespostaInutilizacao({
  httpOk,
  httpStatus,
  situacao,
  cstat,
  protocolo,
  mensagem,
}: {
  httpOk: boolean;
  httpStatus: number;
  situacao?: string | null;
  cstat?: string | null;
  protocolo?: string | null;
  mensagem?: string | null;
}): SituacaoInutilizacao {
  const sit = texto(situacao).toLowerCase();
  const codigo = texto(cstat);
  const textoMsg = texto(mensagem);

  if (CSTAT_INUTILIZADA.has(codigo)) {
    return "inutilizada";
  }

  if (
    httpOk &&
    sit === "sucesso" &&
    (texto(protocolo) || /inutiliz/i.test(textoMsg))
  ) {
    return "inutilizada";
  }

  if (sit === "erro" || (!httpOk && httpStatus > 0 && httpStatus < 500)) {
    return "rejeitada";
  }

  if (!httpOk || httpStatus >= 500 || sit === "") {
    return "processando";
  }

  return "processando";
}

export function classificarLogInutilizacao(log: LogInutilizacao): SituacaoInutilizacao {
  return classificarRespostaInutilizacao({
    httpOk: Boolean(log.sucesso) || texto(log.situacao).toLowerCase() === "sucesso",
    httpStatus: Number(log.http_status ?? 0),
    situacao: log.situacao,
    cstat: log.cstat,
    protocolo: log.protocolo,
    mensagem: log.mensagem,
  });
}

export function logInutilizacaoCompativel(
  emissao: EmissaoParaInutilizacao,
  ano: string,
  log: LogInutilizacao
) {
  const modeloOk =
    !texto(log.modelo) || texto(log.modelo) === texto(emissao.modelo);
  const serieOk =
    !texto(log.serie) ||
    numeroFiscal(log.serie) === numeroFiscal(emissao.serie);
  const numeroOk =
    (!texto(log.numero_inicial) ||
      numeroFiscal(log.numero_inicial) === numeroFiscal(emissao.numero)) &&
    (!texto(log.numero_final) ||
      numeroFiscal(log.numero_final) === numeroFiscal(emissao.numero));
  const anoOk = !texto(log.ano) || texto(log.ano) === texto(ano);
  const ambienteOk =
    !texto(log.ambiente) ||
    numeroFiscal(log.ambiente) === numeroFiscal(emissao.ambiente);
  const acaoOk =
    !texto(log.acao) ||
    /inutilizar/i.test(texto(log.acao)) ||
    /inutilizar/i.test(texto(log.endpoint));

  return modeloOk && serieOk && numeroOk && anoOk && ambienteOk && acaoOk;
}

export function mensagemInutilizacao(
  situacao: SituacaoInutilizacao,
  cstat: string | null,
  motivo: string | null
) {
  if (situacao === "inutilizada") {
    return cstat
      ? `Inutilização homologada: cStat ${cstat}.`
      : "Inutilização homologada pela SEFAZ.";
  }

  if (situacao === "rejeitada") {
    return cstat
      ? `Inutilização rejeitada: cStat ${cstat}${motivo ? ` — ${motivo}` : "."}`
      : motivo || "Inutilização rejeitada.";
  }

  if (situacao === "processando") {
    return "Inutilização enviada, mas o resultado ainda é ambíguo. Consulte a situação antes de reenviar.";
  }

  if (situacao === "nao_encontrada") {
    return "A inutilização ainda não foi localizada nos logs da Geranet. Tente consultar novamente.";
  }

  return motivo || "Falha ao consultar a inutilização.";
}

export function montarPayloadInutilizacaoGeranet({
  cnpj,
  serie,
  ano,
  numero,
  justificativa,
  certificadoDigital,
  senhaCertificadoDigital,
  ambiente,
  modelo,
  ufEmitente,
}: {
  cnpj: string;
  serie: number | string;
  ano: string;
  numero: number | string;
  justificativa: string;
  certificadoDigital: string;
  senhaCertificadoDigital: string;
  ambiente: number | string;
  modelo: string;
  ufEmitente: string;
}) {
  return {
    acao: "inutilizarNumeracao",
    modeloDocumento: "nfe",
    cnpj: somenteDigitos(cnpj),
    serie: String(serie),
    ano: texto(ano),
    numeroInicial: String(numero),
    numeroFinal: String(numero),
    justificativa: texto(justificativa),
    certificadoDigital,
    senhaCertificadoDigital,
    ambiente: String(ambiente),
    modelo: texto(modelo),
    ufEmitente: texto(ufEmitente).toUpperCase(),
  };
}

export function aplicarConsultaInutilizacao({
  emissaoStatus,
  situacao,
}: {
  emissaoStatus: string;
  situacao: SituacaoInutilizacao;
}) {
  if (emissaoStatus === "inutilizada") {
    return "inutilizada";
  }

  if (situacao === "inutilizada") {
    return "inutilizada";
  }

  return "aguardando_inutilizacao";
}

export function resumoPayloadInutilizacao(
  payload: ReturnType<typeof montarPayloadInutilizacaoGeranet>
) {
  return {
    acao: payload.acao,
    modeloDocumento: payload.modeloDocumento,
    cnpj: payload.cnpj,
    serie: payload.serie,
    ano: payload.ano,
    numeroInicial: payload.numeroInicial,
    numeroFinal: payload.numeroFinal,
    justificativa: payload.justificativa,
    ambiente: payload.ambiente,
    modelo: payload.modelo,
    ufEmitente: payload.ufEmitente,
  };
}
