import { gerarPdfSimples } from "./pdf-simples";
import { registrarFalhaLogoRecibo } from "./bytes-logo-recibo";
import { logoResolvidaParaPdf } from "./incorporar-logo-pdf";
import { resolverLogoRecibo } from "./resolver-logo-recibo";
import type { ReciboLayoutConfig } from "./recibo-layout";
import type { PapelImpressao } from "./tipos";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

export async function gerarPdfReciboEmpresa(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  linhas: string[];
  papel: PapelImpressao;
  layout: ReciboLayoutConfig;
}): Promise<Uint8Array> {
  const resolvida = await resolverLogoRecibo({
    supabase: args.supabase,
    empresaId: args.empresaId,
    layout: args.layout,
    incorporar: true,
  });
  const logo = await logoResolvidaParaPdf(resolvida, {
    alinhamento: args.layout.cabecalho.logoAlinhamento,
    tamanho: args.layout.cabecalho.logoTamanho,
  });

  if (args.layout.cabecalho.logo && resolvida.path && !logo) {
    registrarFalhaLogoRecibo(
      "arquivo ausente, tipo invalido ou decode falhou"
    );
  }

  return gerarPdfSimples({
    papel: args.papel,
    linhas: args.linhas,
    logo,
  });
}
