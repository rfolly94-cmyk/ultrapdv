import { valoresPixInformadosCompativeis } from "../evidencia-pagamento";
import type { EstadoPagamentoPixGeranet, StatusCobrancaPix } from "../types";

const STATUS_NAO_REBAIXAVEIS = new Set<StatusCobrancaPix>([
  "paga",
  "vinculado_venda",
]);

export function ehE2eidPixC6Valido(valor: unknown) {
  const texto = String(valor ?? "").trim();
  return /^[a-zA-Z0-9]{32}$/.test(texto);
}

export function pixRecebidoC6(resposta: Record<string, unknown> | null | undefined) {
  const pix = resposta?.pix;
  if (!Array.isArray(pix) || !pix[0] || typeof pix[0] !== "object") {
    return null;
  }
  return pix[0] as Record<string, unknown>;
}

export function e2eidDeRespostaC6(resposta: Record<string, unknown> | null | undefined) {
  const primeiro = pixRecebidoC6(resposta);
  if (!primeiro) {
    return null;
  }

  const e2eid = String(
    primeiro.endToEndId ?? primeiro.e2eId ?? primeiro.e2eid ?? ""
  ).trim();
  return ehE2eidPixC6Valido(e2eid) ? e2eid : e2eid || null;
}

export function valorPagoDeRespostaC6(
  resposta: Record<string, unknown> | null | undefined
) {
  const primeiro = pixRecebidoC6(resposta);
  const bruto = primeiro?.valor;
  if (typeof bruto === "number" && Number.isFinite(bruto)) {
    return bruto;
  }
  if (typeof bruto === "string" && bruto.trim()) {
    const normalizado = Number(bruto.replace(",", "."));
    if (Number.isFinite(normalizado)) {
      return normalizado;
    }
  }
  return null;
}

export function e2eidConflitaComOutraCobranca(params: {
  e2eid: string | null;
  cobrancaIdAtual: string;
  outras: Array<{ id?: unknown; e2eid?: unknown }>;
}) {
  const e2eid = String(params.e2eid ?? "").trim();
  if (!ehE2eidPixC6Valido(e2eid)) {
    return false;
  }

  return params.outras.some((item) => {
    const id = String(item.id ?? "").trim();
    const outro = String(item.e2eid ?? "").trim();
    return id !== "" && id !== params.cobrancaIdAtual && outro === e2eid;
  });
}

export function e2eidDaCobrancaC6(cobranca: Record<string, unknown>) {
  const coluna = String(cobranca.e2eid ?? "").trim();
  if (ehE2eidPixC6Valido(coluna)) {
    return coluna;
  }

  const dados =
    cobranca.dados_publicos && typeof cobranca.dados_publicos === "object"
      ? (cobranca.dados_publicos as Record<string, unknown>)
      : {};
  const json = String(dados.e2eid ?? "").trim();
  return ehE2eidPixC6Valido(json) ? json : json || null;
}

export function decidirStatusPagamentoC6(params: {
  statusAtual: StatusCobrancaPix;
  estado: EstadoPagamentoPixGeranet;
  valorCobranca: number;
  valorPago?: number | null;
  e2eid?: string | null;
  pixPresente?: boolean;
  e2eidDuplicado?: boolean;
}): { status: StatusCobrancaPix; motivo: string } {
  if (STATUS_NAO_REBAIXAVEIS.has(params.statusAtual)) {
    return { status: params.statusAtual, motivo: "idempotente" };
  }

  if (
    params.estado === "falha_temporaria" ||
    params.estado === "falha_cliente" ||
    params.estado === "indeterminado"
  ) {
    return { status: params.statusAtual, motivo: params.estado };
  }

  if (params.estado === "pago") {
    if (!params.pixPresente) {
      return { status: params.statusAtual, motivo: "pix_ausente" };
    }

    if (params.valorPago == null || !Number.isFinite(params.valorPago)) {
      return { status: params.statusAtual, motivo: "valor_ausente" };
    }

    if (!valoresPixInformadosCompativeis(params.valorCobranca, params.valorPago)) {
      return { status: "divergencia_valor", motivo: "valor_divergente" };
    }

    if (!ehE2eidPixC6Valido(params.e2eid)) {
      return { status: params.statusAtual, motivo: "e2eid_ausente" };
    }

    if (params.e2eidDuplicado) {
      return { status: params.statusAtual, motivo: "e2eid_duplicado" };
    }

    return { status: "paga", motivo: "evidencia_completa" };
  }

  if (params.estado === "cancelado") {
    return { status: "cancelada", motivo: "cancelado" };
  }

  if (params.estado === "expirado") {
    return { status: "expirada", motivo: "expirado" };
  }

  return {
    status: params.statusAtual === "erro" ? "pendente" : params.statusAtual,
    motivo: "pendente",
  };
}
