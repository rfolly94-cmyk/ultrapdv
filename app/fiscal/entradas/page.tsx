import Link from "next/link";
import { redirect } from "next/navigation";

import { FiscalModuleTabs } from "@/components/fiscal/fiscal-module-tabs";
import { EntradasLista } from "@/components/fiscal/entrada/entradas-lista";
import { PageAlert } from "@/components/ui/page-alert";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
  }>;
};

export default async function NotasEntradaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error || !claimsData?.claims?.sub) {
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

  const { data: documentos, error: documentosError } = await supabase
    .from("fiscal_documentos_entrada")
    .select(
      `
      id,
      empresa_id,
      numero,
      serie,
      chave_acesso,
      data_emissao,
      valor_total,
      status,
      razao_social_emitente,
      fornecedor_id,
      created_at
    `
    )
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (documentosError) {
    throw new Error(documentosError.message);
  }

  const fornecedorIds = [
    ...new Set(
      (documentos ?? [])
        .map((doc) => doc.fornecedor_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const fornecedores =
    fornecedorIds.length > 0
      ? (
          await supabase
            .from("fornecedores")
            .select("id, razao_social, empresa_id")
            .eq("empresa_id", empresaId)
            .in("id", fornecedorIds)
        ).data ?? []
      : [];

  const fornecedorPorId = new Map(
    fornecedores.map((fornecedor) => [fornecedor.id, fornecedor.razao_social])
  );

  const documentoIds = (documentos ?? []).map((doc) => String(doc.id));
  const movimentados =
    documentoIds.length > 0
      ? (
          await supabase
            .from("estoque_movimentacoes")
            .select("documento_entrada_id, empresa_id")
            .eq("empresa_id", empresaId)
            .in("documento_entrada_id", documentoIds)
        ).data ?? []
      : [];
  const idsComEstoque = new Set(
    movimentados
      .filter((mov) => String(mov.empresa_id) === empresaId)
      .map((mov) => String(mov.documento_entrada_id))
  );

  const itens = (documentos ?? [])
    .filter((doc) => String(doc.empresa_id) === empresaId)
    .map((doc) => ({
      id: String(doc.id),
      numero: String(doc.numero ?? ""),
      serie: String(doc.serie ?? ""),
      fornecedor:
        (doc.fornecedor_id
          ? fornecedorPorId.get(doc.fornecedor_id)
          : null) ||
        String(doc.razao_social_emitente ?? "Fornecedor"),
      emissao: doc.data_emissao ?? doc.created_at,
      valor: Number(doc.valor_total ?? 0),
      status: idsComEstoque.has(String(doc.id))
        ? "entrada_concluida"
        : String(doc.status),
    }));

  return (
    <div className="updv-page">
      <PageHeader
        title="Fiscal"
        description="Notas de entrada importadas pela empresa."
        count={itens.length}
        actions={
          <Link href="/fiscal/nfe/nova" className="updv-btn updv-btn-primary">
            Nova NF-e
          </Link>
        }
      />
      <FiscalModuleTabs />
      {params.erro ? <PageAlert type="erro">{params.erro}</PageAlert> : null}
      {params.sucesso ? (
        <PageAlert type="sucesso">{params.sucesso}</PageAlert>
      ) : null}
      <EntradasLista documentos={itens} />
    </div>
  );
}
