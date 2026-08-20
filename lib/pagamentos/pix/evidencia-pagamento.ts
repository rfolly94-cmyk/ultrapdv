import { sanitizarRespostaPix } from "./sanitizar";
import type {
  ContratoPixGeranet,
  EvidenciaPagamentoPixGeranet,
} from "./types";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function objeto(valor: unknown): Record<string, unknown> {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }

  return {};
}

function fontesResposta(resposta: Record<string, unknown>) {
  const dados = objeto(resposta.dados);
  const interno = objeto(dados.dados);
  const cobranca = objeto(dados.cobranca ?? dados.pix ?? dados.loc);
  return [dados, interno, cobranca, resposta];
}

function primeiroTexto(
  fontes: Record<string, unknown>[],
  chaves: string[]
) {
  for (const fonte of fontes) {
    for (const chave of chaves) {
      const valor = texto(fonte[chave]);
      if (valor) {
        return valor;
      }
    }
  }

  return null;
}

function numeroFlexivel(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return valor;
  }

  if (typeof valor === "string" && valor.trim()) {
    const normalizado = Number(valor.replace(",", "."));
    if (Number.isFinite(normalizado)) {
      return normalizado;
    }
  }

  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    const original = numeroFlexivel(
      (valor as { original?: unknown }).original
    );
    if (original != null) {
      return original;
    }
  }

  return null;
}

function primeiroNumero(
  fontes: Record<string, unknown>[],
  chaves: string[]
) {
  for (const fonte of fontes) {
    for (const chave of chaves) {
      const valor = numeroFlexivel(fonte[chave]);
      if (valor != null) {
        return valor;
      }
    }
  }

  return null;
}

function pixRecebido(fontes: Record<string, unknown>[]) {
  for (const fonte of fontes) {
    const lista = fonte.pix;
    if (Array.isArray(lista) && lista[0] && typeof lista[0] === "object") {
      return lista[0] as Record<string, unknown>;
    }
  }

  return null;
}

/**
 * Status oficiais da cobrança imediata BACEN Pix Cob.
 * Fonte: API Pix BACEN — não usar o envelope Geranet (`situacao`).
 */
const BACEN_PAGO = new Set(["CONCLUIDA"]);
const BACEN_PENDENTE = new Set(["ATIVA"]);
const BACEN_CANCELADO = new Set([
  "REMOVIDA_PELO_USUARIO_RECEBEDOR",
  "REMOVIDA_PELO_PSP",
]);
const BACEN_EXPIRADO = new Set(["EXPIRADA"]);

const CHAVES_STATUS_COBRANCA = [
  "status",
  "statusCobranca",
  "situacaoCobranca",
  "situacaoPix",
];

export function valoresPixCompativeis(
  esperado: number,
  recebido?: number | null
) {
  if (recebido == null || !Number.isFinite(recebido)) {
    return true;
  }

  return Math.round(esperado * 100) === Math.round(recebido * 100);
}

export function montarContratoPixGeranet(
  resposta: Record<string, unknown>
): ContratoPixGeranet {
  const fontes = fontesResposta(resposta);
  const pix = pixRecebido(fontes);
  const sanitizado = sanitizarRespostaPix(resposta);

  return {
    txid: primeiroTexto(fontes, ["txid", "txId", "TXID"]),
    statusExterno: primeiroTexto(fontes, CHAVES_STATUS_COBRANCA),
    pago: false,
    valor: primeiroNumero(fontes, ["valor", "valorOriginal", "valorCobranca"]),
    valorPago:
      numeroFlexivel(pix?.valor) ??
      primeiroNumero(fontes, ["valorPago", "valor_pago", "valorRecebido"]),
    pixCopiaECola: primeiroTexto(fontes, [
      "pixCopiaECola",
      "copiaECola",
      "copiaCola",
      "brCode",
      "emv",
      "payload",
    ]),
    qrCode: primeiroTexto(fontes, [
      "qrCode",
      "qrcode",
      "imagemQrcode",
      "imagemQrCode",
      "qrCodeBase64",
    ]),
    expiracao: primeiroTexto(fontes, [
      "expiracao",
      "calendario",
      "expiraEm",
      "expira_em",
    ]),
    identificador: primeiroTexto(fontes, [
      "identificador",
      "locationId",
      "loc",
      "id",
    ]),
    dadosPublicosSanitizados:
      sanitizado && typeof sanitizado === "object" && !Array.isArray(sanitizado)
        ? (sanitizado as Record<string, unknown>)
        : {},
  };
}

export function normalizarStatusPagamentoPixGeranet({
  provedor,
  httpStatus,
  situacaoGeranet,
  resposta,
}: {
  provedor?: string | null;
  httpStatus?: number | null;
  situacaoGeranet?: string | null;
  resposta: Record<string, unknown>;
}): EvidenciaPagamentoPixGeranet {
  void provedor;
  void situacaoGeranet;

  if (httpStatus != null && httpStatus >= 500) {
    return {
      estado: "falha_temporaria",
      evidencia: "http_5xx_nao_altera_status",
    };
  }

  if (httpStatus != null && httpStatus >= 400) {
    return {
      estado: "falha_cliente",
      evidencia: "http_4xx_nao_marca_pago",
    };
  }

  const contrato = montarContratoPixGeranet(resposta);
  const status = (contrato.statusExterno ?? "").toUpperCase();
  const pix = pixRecebido(fontesResposta(resposta));
  const pagoEm = texto(pix?.horario) || null;

  if (!status) {
    return {
      estado: "indeterminado",
      evidencia: "sem_status_bacen_comprovado",
      valorPago: contrato.valorPago,
      valorCobranca: contrato.valor,
      statusExterno: contrato.statusExterno,
    };
  }

  if (BACEN_PAGO.has(status)) {
    return {
      estado: "pago",
      evidencia: "bacen_cob_concluida",
      valorPago: contrato.valorPago,
      valorCobranca: contrato.valor,
      pagoEm,
      statusExterno: contrato.statusExterno,
    };
  }

  if (BACEN_PENDENTE.has(status)) {
    return {
      estado: "pendente",
      evidencia: "bacen_cob_ativa",
      valorPago: contrato.valorPago,
      valorCobranca: contrato.valor,
      statusExterno: contrato.statusExterno,
    };
  }

  if (BACEN_CANCELADO.has(status)) {
    return {
      estado: "cancelado",
      evidencia: "bacen_cob_removida",
      statusExterno: contrato.statusExterno,
    };
  }

  if (BACEN_EXPIRADO.has(status)) {
    return {
      estado: "expirado",
      evidencia: "status_externo_expirada",
      statusExterno: contrato.statusExterno,
    };
  }

  return {
    estado: "indeterminado",
    evidencia: "status_provedor_aguardando_mapeamento",
    valorPago: contrato.valorPago,
    valorCobranca: contrato.valor,
    statusExterno: contrato.statusExterno,
  };
}
