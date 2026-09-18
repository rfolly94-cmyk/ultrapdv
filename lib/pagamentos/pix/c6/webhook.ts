import { sanitizarRespostaPix } from "../sanitizar";
import { MENSAGEM_C6_WEBHOOK_HTTPS } from "./regras";

const CAMINHO_WEBHOOK_C6 = "/api/webhooks/pix/c6";
export const LIMITE_BODY_WEBHOOK_C6_BYTES = 64 * 1024;

function txidLimpo(valor: unknown) {
  const txid = String(valor ?? "").trim();
  if (!txid || txid.length < 26 || txid.length > 35) {
    return "";
  }
  if (!/^[a-zA-Z0-9]+$/.test(txid)) {
    return "";
  }
  return txid;
}

function coletarTxids(valor: unknown, saida: Set<string>, profundidade: number) {
  if (profundidade > 6 || valor == null) {
    return;
  }

  if (Array.isArray(valor)) {
    for (const item of valor) {
      coletarTxids(item, saida, profundidade + 1);
    }
    return;
  }

  if (typeof valor !== "object") {
    return;
  }

  const obj = valor as Record<string, unknown>;
  const direto = txidLimpo(obj.txid);
  if (direto) {
    saida.add(direto);
  }

  coletarTxids(obj.pix, saida, profundidade + 1);
  coletarTxids(obj.pixs, saida, profundidade + 1);
  coletarTxids(obj.cobranca, saida, profundidade + 1);
  coletarTxids(obj.data, saida, profundidade + 1);
}

export function extrairTxidsWebhookC6(payload: unknown) {
  const saida = new Set<string>();
  coletarTxids(payload, saida, 0);
  return [...saida];
}

export function empresaIdExternaWebhookC6(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  return String((payload as Record<string, unknown>).empresa_id ?? "").trim();
}

export function urlPublicaWebhookPixC6() {
  const origem = String(process.env.NEXT_PUBLIC_SITE_URL ?? "")
    .trim()
    .replace(/\/$/, "");

  if (
    !origem ||
    !origem.startsWith("https://") ||
    /localhost|127\.0\.0\.1/i.test(origem)
  ) {
    throw new Error(MENSAGEM_C6_WEBHOOK_HTTPS);
  }

  return `${origem}${CAMINHO_WEBHOOK_C6}`;
}

export function eventoWebhookC6Sanitizado(payload: unknown) {
  return sanitizarRespostaPix({
    chaves: payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload as Record<string, unknown>).slice(0, 20)
      : [],
    txids: extrairTxidsWebhookC6(payload),
    tipo: Array.isArray(payload) ? "array" : typeof payload,
  });
}

export function mascararE2eid(valor: unknown) {
  const texto = String(valor ?? "").trim();
  if (!texto) {
    return null;
  }
  if (texto.length < 8) {
    return "••••";
  }
  return `${texto.slice(0, 4)}••••${texto.slice(-4)}`;
}
