import type { LogoPdfRecibo, LogoReciboResolvida } from "./logo-recibo";
import { prepararImagemPdf } from "./pdf-imagem";

const LARGURA_MAX = 1024;
const ALTURA_MAX = 1024;

async function converterComSharp(bytes: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(bytes)
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(LARGURA_MAX, ALTURA_MAX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function mimeAposNormalizar(bytes: Buffer): LogoPdfRecibo["mime"] {
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/png";
}

export async function normalizarLogoParaPdf(
  bytes: Buffer | null | undefined,
  mime?: LogoPdfRecibo["mime"] | null
): Promise<Pick<LogoPdfRecibo, "bytes" | "mime"> | null> {
  if (!bytes?.length) {
    return null;
  }

  if (prepararImagemPdf(bytes, mime)) {
    return { bytes, mime: mimeAposNormalizar(bytes) };
  }

  const convertida = await converterComSharp(bytes);
  if (convertida && prepararImagemPdf(convertida, "image/png")) {
    return { bytes: convertida, mime: "image/png" };
  }

  return null;
}

export async function logoResolvidaParaPdf(
  resolvida: LogoReciboResolvida,
  extra: Pick<LogoPdfRecibo, "alinhamento" | "tamanho">
): Promise<LogoPdfRecibo | null> {
  const normalizada = await normalizarLogoParaPdf(
    resolvida.bytes,
    resolvida.mime
  );
  if (!normalizada) {
    return null;
  }
  return {
    ...normalizada,
    alinhamento: extra.alinhamento,
    tamanho: extra.tamanho,
  };
}

export function pdfContemLogoIncorporada(pdf: Uint8Array) {
  const texto = Buffer.from(pdf).toString("latin1");
  return (
    texto.startsWith("%PDF-") &&
    texto.includes("/Subtype /Image") &&
    texto.includes("/Im1 Do") &&
    !texto.includes("storage/v1/object")
  );
}

export function formatoLogoNoPdf(pdf: Uint8Array) {
  const texto = Buffer.from(pdf).toString("latin1");
  if (!pdfContemLogoIncorporada(pdf)) {
    return null;
  }
  if (texto.includes("/Filter /DCTDecode")) {
    return "jpeg-dct" as const;
  }
  if (texto.includes("/Filter /FlateDecode")) {
    return "png-rgb-flate" as const;
  }
  return "imagem-xobject" as const;
}
