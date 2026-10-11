import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { FinanceiroAtalho } from "@/components/configuracoes/financeiro-atalho";
import { PageShell } from "@/components/layout/page-shell";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

export const metadata = {
  title: "Financeiro",
};

export default async function ConfiguracoesFinanceiroPage() {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    redirect("/login");
  }

  const podePix = temPermissao(sessao.permissoes, "financeiro", "configurar_pix");
  const podeTef = temPermissao(sessao.permissoes, "financeiro", "editar");
  if (!podePix && !podeTef) {
    redirect("/acesso-negado");
  }

  return (
    <PageShell
      title="Financeiro"
      description="Recebimentos e meios de pagamento desta empresa."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Financeiro" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config">
        <div className="grid gap-3 sm:grid-cols-2">
          {podePix ? (
            <FinanceiroAtalho
              href="/configuracoes/financeiro/pix"
              titulo="PIX"
              descricao="Recebimento PIX da empresa."
              icone="pix"
            />
          ) : null}
          {podeTef ? (
            <FinanceiroAtalho
              href="/configuracoes/financeiro/tef"
              titulo="TEF — PayGoWeb"
              descricao="Instalação, pinpad e terminais"
              icone="tef"
            />
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
