import {
  BUCKET_LOGOS_EMPRESAS,
  detectarTipoLogo,
  logoPertenceAEmpresa,
  pathLogoDaEmpresa,
} from "@/lib/empresa/logo";
import type { createClient } from "@/lib/supabase/server";
import {
  logoReciboVazia,
  urlLogoReciboEmpresa,
  type LogoReciboResolvida,
} from "./logo-recibo";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

async function baixarBytesLogoRecibo(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  path: string;
}): Promise<Pick<LogoReciboResolvida, "bytes" | "mime">> {
  if (!logoPertenceAEmpresa(args.empresaId, args.path)) {
    return { bytes: null, mime: null };
  }

  try {
    const arquivo = await args.supabase.storage
      .from(BUCKET_LOGOS_EMPRESAS)
      .download(args.path);

    if (arquivo.error || !arquivo.data) {
      return { bytes: null, mime: null };
    }

    const bytes = Buffer.from(await arquivo.data.arrayBuffer());
    const mime = detectarTipoLogo(bytes);
    if (!mime) {
      return { bytes: null, mime: null };
    }

    return { bytes, mime };
  } catch {
    return { bytes: null, mime: null };
  }
}

export async function resolverLogoReciboEmpresa(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  logoPath?: string | null;
  incorporar?: boolean;
}): Promise<LogoReciboResolvida> {
  const empresaId = String(args.empresaId ?? "").trim();
  if (!empresaId) {
    return logoReciboVazia();
  }

  let pathInformado = args.logoPath;
  if (pathInformado === undefined) {
    try {
      const { data } = await args.supabase
        .from("empresas")
        .select("id, logo_path")
        .eq("id", empresaId)
        .maybeSingle();
      if (!data || String(data.id) !== empresaId) {
        return logoReciboVazia();
      }
      pathInformado = data.logo_path;
    } catch {
      return logoReciboVazia();
    }
  }

  const path = pathLogoDaEmpresa(empresaId, pathInformado);
  const url = urlLogoReciboEmpresa(empresaId, path);
  if (!path) {
    return logoReciboVazia();
  }

  if (args.incorporar === false) {
    return { path, url, bytes: null, mime: null };
  }

  const arquivo = await baixarBytesLogoRecibo({
    supabase: args.supabase,
    empresaId,
    path,
  });

  return {
    path,
    url,
    bytes: arquivo.bytes,
    mime: arquivo.mime,
  };
}
