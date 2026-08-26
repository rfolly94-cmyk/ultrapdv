import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { ImpressaoSubnav } from "@/components/impressao/impressao-subnav";
import { ReciboLayoutWorkspace } from "@/components/impressao/recibo-layout-workspace";
import { PageShell } from "@/components/layout/page-shell";
import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import {
  carregarIdentidadeReciboEmpresaAtiva,
  carregarLayoutReciboDaEmpresaAtiva,
} from "@/lib/impressao/recibo-layout-servidor";
import { exigirPermissaoOuRedirecionar } from "@/lib/permissoes/exigir-permissao";

export const metadata = {
  title: "Recibo de venda",
};

export default async function ConfiguracoesReciboVendaPage() {
  const sessao = await exigirPermissaoOuRedirecionar({
    modulo: "configuracoes",
    acao: "acessar",
  });
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId || identidade.empresaId !== sessao.empresaId) {
    redirect("/login");
  }

  const [layout, empresa] = await Promise.all([
    carregarLayoutReciboDaEmpresaAtiva({ empresaId: identidade.empresaId }),
    carregarIdentidadeReciboEmpresaAtiva(identidade.empresaId),
  ]);

  return (
    <PageShell
      title="Recibo de venda"
      description="Escolha o que aparece no recibo impresso. A configuração não altera a venda."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Impressão", href: "/configuracoes/impressao" },
        { label: "Recibo de venda" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
      toolbar={<ImpressaoSubnav />}
    >
      <div className="px-5 pb-8 pt-4">
        <ReciboLayoutWorkspace layoutInicial={layout} empresa={empresa} />
      </div>
    </PageShell>
  );
}
