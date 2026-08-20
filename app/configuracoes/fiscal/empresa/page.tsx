import { redirect } from "next/navigation";

import { IdentidadeVisualForm } from "@/app/configuracoes/empresa/identidade-visual-form";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { pathLogoDaEmpresa, urlPublicaLogoEmpresa } from "@/lib/empresa/logo";
import { exigirPermissaoOuRedirecionar } from "@/lib/permissoes/exigir-permissao";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Empresa",
};

export default async function FiscalEmpresaIdentidadePage() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, claimsData.claims.sub, "empresa_id");

  if (!vinculo) {
    redirect("/onboarding");
  }

  await exigirPermissaoOuRedirecionar({
    modulo: "fiscal",
    acao: "configurar_fiscal",
  });

  const { data: empresa } = await supabase
    .from("empresas")
    .select("nome_fantasia, razao_social, logo_path")
    .eq("id", vinculo.empresa_id)
    .maybeSingle();

  return (
    <div className="updv-config">
      <IdentidadeVisualForm
        logoUrl={urlPublicaLogoEmpresa(
          pathLogoDaEmpresa(String(vinculo.empresa_id), empresa?.logo_path)
        )}
        empresaNome={empresa?.nome_fantasia || empresa?.razao_social || null}
      />
    </div>
  );
}
