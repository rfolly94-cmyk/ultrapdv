import { paginarSemAlterarTotais, vendaValidaParaFaturamento } from "./calculo";
import { formatarMoeda, formatarQuantidade, numeroSeguro } from "./formatacao";
import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";
import { carregarBaseVendas } from "./vendas";

export async function carregarRelatorioProdutos(
  filtros: FiltrosRelatorio
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const base = await carregarBaseVendas(filtros);
  const idsValidas = new Set(
    base.vendas
      .filter((venda) => vendaValidaParaFaturamento(venda.status))
      .map((venda) => venda.id)
  );

  const { data: produtos, error } = await base.ctx.supabase
    .from("produtos")
    .select("id, empresa_id, codigo, nome, categoria_id, marca_id")
    .eq("empresa_id", base.ctx.empresaId);

  if (error) {
    throw new Error(error.message);
  }

  const [{ data: categorias }, { data: marcas }] = await Promise.all([
    base.ctx.supabase
      .from("categorias")
      .select("id, nome, empresa_id")
      .eq("empresa_id", base.ctx.empresaId),
    base.ctx.supabase
      .from("marcas")
      .select("id, nome, empresa_id")
      .eq("empresa_id", base.ctx.empresaId),
  ]);

  const produtosMap = new Map(
    (produtos ?? [])
      .filter((item) => item.empresa_id === base.ctx.empresaId)
      .map((item) => [item.id, item])
  );

  const busca = filtros.q.toLowerCase();
  const agregados = new Map<
    string,
    { codigo: string; nome: string; quantidade: number; faturamento: number }
  >();

  for (const item of base.itens) {
    if (!idsValidas.has(item.venda_id) || !item.produto_id) {
      continue;
    }
    const produto = produtosMap.get(item.produto_id);
    if (!produto) {
      continue;
    }
    if (filtros.categoriaId && produto.categoria_id !== filtros.categoriaId) {
      continue;
    }
    if (filtros.marcaId && produto.marca_id !== filtros.marcaId) {
      continue;
    }
    if (
      busca &&
      !`${produto.codigo} ${produto.nome}`.toLowerCase().includes(busca)
    ) {
      continue;
    }

    const atual = agregados.get(produto.id) ?? {
      codigo: String(produto.codigo ?? ""),
      nome: String(produto.nome ?? item.produto_nome ?? "Produto"),
      quantidade: 0,
      faturamento: 0,
    };
    atual.quantidade += numeroSeguro(item.quantidade);
    atual.faturamento += numeroSeguro(item.valor_total);
    agregados.set(produto.id, atual);
  }

  const linhas = [...agregados.entries()].map(([id, item]) => ({
    id,
    href: `/produtos?editar=${id}`,
    ...item,
    precoMedio: item.quantidade > 0 ? item.faturamento / item.quantidade : 0,
  }));

  if (filtros.ordenacao === "faturamento") {
    linhas.sort((a, b) => b.faturamento - a.faturamento);
  } else {
    linhas.sort((a, b) => b.quantidade - a.quantidade);
  }

  const pagina = paginarSemAlterarTotais(linhas, filtros.pagina, filtros.porPagina);
  const unidades = linhas.reduce((total, item) => total + item.quantidade, 0);
  const faturamento = linhas.reduce((total, item) => total + item.faturamento, 0);

  return {
    titulo: filtros.ordenacao === "faturamento" ? "Maior faturamento" : "Mais vendidos",
    vazio: "Nenhum produto vendido neste período.",
    indicadores: [
      { label: "Unidades vendidas", valor: formatarQuantidade(unidades) },
      { label: "Produtos diferentes", valor: String(linhas.length) },
      { label: "Faturamento dos produtos", valor: formatarMoeda(faturamento) },
    ],
    colunas: ["Código", "Produto", "Qtd vendida", "Faturamento", "Preço médio"],
    linhas: pagina.registros.map((item) => ({
      id: item.id,
      href: item.href,
      celulas: [
        item.codigo || "—",
        item.nome,
        formatarQuantidade(item.quantidade),
        formatarMoeda(item.faturamento),
        formatarMoeda(item.precoMedio),
      ],
    })),
    totalFiltrado: pagina.total,
    extra: null,
    opcoes: {
      categorias: (categorias ?? [])
        .filter((item) => item.empresa_id === base.ctx.empresaId)
        .map((item) => ({ id: item.id, nome: item.nome })),
      marcas: (marcas ?? [])
        .filter((item) => item.empresa_id === base.ctx.empresaId)
        .map((item) => ({ id: item.id, nome: item.nome })),
    },
  };
}
