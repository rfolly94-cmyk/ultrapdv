import type { RespostaPixNormalizada } from "./types";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function objeto(valor: unknown): Record<string, unknown> {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }

  return {};
}

function primeiroTexto(
  fonte: Record<string, unknown>,
  chaves: string[]
) {
  for (const chave of chaves) {
    const valor = texto(fonte[chave]);
    if (valor) {
      return valor;
    }
  }

  return null;
}

function coletarFontes(resposta: Record<string, unknown>) {
  const dados = objeto(resposta.dados);
  const interno = objeto(dados.dados);
  const cobranca = objeto(dados.cobranca ?? dados.pix ?? dados.loc);
  return [resposta, dados, interno, cobranca];
}

const CHAVES_TXID = ["txid", "txId", "TXID"];
const CHAVES_STATUS = [
  "status",
  "statusCobranca",
  "situacaoCobranca",
  "situacaoPix",
];
const CHAVES_COPIA = [
  "pixCopiaECola",
  "copiaECola",
  "copiaCola",
  "brCode",
  "emv",
  "payload",
];
const CHAVES_QR = [
  "qrCode",
  "qrcode",
  "imagemQrcode",
  "imagemQrCode",
  "qrCodeBase64",
];
const CHAVES_ID = ["identificador", "locationId", "loc", "id"];

export function normalizarRespostaPix(
  resposta: Record<string, unknown>
): RespostaPixNormalizada {
  const fontes = coletarFontes(resposta);
  let txid: string | null = null;
  let statusProvedor: string | null = null;
  let copiaECola: string | null = null;
  let qrCode: string | null = null;
  let identificador: string | null = null;

  for (const fonte of fontes) {
    txid = txid ?? primeiroTexto(fonte, CHAVES_TXID);
    statusProvedor = statusProvedor ?? primeiroTexto(fonte, CHAVES_STATUS);
    copiaECola = copiaECola ?? primeiroTexto(fonte, CHAVES_COPIA);
    qrCode = qrCode ?? primeiroTexto(fonte, CHAVES_QR);
    identificador = identificador ?? primeiroTexto(fonte, CHAVES_ID);
  }

  const status = (statusProvedor ?? "").toUpperCase();
  const pago =
    status === "CONCLUIDA" ||
    status === "PAGA" ||
    status === "PAID" ||
    status === "LIQUIDADO" ||
    status === "RECEBIDO";
  const cancelado =
    status === "REMOVIDA_PELO_USUARIO_RECEBEDOR" ||
    status === "REMOVIDA_PELO_PSP" ||
    status === "CANCELADA" ||
    status === "CANCELED";

  return {
    txid,
    statusProvedor,
    copiaECola,
    qrCode,
    identificador,
    pago,
    cancelado,
  };
}
