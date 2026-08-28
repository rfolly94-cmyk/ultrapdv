import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_FETCH_CONSULTA, type FonteCatalogoConsulta, type LinhaConsulta } from "./tipos";

function visaoIndisponivel(erro: { message?: string; code?: string } | null) {
  const texto = `${erro?.message ?? ""} ${erro?.code ?? ""}`.toLowerCase();
  return (
    texto.includes("does not exist") ||
    texto.includes("42p01") ||
    texto.includes("schema cache") ||
    texto.includes("could not find the table")
  );
}

function mapearLinha(fonte: FonteCatalogoConsulta, bruto: Record<string, unknown>): LinhaConsulta {
  const linha: LinhaConsulta = {
    empresa_id: bruto.empresa_id,
  };
  for (const campo of fonte.campos) {
    linha[campo.nome] =
      bruto[campo.nome] !== undefined ? bruto[campo.nome] : bruto[campo.coluna];
  }
  if (fonte.nome === "vendas") {
    linha.data = bruto.data ?? bruto.finalizada_at ?? bruto.created_at ?? linha.finalizada_at ?? linha.created_at;
  }
  return linha;
}

function colunasSelect(fonte: FonteCatalogoConsulta, usarVisao: boolean) {
  const colunas = new Set<string>(["empresa_id"]);
  for (const campo of fonte.campos) {
    colunas.add(usarVisao ? campo.nome : campo.coluna);
    if (fonte.nome === "vendas") {
      colunas.add("finalizada_at");
      colunas.add("created_at");
    }
  }
  return [...colunas].join(", ");
}

export function criarCarregadorConsulta(supabase: SupabaseClient) {
  return async function carregarFonte(params: {
    fonte: FonteCatalogoConsulta;
    empresaId: string;
    ids?: { coluna: string; valores: string[] };
  }): Promise<LinhaConsulta[]> {
    const executar = async (tabela: string, usarVisao: boolean) => {
      if (params.ids && params.ids.valores.length === 0) {
        return { data: [] as Record<string, unknown>[], error: null };
      }
      let query = supabase
        .from(tabela)
        .select(colunasSelect(params.fonte, usarVisao))
        .eq("empresa_id", params.empresaId)
        .limit(MAX_FETCH_CONSULTA);
      if (params.ids?.valores.length) {
        const coluna = usarVisao
          ? params.fonte.campos.find((item) => item.nome === params.ids?.coluna)?.nome ??
            params.ids.coluna
          : params.fonte.campos.find((item) => item.nome === params.ids?.coluna)?.coluna ??
            params.ids.coluna;
        query = query.in(coluna, params.ids.valores.slice(0, 500));
      }
      return await query;
    };

    const visao = await executar(params.fonte.visao, true);
    const usado =
      visao.error && visaoIndisponivel(visao.error)
        ? await executar(params.fonte.tabela, false)
        : visao;
    if (usado.error) {
      throw new Error(usado.error.message);
    }
    return ((usado.data ?? []) as Record<string, unknown>[]).map((row) =>
      mapearLinha(params.fonte, row)
    );
  };
}
