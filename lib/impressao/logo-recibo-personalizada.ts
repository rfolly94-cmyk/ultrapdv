import { novaVersaoLogo, sanitizarVersaoLogo } from "@/lib/empresa/logo";
import { logoUrlUtilizavel } from "@/lib/empresa/logo-url";

export const BUCKET_RECIBOS_LOGOS = "recibos-logos";
export const TAMANHO_MAXIMO_LOGO_RECIBO_BYTES = 2 * 1024 * 1024;

export const FONTES_LOGO_RECIBO = ["empresa", "personalizada"] as const;
export type FonteLogoRecibo = (typeof FONTES_LOGO_RECIBO)[number];

export const TAMANHOS_LOGO_RECIBO = ["pequena", "media", "grande"] as const;
export type TamanhoLogoRecibo = (typeof TAMANHOS_LOGO_RECIBO)[number];

export const ALINHAMENTOS_LOGO_RECIBO = ["esquerda", "centro", "direita"] as const;
export type AlinhamentoLogoRecibo = (typeof ALINHAMENTOS_LOGO_RECIBO)[number];

export type TipoLogoRecibo = "image/png" | "image/jpeg" | "image/webp";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function detectarTipoLogoRecibo(buffer: Buffer): TipoLogoRecibo | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(PNG_MAGIC)) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_MAGIC)) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function extensaoLogoRecibo(tipo: TipoLogoRecibo) {
  if (tipo === "image/png") {
    return "png";
  }
  if (tipo === "image/webp") {
    return "webp";
  }
  return "jpg";
}

export function caminhoLogoReciboPersonalizada(
  empresaId: string,
  tipo: TipoLogoRecibo,
  versao?: string
) {
  const empresa = String(empresaId ?? "").trim();
  const id = sanitizarVersaoLogo(versao) || sanitizarVersaoLogo(novaVersaoLogo());
  if (!empresa || !id) {
    throw new Error("Empresa não identificada para a logo do recibo.");
  }
  return `${empresa}/logo-${id}.${extensaoLogoRecibo(tipo)}`;
}

export function logoReciboPersonalizadaPertenceAEmpresa(
  empresaId: string,
  path: string | null | undefined
) {
  const empresa = String(empresaId ?? "").trim();
  const arquivo = String(path ?? "").trim();
  if (!empresa || !arquivo) {
    return false;
  }
  if (arquivo.startsWith("http://") || arquivo.startsWith("https://")) {
    return false;
  }
  if (arquivo.includes("..") || arquivo.includes("\\")) {
    return false;
  }
  return (
    arquivo.startsWith(`${empresa}/`) &&
    /^[0-9a-f-]{36}\/logo-[a-zA-Z0-9-]+\.(png|jpg|jpeg|webp)$/i.test(arquivo)
  );
}

export function pathLogoReciboPersonalizada(
  empresaId: string,
  path: string | null | undefined
) {
  const arquivo = String(path ?? "").trim();
  return logoReciboPersonalizadaPertenceAEmpresa(empresaId, arquivo)
    ? arquivo
    : null;
}

export function urlPublicaLogoReciboPersonalizada(
  path: string | null | undefined
) {
  const arquivo = String(path ?? "").trim();
  if (!arquivo || arquivo.startsWith("http://") || arquivo.startsWith("https://")) {
    return null;
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    return null;
  }
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET_RECIBOS_LOGOS}/${arquivo}`;
}

export function urlLogoReciboPersonalizada(
  empresaId: string,
  path: string | null | undefined
) {
  return logoUrlUtilizavel(
    urlPublicaLogoReciboPersonalizada(
      pathLogoReciboPersonalizada(empresaId, path)
    )
  );
}

export function validarUploadLogoRecibo(params: {
  empresaId: string;
  nomeArquivo?: string | null;
  mimeInformado?: string | null;
  tamanho: number;
  bytes: Buffer;
  versao?: string;
}) {
  if (!params.empresaId) {
    throw new Error("Empresa não identificada para a logo do recibo.");
  }
  if (params.tamanho <= 0) {
    throw new Error("Selecione uma imagem PNG, JPEG ou WEBP.");
  }
  if (params.tamanho > TAMANHO_MAXIMO_LOGO_RECIBO_BYTES) {
    throw new Error("A logo do recibo deve ter no máximo 2 MB.");
  }
  const tipo = detectarTipoLogoRecibo(params.bytes);
  if (!tipo) {
    throw new Error("Envie somente PNG, JPEG ou WEBP válidos.");
  }
  const mime = String(params.mimeInformado ?? "").toLowerCase();
  if (
    mime &&
    mime !== tipo &&
    !(tipo === "image/jpeg" && (mime === "image/jpg" || mime === "image/jpeg"))
  ) {
    throw new Error("O arquivo não corresponde a um PNG, JPEG ou WEBP válido.");
  }
  return {
    tipo,
    path: caminhoLogoReciboPersonalizada(
      params.empresaId,
      tipo,
      params.versao
    ),
  };
}

export function fonteLogoRecibo(valor: unknown): FonteLogoRecibo {
  return valor === "personalizada" ? "personalizada" : "empresa";
}

export function tamanhoLogoRecibo(valor: unknown): TamanhoLogoRecibo {
  return valor === "pequena" || valor === "grande" ? valor : "media";
}

export function alinhamentoLogoRecibo(valor: unknown): AlinhamentoLogoRecibo {
  if (valor === "esquerda" || valor === "direita") {
    return valor;
  }
  return "centro";
}
