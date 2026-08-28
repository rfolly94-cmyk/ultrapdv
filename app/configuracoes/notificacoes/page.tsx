import { redirect } from "next/navigation";

import { carregarConfiguracaoNotificacoesAction } from "@/app/notificacoes/actions";
import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { NotificacoesConfigForm } from "@/components/notificacoes/notificacoes-config-form";
import { CONFIGURACAO_NOTIFICACOES_PADRAO } from "@/lib/notificacoes/tipos";

export const metadata = {
  title: "Notificações",
};

export default async function ConfiguracoesNotificacoesPage() {
  const saida = await carregarConfiguracaoNotificacoesAction();
  if (!saida.ok) {
    redirect("/configuracoes");
  }

  return (
    <PageShell
      title="Notificações"
      description="Ligue ou desligue os avisos operacionais da empresa ativa. A central observa o estado real de estoque, validade, carteira, fiscal e caixa."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Notificações" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config">
        <NotificacoesConfigForm
          inicial={saida.config ?? CONFIGURACAO_NOTIFICACOES_PADRAO}
          podeEditar={saida.podeEditar}
          aviso={"aviso" in saida ? saida.aviso : null}
        />
      </div>
    </PageShell>
  );
}
