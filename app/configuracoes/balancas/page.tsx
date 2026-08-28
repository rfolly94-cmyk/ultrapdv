import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { tabelaBalancaIndisponivel } from "@/lib/balancas/schema";
import { createClient } from "@/lib/supabase/server";
import { normalizarConfiguracaoBalancaJson } from "@/lib/balancas/etiqueta";
import {
  FABRICANTES_BALANCA,
  TIPOS_INTEGRACAO_BALANCA,
  type ConfiguracaoBalanca,
  type FabricanteBalanca,
  type TipoIntegracaoBalanca,
} from "@/lib/balancas/tipos";

import { BalancasWorkspace } from "./balancas-workspace";

export const metadata = {
  title: "Balanças",
};

function fabricanteValido(valor: string): valor is FabricanteBalanca {
  return FABRICANTES_BALANCA.some((item) => item.value === valor);
}

function tipoIntegracaoValido(valor: string): valor is TipoIntegracaoBalanca {
  return TIPOS_INTEGRACAO_BALANCA.some((item) => item.value === valor);
}

export default async function ConfiguracoesBalancasPage() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

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

  const sessao = await obterPermissoesSessao();
  const podeEditar = temPermissao(
    sessao?.permissoes,
    "configuracoes",
    "editar_empresa"
  );

  const { data, error } = await supabase
    .from("balancas_configuracoes")
    .select(
      "id, empresa_id, nome, fabricante, modelo, layout, tipo_integracao, configuracao, ativo"
    )
    .eq("empresa_id", empresaId)
    .order("nome");

  if (error && !tabelaBalancaIndisponivel(error)) {
    throw new Error(error.message);
  }

  const configs: ConfiguracaoBalanca[] = (data ?? []).map((item) => {
    const fabricante = String(item.fabricante ?? "outro");
    const tipo = String(item.tipo_integracao ?? "arquivo");
    return {
      id: String(item.id),
      empresaId: String(item.empresa_id),
      nome: String(item.nome ?? ""),
      fabricante: fabricanteValido(fabricante) ? fabricante : "outro",
      modelo: item.modelo ? String(item.modelo) : null,
      layout: item.layout ? String(item.layout) : null,
      tipoIntegracao: tipoIntegracaoValido(tipo) ? tipo : "arquivo",
      configuracao: normalizarConfiguracaoBalancaJson(item.configuracao),
      ativo: item.ativo !== false,
    };
  });

  return (
    <PageShell
      title="Balanças"
      description="Cadastre as balanças da empresa, vincule produtos em KG e exporte a carga após validar."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Balanças" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config">
        <BalancasWorkspace configs={configs} podeEditar={podeEditar} />
      </div>
    </PageShell>
  );
}
