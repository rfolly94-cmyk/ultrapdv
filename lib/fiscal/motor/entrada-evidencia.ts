import type { SupabaseClient } from "@supabase/supabase-js";

import type { EvidenciaOrigemEntrada } from "./origem";
import { somenteDigitosFiscal } from "./tipos";

export async function evidenciasNfeEntradaProduto(params: {
  supabase: SupabaseClient;
  empresaId: string;
  produtoId: string;
}): Promise<EvidenciaOrigemEntrada | null> {
  const { data } = await params.supabase
    .from("fiscal_documentos_entrada_itens")
    .select(
      "empresa_id, produto_id, ncm, cest, cfop_original, descricao_original, dados_fiscais_original, updated_at"
    )
    .eq("empresa_id", params.empresaId)
    .eq("produto_id", params.produtoId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== params.empresaId) {
    return null;
  }
  const dados =
    data.dados_fiscais_original && typeof data.dados_fiscais_original === "object"
      ? (data.dados_fiscais_original as Record<string, unknown>)
      : {};
  const origem = somenteDigitosFiscal(dados.orig ?? dados.origem ?? "").slice(0, 1);
  const cst = String(dados.CST ?? dados.CSOSN ?? dados.cst ?? "").replace(/\D/g, "");
  return {
    origem: origem || null,
    ncm: data.ncm ? String(data.ncm) : null,
    cest: data.cest ? String(data.cest) : null,
    descricao: data.descricao_original ? String(data.descricao_original) : null,
    cfop: data.cfop_original ? String(data.cfop_original) : null,
    cst: cst || null,
  };
}
