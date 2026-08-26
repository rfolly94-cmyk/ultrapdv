import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { ImpressaoSubnav } from "@/components/impressao/impressao-subnav";
import { ImpressaoWorkspace } from "@/components/impressao/impressao-workspace";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { PageShell } from "@/components/layout/page-shell";
import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export const metadata = {
  title: "Impressão",
};

export default async function ConfiguracoesImpressaoPage() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(
    identidade.empresaId,
    "impressao_automatica"
  );
  const entitlements = await carregarEntitlementsEmpresa(identidade.empresaId);

  if (!plano.permitido) {
    return (
      <PageShell
        title="Impressão"
        description="Configure as impressoras utilizadas neste computador."
        breadcrumb={[
          { label: "Configurações", href: "/configuracoes" },
          { label: "Impressão" },
        ]}
        tabs={<ConfiguracoesModuleTabs />}
        toolbar={<ImpressaoSubnav />}
      >
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Impressão automática"
            descricao="Este recurso não está disponível no plano atual da sua empresa. O UltraPDV Conector e a impressão automática estão disponíveis em planos que incluem este recurso. Você ainda pode visualizar ou baixar recibos e DANFE."
            planoNome={entitlements.planoNome}
            voltarHref="/configuracoes"
            voltarLabel="Voltar para Configurações"
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Impressão"
      description="Configure as impressoras utilizadas neste computador."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Impressão" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
      toolbar={<ImpressaoSubnav />}
    >
      <div className="updv-config">
        <ImpressaoWorkspace />
      </div>
    </PageShell>
  );
}
