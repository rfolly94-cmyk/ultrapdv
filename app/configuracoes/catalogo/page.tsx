import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { PageShell } from "@/components/layout/page-shell";
import { createClient } from "@/lib/supabase/server";
import { normalizarSlug } from "@/lib/catalogo/regras";
import type { CatalogoConfigFormulario } from "@/lib/catalogo/tipos";

import { CatalogoConfigForm } from "./catalogo-config-form";

export const metadata = {
  title: "Catálogo Online",
};

export default async function CatalogoConfigPage() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select(`
      empresa_id,
      empresas (
        nome_fantasia
      )
    `)
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

  const { data: config } = await supabase
    .from("catalogo_config")
    .select("*")
    .eq("empresa_id", vinculo.empresa_id)
    .maybeSingle();

  const nomePadrao = empresa?.nome_fantasia ?? "Minha loja";
  const inicial: CatalogoConfigFormulario = {
    id: config?.id,
    ativo: Boolean(config?.ativo),
    nome_exibido: config?.nome_exibido ?? nomePadrao,
    slug: config?.slug ?? normalizarSlug(nomePadrao),
    descricao: config?.descricao ?? "",
    logo_path: config?.logo_path ?? null,
    banner_path: config?.banner_path ?? null,
    whatsapp_numero: config?.whatsapp_numero ?? "",
    whatsapp_mensagem: config?.whatsapp_mensagem ?? "",
    permitir_pedido: config?.permitir_pedido ?? true,
    permitir_whatsapp: config?.permitir_whatsapp ?? true,
    produto_sem_estoque:
      config?.produto_sem_estoque === "ocultar"
        ? "ocultar"
        : "mostrar_esgotado",
    permitir_retirada: config?.permitir_retirada ?? true,
    permitir_entrega: Boolean(config?.permitir_entrega),
    info_entrega: config?.info_entrega ?? "",
  };

  const cabecalhos = await headers();
  const host = cabecalhos.get("x-forwarded-host") ?? cabecalhos.get("host");
  const proto = cabecalhos.get("x-forwarded-proto") ?? "http";
  const origem = host ? `${proto}://${host}` : "";

  return (
    <PageShell
      title="Catálogo"
      description="Loja e pedidos online."
      breadcrumb={[
        { label: "Configurações", href: "/configuracoes" },
        { label: "Catálogo Online" },
      ]}
      tabs={<ConfiguracoesModuleTabs />}
    >
      <div className="updv-config">
        <CatalogoConfigForm inicial={inicial} origem={origem} />
      </div>
    </PageShell>
  );
}
