import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { ImpressaoWorkspace } from "@/components/impressao/impressao-workspace";
import { PageShell } from "@/components/layout/page-shell";

export const metadata = {
  title: "Impressão",
};

export default function ConfiguracoesImpressaoPage() {
  return (
    <PageShell
      title="Impressão"
      description="Configure as impressoras utilizadas neste computador."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Impressão" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config">
        <ImpressaoWorkspace />
      </div>
    </PageShell>
  );
}
