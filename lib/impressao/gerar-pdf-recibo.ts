import { gerarPdfSimples } from "./pdf-simples";
import type { LogoPdfRecibo } from "./logo-recibo";
import { resolverLogoReciboEmpresa } from "./resolver-logo-recibo";
import type { AlinhamentoRecibo } from "./recibo-layout";
import type { PapelImpressao } from "./tipos";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

export async function gerarPdfReciboEmpresa(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  linhas: string[];
  papel: PapelImpressao;
  mostrarLogo: boolean;
  alinhamentoLogo?: AlinhamentoRecibo;
}): Promise<Uint8Array> {
  let logo: LogoPdfRecibo | null = null;

  if (args.mostrarLogo) {
    const resolvida = await resolverLogoReciboEmpresa({
      supabase: args.supabase,
      empresaId: args.empresaId,
      incorporar: true,
    });
    if (resolvida.bytes && resolvida.mime) {
      logo = {
        bytes: resolvida.bytes,
        mime: resolvida.mime,
        alinhamento: args.alinhamentoLogo,
      };
    }
  }

  return gerarPdfSimples({
    papel: args.papel,
    linhas: args.linhas,
    logo,
  });
}
