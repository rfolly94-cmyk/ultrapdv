import { createClient } from "@/lib/supabase/server";
import { buscarVinculoEmpresaAtiva } from "./empresa-ativa";
import {
  pathLogoDaEmpresa,
  urlPublicaLogoEmpresa,
  type IdentidadeEmpresaPublica,
} from "./logo";

export async function obterIdentidadeEmpresaSessao(): Promise<IdentidadeEmpresaPublica | null> {
  try {
    const supabase = await createClient();
    const { data: claimsData, error } = await supabase.auth.getClaims();

    if (error || !claimsData?.claims?.sub) {
      return null;
    }

    const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
      empresa_id: string;
      empresas:
        | { nome_fantasia?: string | null; razao_social?: string | null; logo_path?: string | null }
        | Array<{
            nome_fantasia?: string | null;
            razao_social?: string | null;
            logo_path?: string | null;
          }>
        | null;
    }>(
      supabase,
      claimsData.claims.sub,
      "empresa_id, empresas ( nome_fantasia, razao_social, logo_path )"
    );

    if (!vinculo) {
      return null;
    }

    const empresa = Array.isArray(vinculo.empresas)
      ? vinculo.empresas[0]
      : vinculo.empresas;
    const empresaId = String(vinculo.empresa_id);

    return {
      empresaId,
      nome:
        (empresa?.nome_fantasia as string | null) ||
        (empresa?.razao_social as string | null) ||
        null,
      logoUrl: urlPublicaLogoEmpresa(
        pathLogoDaEmpresa(empresaId, empresa?.logo_path)
      ),
    };
  } catch {
    return null;
  }
}
