import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { CaixaAbas } from "@/components/caixa/caixa-abas";
import { CaixaWorkspace } from "@/components/caixa/caixa-workspace";
import { PageShell } from "@/components/layout/page-shell";
import { carregarPainelCaixa } from "@/lib/caixa/carregar";
import type { AbaCaixa } from "@/lib/caixa/tipos";
import { exigirPermissaoOuRedirecionar } from "@/lib/permissoes/exigir-permissao";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Caixa",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CaixaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const abaParam = Array.isArray(params.aba) ? params.aba[0] : params.aba;
  const aba: AbaCaixa = abaParam === "anteriores" ? "anteriores" : "atual";

  const sessao = await exigirPermissaoOuRedirecionar({
    modulo: "caixa",
    acao: "acessar",
  });

  const plano = await planoPermiteRecursoEmpresa(sessao.empresaId, "caixa");
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(sessao.empresaId);
    return (
      <PageShell title="Caixa" description="Controle de abertura, sangria e fechamento.">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Caixa"
            descricao="Este recurso não está disponível no plano atual da sua empresa."
            planoNome={entitlements.planoNome}
            voltarHref="/painel"
            voltarLabel="Voltar ao início"
          />
        </div>
      </PageShell>
    );
  }

  const painel = await carregarPainelCaixa(sessao.empresaId);

  return (
    <PageShell
      title="Caixa"
      description="Controle de abertura, sangria e fechamento."
      tabs={<CaixaAbas aba={aba} />}
    >
      <CaixaWorkspace aba={aba} painel={painel} />
    </PageShell>
  );
}
