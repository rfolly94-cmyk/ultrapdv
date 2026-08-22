import { Suspense, type ReactNode } from "react";

import { ContabilidadeChrome, ContabilidadeModuleTabs } from "@/components/contabilidade/contabilidade-module-tabs";
import { ContabilidadeTopo } from "@/components/contabilidade/contabilidade-topo";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { PageHeader } from "@/components/ui/page-header";
import { obterContextoContabilidade, planoContabilidadePermitidoNaSessao } from "@/lib/contabilidade/contexto";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export const dynamic = "force-dynamic";

export default async function ContabilidadeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const plano = await planoContabilidadePermitidoNaSessao();
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(plano.empresaId);
    return (
      <div className="updv-page">
        <PageHeader
          title="Contabilidade"
          description="Área da contadora."
        />
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Contabilidade"
            descricao="Este recurso não está disponível no plano atual da sua empresa. A Área da Contadora está disponível em planos que incluem este recurso. A emissão fiscal do ERP continua funcionando normalmente."
            planoNome={entitlements.planoNome}
            voltarHref="/painel"
            voltarLabel="Voltar ao início"
          />
        </div>
      </div>
    );
  }

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
