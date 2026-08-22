import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { integracaoPublicaParaCliente } from "@/lib/pagamentos/pix/credenciais";
import type { CobrancaPixPublica } from "@/lib/pagamentos/pix/types";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { createClient } from "@/lib/supabase/server";

import { PixGeranetWorkspace } from "./pix-workspace";

export const metadata = {
  title: "PIX Geranet",
};

export default async function PixGeranetPage() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const [{ data: integracao }, { data: cobrancas }, planoPix] = await Promise.all([
    supabase
      .from("integracoes_pix")
      .select(
        "modo, provedor, ambiente, chave_pix, recebedor_nome, recebedor_cep, recebedor_cidade, recebedor_uf, credenciais_configuradas, certificado_configurado, configuracao_publica"
      )
      .eq("empresa_id", vinculo.empresa_id)
      .maybeSingle(),
    supabase
      .from("cobrancas_pix")
      .select(
        "id, empresa_id, txid, valor, status, provedor, ambiente, dados_publicos, geranet_http_status, geranet_situacao, geranet_mensagem, expira_em, pago_em, cancelado_em"
      )
      .eq("empresa_id", vinculo.empresa_id)
      .order("created_at", { ascending: false })
      .limit(20),
    planoPermiteRecursoEmpresa(String(vinculo.empresa_id), "pix_integrado"),
  ]);

  return (
    <PageShell
      title="PIX"
      description="Recebimento PIX da empresa."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Financeiro" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config">
        <PixGeranetWorkspace
          pixIntegradoLiberado={planoPix.permitido}
          integracao={
            integracao
              ? integracaoPublicaParaCliente({
                  ...integracao,
                  configuracao_publica:
                    integracao.configuracao_publica &&
                    typeof integracao.configuracao_publica === "object"
                      ? (integracao.configuracao_publica as Record<
                          string,
                          unknown
                        >)
                      : {},
                })
              : null
          }
          cobrancas={(cobrancas ?? []) as CobrancaPixPublica[]}
        />
      </div>
    </PageShell>
  );
}
