import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { carregarConfiguracaoCaixaEmpresa } from "@/lib/caixa/carregar";
import { buscarCaixaAbertoEmpresa } from "@/lib/caixa/sessao-aberta";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { createClient } from "@/lib/supabase/server";

import { CaixaControleForm } from "./caixa-controle-form";

export const metadata = {
  title: "Caixa",
};

export default async function ConfiguracoesCaixaPage() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresaId = String(vinculo.empresa_id);
  await exigirEmpresaOperacionalOuRedirecionar(empresaId);

  const [configuracao, caixaAberto, sessao] = await Promise.all([
    carregarConfiguracaoCaixaEmpresa(supabase, empresaId),
    buscarCaixaAbertoEmpresa(supabase, empresaId),
    obterPermissoesSessao(),
  ]);

  const podeEditar = temPermissao(
    sessao?.permissoes,
    "configuracoes",
    "editar_empresa"
  );

  return (
    <PageShell
      title="Caixa"
      description="Defina se a empresa exige sessão de Caixa nas vendas e recebimentos."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Caixa" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config space-y-4">
        <CaixaControleForm
          controleAtivo={configuracao.controleAtivo}
          caixaAberto={caixaAberto !== null}
          podeEditar={podeEditar}
          abrirGavetaAposVendaDinheiro={configuracao.abrirGavetaAposVendaDinheiro}
        />
      </div>
    </PageShell>
  );
}
