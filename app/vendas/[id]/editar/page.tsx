import { notFound, redirect } from "next/navigation";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { createClient } from "@/lib/supabase/server";
import {
  escolherStatusFiscalVenda,
  resolverOrigemVendaComercial,
  resolverRotaEdicaoVenda,
} from "@/lib/vendas/resolver-rota-edicao-venda";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarVendaPage({
  params,
}: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: claimsData,
    error: authError,
  } = await supabase.auth.getClaims();

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
  const { data: venda } = await supabase
    .from("vendas")
    .select("id, empresa_id")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (!venda || !registroPertenceAEmpresaAtiva(venda, empresaId)) {
    notFound();
  }

  const { data: operacao } = await supabase
    .from("fiscal_operacoes")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("venda_id", venda.id)
    .eq("tipo_operacao_interno", "venda")
    .limit(1)
    .maybeSingle();

  const { data: emissoes } = await supabase
    .from("fiscal_emissoes")
    .select("status")
    .eq("empresa_id", empresaId)
    .eq("origem_tipo", "venda")
    .eq("origem_id", venda.id);

  const rota = resolverRotaEdicaoVenda({
    vendaId: venda.id,
    origem: resolverOrigemVendaComercial(operacao?.id),
    operacaoFiscalId: operacao?.id,
    statusFiscal: escolherStatusFiscalVenda(emissoes ?? []),
  });

  redirect(rota.href);
}
