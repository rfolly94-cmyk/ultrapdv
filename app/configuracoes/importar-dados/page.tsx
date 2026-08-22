import { redirect } from "next/navigation";

import { ImportacaoWorkspace } from "@/components/importacao/importacao-workspace";
import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { PageShell } from "@/components/layout/page-shell";
import { createClient } from "@/lib/supabase/server";
import type { HistoricoImportacao, TipoImportacao } from "@/lib/importacao/tipos";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

export const metadata = {
  title: "Importar dados",
};

type PageProps = {
  searchParams: Promise<{
    tipo?: string;
  }>;
};

export default async function ImportarDadosPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select(
      `
      empresa_id,
      empresas (
        nome_fantasia
      )
    `
    )
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresaId = String(vinculo.empresa_id);
  const plano = await planoPermiteRecursoEmpresa(empresaId, "importador");
  const entitlements = await carregarEntitlementsEmpresa(empresaId);

  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;

  if (!plano.permitido) {
    return (
      <PageShell
        title="Importar dados"
        description="Importe planilhas de produtos e clientes somente da empresa ativa."
        breadcrumb={[
          { label: "Configurações", href: "/configuracoes" },
          { label: "Importar dados" },
        ]}
        tabs={<ConfiguracoesModuleTabs />}
      >
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Importador de dados"
            descricao="Este recurso não está disponível no plano atual da sua empresa. Para utilizar importações por Excel e CSV, é necessário um plano que inclua o Importador."
            planoNome={entitlements.planoNome}
            voltarHref="/configuracoes"
            voltarLabel="Voltar para Configurações"
          />
        </div>
      </PageShell>
    );
  }

  const { data: historico } = await supabase
    .from("importacoes_dados")
    .select(
      "id, tipo, nome_arquivo, status, total_linhas, total_criados, total_atualizados, total_ignorados, total_erros, created_at, finalizado_em"
    )
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(20);

  const tipo =
    params.tipo === "clientes" || params.tipo === "produtos"
      ? (params.tipo as TipoImportacao)
      : null;

  return (
    <PageShell
      title="Importar dados"
      description="Importe planilhas de produtos e clientes somente da empresa ativa."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Importar dados" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <ImportacaoWorkspace
        tipoInicial={tipo}
        empresaNome={String(empresa?.nome_fantasia ?? "")}
        historico={(historico ?? []) as HistoricoImportacao[]}
      />
    </PageShell>
  );
}
