import { redirect } from "next/navigation";

import { NfeEmissaoForm } from "@/components/fiscal/nfe55/nfe-emissao-form";
import { PageHeader } from "@/components/ui/page-header";
import { carregarFormularioNfeEmissao } from "@/lib/fiscal/nfe55/carregar-formulario-nfe";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { createClient } from "@/lib/supabase/server";

export async function NfeEmissaoPagina({
  operacaoId,
}: {
  operacaoId?: string | null;
}) {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const plano = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "nfe"
  );
  if (!plano.permitido) {
    return null;
  }

  const formulario = await carregarFormularioNfeEmissao({
    supabase,
    empresaId: String(vinculo.empresa_id),
    usuarioId: String(claimsData.claims.sub),
    operacaoId: operacaoId ? String(operacaoId) : null,
  });

  const titulo = operacaoId ? "Editar NF-e" : "Nova NF-e";

  return (
    <div className="updv-page">
      <PageHeader
        title={titulo}
        description="Emissão de NF-e modelo 55."
        breadcrumb={[
          { label: "Fiscal", href: "/fiscal" },
          { label: titulo },
        ]}
      />
      <NfeEmissaoForm {...formulario} />
    </div>
  );
}
