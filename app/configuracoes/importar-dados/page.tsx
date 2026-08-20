import { redirect } from "next/navigation";

import { ImportacaoWorkspace } from "@/components/importacao/importacao-workspace";
import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { createClient } from "@/lib/supabase/server";
import type { HistoricoImportacao, TipoImportacao } from "@/lib/importacao/tipos";

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

  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;

  const { data: historico } = await supabase
    .from("importacoes_dados")
    .select(
      "id, tipo, nome_arquivo, status, total_linhas, total_criados, total_atualizados, total_ignorados, total_erros, created_at, finalizado_em"
    )
    .eq("empresa_id", vinculo.empresa_id)
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
