import { detectarTipoLogo } from "@/lib/empresa/logo";
import { detectarTipoLogoRecibo, type TipoLogoRecibo } from "./logo-recibo-personalizada";

const FETCH_MS = 8000;

export async function bytesDeArquivoStorage(data: unknown): Promise<Buffer | null> {
  try {
    if (!data) {
      return null;
    }
    if (Buffer.isBuffer(data)) {
      return Buffer.from(data);
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    const candidato = data as { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof candidato.arrayBuffer === "function") {
      return Buffer.from(await candidato.arrayBuffer());
    }
    return null;
  } catch {
    return null;
  }
}

export function urlLogoStoragePermitida(url: string) {
  const destino = String(url ?? "").trim();
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
    /\/$/,
    ""
  );
  if (!destino || !base) {
    return false;
  }
  try {
    const atual = new URL(destino);
    const esperado = new URL(base);
    return (
      atual.protocol === esperado.protocol &&
      atual.host === esperado.host &&
      /^\/storage\/v1\/object\/public\/(logos-empresas|recibos-logos)\//.test(
        atual.pathname
      )
    );
  } catch {
    return false;
  }
}

export async function buscarBytesLogoPublica(url: string | null | undefined) {
  const destino = String(url ?? "").trim();
  if (!urlLogoStoragePermitida(destino)) {
    return { bytes: null as Buffer | null, mime: null as TipoLogoRecibo | null };
  }
  try {
    const resposta = await fetch(destino, {
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { Accept: "image/png,image/jpeg,image/webp,*/*" },
    });
    if (!resposta.ok) {
      return { bytes: null, mime: null };
    }
    const bytes = Buffer.from(await resposta.arrayBuffer());
    const mime = detectarTipoLogoRecibo(bytes) ?? detectarTipoLogo(bytes);
    if (!mime) {
      return { bytes: null, mime: null };
    }
    return { bytes, mime };
  } catch {
    return { bytes: null, mime: null };
  }
}

export function registrarFalhaLogoRecibo(causa: string) {
  console.error(`Recibo: logo nao incorporada ao PDF (${causa}).`);
}
