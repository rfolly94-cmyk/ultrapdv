import { Suspense, type ReactNode } from "react";

import { ContabilidadeChrome, ContabilidadeModuleTabs } from "@/components/contabilidade/contabilidade-module-tabs";
import { ContabilidadeTopo } from "@/components/contabilidade/contabilidade-topo";
import { obterContextoContabilidade } from "@/lib/contabilidade/contexto";

export const dynamic = "force-dynamic";

export default async function ContabilidadeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await obterContextoContabilidade();
  const { data: competencias } = await ctx.supabase
    .from("contabilidade_competencias")
    .select("ano, mes, status")
    .eq("empresa_id", ctx.empresaId)
    .order("ano", { ascending: false })
    .order("mes", { ascending: false })
    .limit(24);

  return (
    <div className="updv-page">
      <Suspense>
        <ContabilidadeChrome />
      </Suspense>
      <ContabilidadeTopo
        empresaId={ctx.empresaId}
        empresaNome={ctx.empresaNome}
        empresaCnpj={ctx.empresaCnpj}
        empresas={ctx.empresas}
        ehContador={ctx.ehContador}
        competencias={competencias ?? []}
      />
      <Suspense>
        <ContabilidadeModuleTabs />
      </Suspense>
      {children}
    </div>
  );
}
