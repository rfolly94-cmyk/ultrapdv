import type { SupabaseClient } from "@supabase/supabase-js";

import type { Competencia } from "@/lib/contabilidade/competencia";
import { carregarDocumentosCompetencia } from "@/lib/contabilidade/documentos";
import { carregarProdutosEscrituracao } from "@/lib/contabilidade/inventario";

/**
 * Fachada para a Etapa 2 (fechamento / SPED).
 * Não gera arquivo TXT. Apenas organiza a leitura por competência.
 */
export async function carregarBaseEscrituracao(
  supabase: SupabaseClient,
  empresaId: string,
  competencia: Competencia,
  fuso?: string
) {
  const [{ data: empresa }, { data: fiscal }, documentos, produtos] =
    await Promise.all([
      supabase
        .from("empresas")
        .select("id, nome_fantasia, razao_social, cnpj")
        .eq("id", empresaId)
        .maybeSingle(),
      supabase
        .from("empresas_fiscal")
        .select(
          "uf, inscricao_estadual, codigo_regime_tributario, fuso_horario"
        )
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      carregarDocumentosCompetencia(supabase, empresaId, competencia, {}, fuso),
      carregarProdutosEscrituracao(supabase, empresaId),
    ]);

  const clienteDocs = [
    ...new Set(
      documentos.todos
        .map((item) => item.documento)
        .filter((item): item is string => Boolean(item))
    ),
  ];

  return {
    empresa: {
      id: empresaId,
      nome: empresa?.nome_fantasia ?? empresa?.razao_social ?? "",
      cnpj: empresa?.cnpj ?? null,
      uf: fiscal?.uf ?? null,
      ie: fiscal?.inscricao_estadual ?? null,
      crt: fiscal?.codigo_regime_tributario ?? null,
      fuso: fiscal?.fuso_horario ?? fuso ?? "America/Sao_Paulo",
    },
    competencia,
    documentos: documentos.todos,
    produtos: produtos.produtos,
    estoques: produtos.estoques,
    participantes: clienteDocs,
    tributos: null,
  };
}
