import {
  BUCKET_LOGOS_EMPRESAS,
  detectarTipoLogo,
  logoPertenceAEmpresa,
  pathLogoDaEmpresa,
} from "@/lib/empresa/logo";
import type { createClient } from "@/lib/supabase/server";
import {
  buscarBytesLogoPublica,
  bytesDeArquivoStorage,
  registrarFalhaLogoRecibo,
} from "./bytes-logo-recibo";
import {
  logoReciboVazia,
  urlLogoReciboEmpresa,
  type LogoReciboResolvida,
} from "./logo-recibo";
import {
  BUCKET_RECIBOS_LOGOS,
  detectarTipoLogoRecibo,
  pathLogoReciboPersonalizada,
  urlLogoReciboPersonalizada,
} from "./logo-recibo-personalizada";
import type { ReciboLayoutConfig } from "./recibo-layout";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

async function baixarBytes(args: {
  supabase: SupabaseServidor;
  bucket: string;
  path: string;
  url: string | null;
}): Promise<Pick<LogoReciboResolvida, "bytes" | "mime">> {
  try {
    const arquivo = await args.supabase.storage.from(args.bucket).download(args.path);
    if (!arquivo.error && arquivo.data) {
      const bytes = await bytesDeArquivoStorage(arquivo.data);
      const mime = bytes
        ? detectarTipoLogoRecibo(bytes) ?? detectarTipoLogo(bytes)
        : null;
      if (bytes && mime) {
        return { bytes, mime };
      }
    }
  } catch {
    // Continua na URL pública — a mesma que o preview já consegue carregar.
  }

  const publico = await buscarBytesLogoPublica(args.url);
  if (publico.bytes && publico.mime) {
    return publico;
  }

  return { bytes: null, mime: null };
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
    return { origem: "empresa", path, url, bytes: null, mime: null };
  }

  if (!logoPertenceAEmpresa(empresaId, path)) {
    return logoReciboVazia();
  }

  const arquivo = await baixarBytes({
    supabase: args.supabase,
    bucket: BUCKET_LOGOS_EMPRESAS,
    path,
    url,
  });
  if (!arquivo.bytes && args.incorporar !== false) {
    registrarFalhaLogoRecibo("arquivo oficial nao encontrado");
  }
  return {
    origem: "empresa",
    path,
    url,
    bytes: arquivo.bytes,
    mime: arquivo.mime,
  };
}

export async function resolverLogoRecibo(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  layout: ReciboLayoutConfig;
  logoPathEmpresa?: string | null;
  incorporar?: boolean;
}): Promise<LogoReciboResolvida> {
  if (!args.layout.cabecalho.logo) {
    return logoReciboVazia();
  }

  if (args.layout.cabecalho.logoFonte === "personalizada") {
    const path = pathLogoReciboPersonalizada(
      args.empresaId,
      args.layout.cabecalho.logoPersonalizadaPath
    );
    if (!path) {
      if (args.incorporar !== false) {
        registrarFalhaLogoRecibo("logo personalizada ausente ou de outra empresa");
      }
      return logoReciboVazia();
    }
    const url = urlLogoReciboPersonalizada(args.empresaId, path);
    if (args.incorporar === false) {
      return { origem: "personalizada", path, url, bytes: null, mime: null };
    }
    const arquivo = await baixarBytes({
      supabase: args.supabase,
      bucket: BUCKET_RECIBOS_LOGOS,
      path,
      url,
    });
    if (!arquivo.bytes && args.incorporar !== false) {
      registrarFalhaLogoRecibo("arquivo personalizado nao encontrado");
    }
    return {
      origem: "personalizada",
      path,
      url,
      bytes: arquivo.bytes,
      mime: arquivo.mime,
    };
  }

  return resolverLogoReciboEmpresa({
    supabase: args.supabase,
    empresaId: args.empresaId,
    logoPath: args.logoPathEmpresa,
    incorporar: args.incorporar,
  });
}

