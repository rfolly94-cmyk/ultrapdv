import { notFound, redirect } from "next/navigation";

import { DevolverItensForm } from "@/components/fiscal/entrada/devolver-itens-form";
import { PageHeader } from "@/components/ui/page-header";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { saldoDevolvivelItem } from "@/lib/fiscal/entrada/devolucao-status";
import { escolherNaturezaParaDevolucaoFornecedor } from "@/lib/fiscal/operacoes/resolver-natureza";
import type { NaturezaOperacaoFiscal } from "@/lib/fiscal/operacoes/catalogo";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function DevolverItensPage({ params }: PageProps) {
  const { id } = await params;
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

  const { data: documento } = await supabase
    .from("fiscal_documentos_entrada")
    .select(
      "id, empresa_id, status, numero, serie, chave_acesso, razao_social_emitente, cnpj_emitente"
    )
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (!documento || !registroPertenceAEmpresaAtiva(documento, empresaId)) {
    notFound();
  }

  if (String(documento.status) !== "entrada_concluida") {
    redirect(
      `/fiscal/entradas/${documento.id}?erro=${encodeURIComponent(
        "Só é possível devolver itens de uma NF-e de entrada já processada."
      )}`
    );
  }

  const [{ data: itens }, { data: devolucoes }, { data: naturezas }] =
    await Promise.all([
      supabase
        .from("fiscal_documentos_entrada_itens")
        .select(
          "id, empresa_id, descricao_original, quantidade_entrada_efetivada, produto_id, valor_unitario"
        )
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", documento.id)
        .order("numero_item"),
      supabase
        .from("fiscal_devolucoes_fornecedor")
        .select("id, status, empresa_id")
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", documento.id),
      supabase
        .from("fiscal_naturezas_operacao")
        .select(
          "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
        )
        .eq("empresa_id", empresaId)
        .eq("tipo_operacao_interno", "devolucao_fornecedor")
        .eq("ativo", true)
        .order("descricao"),
    ]);

  const idsDev = (devolucoes ?? [])
    .filter((dev) => registroPertenceAEmpresaAtiva(dev, empresaId))
    .map((dev) => String(dev.id));

  const { data: reservas } =
    idsDev.length > 0
      ? await supabase
          .from("fiscal_devolucoes_fornecedor_itens")
          .select("documento_entrada_item_id, quantidade, devolucao_id")
          .eq("empresa_id", empresaId)
          .in("devolucao_id", idsDev)
      : { data: [] };

  const statusPorDev = new Map(
    (devolucoes ?? []).map((dev) => [String(dev.id), String(dev.status)])
  );

  const reservasPorItem = new Map<
    string,
    Array<{ quantidade: number; status: string }>
  >();
  for (const reserva of reservas ?? []) {
    const status = statusPorDev.get(String(reserva.devolucao_id));
    if (!status) continue;
    const lista =
      reservasPorItem.get(String(reserva.documento_entrada_item_id)) ?? [];
    lista.push({ quantidade: Number(reserva.quantidade), status });
    reservasPorItem.set(String(reserva.documento_entrada_item_id), lista);
  }

  const { data: produtos } = await supabase
    .from("produtos")
    .select("id, nome, codigo, empresa_id")
    .eq("empresa_id", empresaId)
    .in(
      "id",
      (itens ?? [])
        .map((item) => item.produto_id)
        .filter((produtoId): produtoId is string => Boolean(produtoId))
    );

  const produtoPorId = new Map(
    (produtos ?? []).map((produto) => [String(produto.id), produto])
  );

  const naturezaPadrao = escolherNaturezaParaDevolucaoFornecedor({
    empresaIdAtiva: empresaId,
    naturezas: (naturezas ?? []) as NaturezaOperacaoFiscal[],
  });

  return (
    <div className="updv-page">
      <PageHeader
        title="Devolução ao fornecedor"
        breadcrumb={[
          { label: "Fiscal", href: "/fiscal" },
          { label: "Notas de entrada", href: "/fiscal/entradas" },
          {
            label: `Nota ${documento.numero}`,
            href: `/fiscal/entradas/${documento.id}`,
          },
          { label: "Devolução" },
        ]}
      />
      <DevolverItensForm
        documentoId={String(documento.id)}
        numero={String(documento.numero)}
        chave={String(documento.chave_acesso)}
        fornecedor={String(documento.razao_social_emitente)}
        naturezaIdInicial={
          naturezaPadrao.ok ? naturezaPadrao.natureza.id : ""
        }
        naturezas={(naturezas ?? [])
          .filter((natureza) =>
            registroPertenceAEmpresaAtiva(natureza, empresaId)
          )
          .map((natureza) => ({
            id: String(natureza.id),
            descricao: String(natureza.descricao),
            tpNf: String(natureza.tp_nf),
            finNfe: String(natureza.fin_nfe),
          }))}
        itens={(itens ?? [])
          .filter((item) => registroPertenceAEmpresaAtiva(item, empresaId))
          .map((item) => {
            const reservasItem = reservasPorItem.get(String(item.id)) ?? [];
            const efetivada = Number(item.quantidade_entrada_efetivada ?? 0);
            const produto = item.produto_id
              ? produtoPorId.get(String(item.produto_id))
              : null;
            return {
              id: String(item.id),
              descricao: String(item.descricao_original),
              produto: produto?.nome ?? "Sem produto vinculado",
              recebido: efetivada,
              jaDevolvido: reservasItem
                .filter((reserva) =>
                  ["autorizada", "aguardando_saida", "concluida"].includes(
                    reserva.status
                  )
                )
                .reduce((soma, reserva) => soma + reserva.quantidade, 0),
              disponivel: saldoDevolvivelItem({
                quantidadeEntradaEfetivada: efetivada,
                reservas: reservasItem,
              }),
            };
          })}
      />
    </div>
  );
}
