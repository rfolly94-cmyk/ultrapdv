import type { SupabaseClient } from "@supabase/supabase-js";

import { custoInventario } from "@/lib/contabilidade/regras";

/**
 * Custo do snapshot, nesta ordem:
 * 1. estoque_atual.custo_medio — custo médio do estoque, quando > 0
 * 2. produtos.preco_custo — custo de cadastro, quando > 0
 * 3. indisponível — quantidade é gravada, valor fica nulo
 *
 * Não existe custo médio ponderado por competência nem custo de aquisição
 * por lote nesta V1. O snapshot NÃO movimenta estoque.
 */
export type ItemSnapshotInventario = {
  produto_id: string;
  codigo: string;
  descricao: string;
  ncm: string | null;
  unidade: string | null;
  quantidade: number;
  custo_unitario: number | null;
  valor_total: number | null;
  custo_disponivel: boolean;
};

export function montarItensInventario(
  produtos: Array<{
    id: string;
    codigo: string;
    nome: string;
    unidade_medida: string | null;
    preco_custo: number | string | null;
    produtos_fiscal?:
      | { ncm?: string | null }
      | Array<{ ncm?: string | null }>
      | null;
  }>,
  estoques: Array<{
    produto_id: string;
    quantidade: number | string | null;
    custo_medio?: number | string | null;
  }>
): ItemSnapshotInventario[] {
  const estoquePorProduto = new Map(
    estoques.map((item) => [item.produto_id, item])
  );

  return produtos.map((produto) => {
    const estoque = estoquePorProduto.get(produto.id);
    const fiscal = Array.isArray(produto.produtos_fiscal)
      ? produto.produtos_fiscal[0]
      : produto.produtos_fiscal;
    const quantidade = Number(estoque?.quantidade ?? 0);
    const custo = custoInventario(
      estoque?.custo_medio == null ? null : Number(estoque.custo_medio),
      produto.preco_custo == null ? null : Number(produto.preco_custo)
    );

    return {
      produto_id: produto.id,
      codigo: produto.codigo,
      descricao: produto.nome,
      ncm: fiscal?.ncm ?? null,
      unidade: produto.unidade_medida,
      quantidade,
      custo_unitario: custo.valor,
      valor_total:
        custo.disponivel && custo.valor != null
          ? Number((quantidade * custo.valor).toFixed(2))
          : null,
      custo_disponivel: custo.disponivel,
    };
  });
}

export async function carregarProdutosEscrituracao(
  supabase: SupabaseClient,
  empresaId: string
) {
  const [{ data: produtos, error }, { data: estoques, error: estoqueError }] =
    await Promise.all([
      supabase
        .from("produtos")
        .select(`
          id,
          codigo,
          nome,
          unidade_medida,
          grupo_fiscal_id,
          ativo,
          preco_custo,
          produtos_fiscal (
            ncm,
            cest,
            origem_produto
          )
        `)
        .eq("empresa_id", empresaId)
        .order("nome")
        .limit(3000),
      supabase
        .from("estoque_atual")
        .select("produto_id, quantidade, custo_medio")
        .eq("empresa_id", empresaId),
    ]);

  if (error) {
    throw new Error(error.message);
  }

  if (estoqueError) {
    const fallback = await supabase
      .from("estoque_atual")
      .select("produto_id, quantidade")
      .eq("empresa_id", empresaId);

    if (fallback.error) {
      throw new Error(fallback.error.message);
    }

    return { produtos: produtos ?? [], estoques: fallback.data ?? [] };
  }

  return { produtos: produtos ?? [], estoques: estoques ?? [] };
}

export async function gerarSnapshotInventario(
  supabase: SupabaseClient,
  input: {
    empresaId: string;
    usuarioId: string;
    dataSnapshot: string;
  }
) {
  const { data: existente } = await supabase
    .from("inventarios_fiscais")
    .select("id")
    .eq("empresa_id", input.empresaId)
    .eq("data_snapshot", input.dataSnapshot)
    .maybeSingle();

  if (existente) {
    throw new Error("Já existe um snapshot de inventário nesta data.");
  }

  const { produtos, estoques } = await carregarProdutosEscrituracao(
    supabase,
    input.empresaId
  );
  const itens = montarItensInventario(produtos, estoques);
  const quantidadeTotal = itens.reduce((soma, item) => soma + item.quantidade, 0);
  const valorTotal = itens.reduce(
    (soma, item) => soma + (item.valor_total ?? 0),
    0
  );

  const { data: inventario, error } = await supabase
    .from("inventarios_fiscais")
    .insert({
      empresa_id: input.empresaId,
      data_snapshot: input.dataSnapshot,
      gerado_por: input.usuarioId,
      itens_count: itens.length,
      quantidade_total: quantidadeTotal,
      valor_total: valorTotal,
    })
    .select("id, data_snapshot, gerado_em, itens_count, quantidade_total, valor_total")
    .single();

  if (error || !inventario) {
    throw new Error(error?.message ?? "Não foi possível gravar o inventário.");
  }

  if (itens.length > 0) {
    const { error: itensError } = await supabase
      .from("inventario_fiscal_itens")
      .insert(
        itens.map((item) => ({
          inventario_id: inventario.id,
          empresa_id: input.empresaId,
          produto_id: item.produto_id,
          codigo: item.codigo,
          descricao: item.descricao,
          ncm: item.ncm,
          unidade: item.unidade,
          quantidade: item.quantidade,
          custo_unitario: item.custo_unitario,
          valor_total: item.valor_total,
          custo_disponivel: item.custo_disponivel,
        }))
      );

    if (itensError) {
      throw new Error(itensError.message);
    }
  }

  return inventario;
}
