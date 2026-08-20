import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { paginarSemAlterarTotais, situacaoEstoque } from "./calculo";
import { obterContextoRelatorio } from "./contexto";
import {
  formatarDataHora,
  formatarMoeda,
  formatarQuantidade,
  numeroSeguro,
} from "./formatacao";
import { resolverPeriodoRelatorio, noIntervalo } from "./periodo";
import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";

const TIPOS_MOVIMENTO: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  AJUSTE_POSITIVO: "Ajuste positivo",
  AJUSTE_NEGATIVO: "Ajuste negativo",
  VENDA: "Venda",
  ESTORNO_EDICAO: "Estorno de edição",
  CANCELAMENTO_VENDA: "Cancelamento",
  DEVOLUCAO_FORNECEDOR: "Devolução fornecedor",
  BONIFICACAO_SAIDA: "Bonificação",
  TRANSFERENCIA_SAIDA: "Transferência saída",
  TRANSFERENCIA_ENTRADA: "Transferência entrada",
};

export async function carregarRelatorioEstoque(
  filtros: FiltrosRelatorio
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const ctx = await obterContextoRelatorio();

  const [{ data: produtos }, { data: estoque }, { data: categorias }, { data: marcas }] =
    await Promise.all([
      ctx.supabase
        .from("produtos")
        .select(
          "id, empresa_id, codigo, nome, categoria_id, marca_id, preco_custo, preco_venda, ativo"
        )
        .eq("empresa_id", ctx.empresaId)
        .order("nome"),
      ctx.supabase
        .from("estoque_atual")
        .select("empresa_id, produto_id, quantidade, estoque_minimo")
        .eq("empresa_id", ctx.empresaId),
      ctx.supabase
        .from("categorias")
        .select("id, nome, empresa_id")
        .eq("empresa_id", ctx.empresaId),
      ctx.supabase
        .from("marcas")
        .select("id, nome, empresa_id")
        .eq("empresa_id", ctx.empresaId),
  ]);

  const estoqueMap = new Map(
    filtrarRegistrosDaEmpresaAtiva(estoque ?? [], ctx.empresaId).map((item) => [
      item.produto_id,
      item,
    ])
  );
  const categoriasMap = new Map(
    filtrarRegistrosDaEmpresaAtiva(categorias ?? [], ctx.empresaId).map((item) => [
      item.id,
      item.nome,
    ])
  );
  const marcasMap = new Map(
    filtrarRegistrosDaEmpresaAtiva(marcas ?? [], ctx.empresaId).map((item) => [
      item.id,
      item.nome,
    ])
  );

  const busca = filtros.q.toLowerCase();
  let linhas = filtrarRegistrosDaEmpresaAtiva(produtos ?? [], ctx.empresaId)
    .filter((produto) => produto.ativo !== false)
    .map((produto) => {
      const posicao = estoqueMap.get(produto.id);
      const quantidade = numeroSeguro(posicao?.quantidade);
      const minimo = numeroSeguro(posicao?.estoque_minimo);
      return {
        id: produto.id,
        codigo: String(produto.codigo ?? ""),
        nome: String(produto.nome ?? ""),
        categoriaId: produto.categoria_id as string | null,
        marcaId: produto.marca_id as string | null,
        categoria: categoriasMap.get(produto.categoria_id) || "—",
        marca: marcasMap.get(produto.marca_id) || "—",
        quantidade,
        minimo,
        custo: numeroSeguro(produto.preco_custo),
        venda: numeroSeguro(produto.preco_venda),
        situacao: situacaoEstoque({ quantidade, estoqueMinimo: minimo }),
      };
    });

  if (busca) {
    linhas = linhas.filter((item) =>
      `${item.codigo} ${item.nome}`.toLowerCase().includes(busca)
    );
  }
  if (filtros.categoriaId) {
    linhas = linhas.filter((item) => item.categoriaId === filtros.categoriaId);
  }
  if (filtros.marcaId) {
    linhas = linhas.filter((item) => item.marcaId === filtros.marcaId);
  }
  if (filtros.situacao === "com") {
    linhas = linhas.filter((item) => item.quantidade > 0);
  } else if (filtros.situacao === "sem") {
    linhas = linhas.filter((item) => item.situacao === "sem");
  } else if (filtros.situacao === "negativo") {
    linhas = linhas.filter((item) => item.situacao === "negativo");
  } else if (filtros.situacao === "baixo") {
    linhas = linhas.filter((item) => item.situacao === "baixo");
  }

  const unidades = linhas.reduce((total, item) => total + item.quantidade, 0);
  const valorCusto = linhas.reduce(
    (total, item) => total + item.quantidade * item.custo,
    0
  );
  const potencial = linhas.reduce(
    (total, item) => total + item.quantidade * item.venda,
    0
  );

  if (filtros.subaba === "movimentacoes") {
    return carregarMovimentacoes(ctx, filtros, linhas);
  }

  const pagina = paginarSemAlterarTotais(linhas, filtros.pagina, filtros.porPagina);

  return {
    titulo: "Posição de estoque",
    vazio: "Nenhum produto encontrado para estes filtros.",
    indicadores: [
      { label: "Produtos cadastrados", valor: String(linhas.length) },
      { label: "Unidades em estoque", valor: formatarQuantidade(unidades) },
      {
        label: "Sem estoque",
        valor: String(linhas.filter((item) => item.situacao === "sem").length),
      },
      {
        label: "Estoque negativo",
        valor: String(linhas.filter((item) => item.situacao === "negativo").length),
      },
      {
        label: "Estoque baixo",
        valor: String(linhas.filter((item) => item.situacao === "baixo").length),
      },
      { label: "Valor do estoque a custo", valor: formatarMoeda(valorCusto) },
      {
        label: "Potencial de venda",
        valor: formatarMoeda(potencial),
        hint: "Valor potencial a preço atual",
      },
    ],
    colunas: ["Código", "Produto", "Categoria", "Marca", "Estoque", "Custo", "Venda"],
    linhas: pagina.registros.map((item) => ({
      id: item.id,
      href: `/produtos?editar=${item.id}`,
      celulas: [
        item.codigo || "—",
        item.nome,
        item.categoria,
        item.marca,
        formatarQuantidade(item.quantidade),
        formatarMoeda(item.custo),
        formatarMoeda(item.venda),
      ],
    })),
    totalFiltrado: pagina.total,
    extra: null,
    opcoes: {
      categorias: [...categoriasMap.entries()].map(([id, nome]) => ({ id, nome })),
      marcas: [...marcasMap.entries()].map(([id, nome]) => ({ id, nome })),
    },
  };
}

async function carregarMovimentacoes(
  ctx: Awaited<ReturnType<typeof obterContextoRelatorio>>,
  filtros: FiltrosRelatorio,
  produtos: Array<{ id: string; nome: string; codigo: string }>
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);
  const { data, error } = await ctx.supabase
    .from("estoque_movimentacoes")
    .select(
      "id, empresa_id, produto_id, tipo, origem, quantidade, saldo_posterior, venda_id, created_at"
    )
    .eq("empresa_id", ctx.empresaId)
    .gte("created_at", janela.inicio.toISOString())
    .lt("created_at", janela.fim.toISOString())
    .order("created_at", { ascending: false })
    .limit(4000);

  if (error) {
    throw new Error(error.message);
  }

  const nomes = new Map(produtos.map((item) => [item.id, `${item.codigo} ${item.nome}`.trim()]));
  let movimentos = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).filter((item) =>
    noIntervalo(item.created_at, janela.inicio, janela.fim)
  );

  if (filtros.q) {
    const busca = filtros.q.toLowerCase();
    movimentos = movimentos.filter((item) =>
      String(nomes.get(item.produto_id) ?? "").toLowerCase().includes(busca)
    );
  }
  if (filtros.status) {
    movimentos = movimentos.filter((item) => item.tipo === filtros.status);
  }

  const pagina = paginarSemAlterarTotais(movimentos, filtros.pagina, filtros.porPagina);

  return {
    titulo: "Movimentações de estoque",
    vazio: "Nenhuma movimentação encontrada para este período.",
    indicadores: [
      { label: "Movimentações", valor: String(movimentos.length) },
    ],
    colunas: ["Data", "Produto", "Tipo", "Quantidade", "Saldo", "Origem"],
    linhas: pagina.registros.map((item) => ({
      id: item.id,
      href: item.venda_id ? `/vendas/${item.venda_id}` : `/produtos?editar=${item.produto_id}`,
      celulas: [
        formatarDataHora(item.created_at),
        nomes.get(item.produto_id) || "Produto",
        TIPOS_MOVIMENTO[item.tipo] || item.tipo,
        formatarQuantidade(item.quantidade),
        formatarQuantidade(item.saldo_posterior),
        String(item.origem ?? "—"),
      ],
    })),
    totalFiltrado: pagina.total,
    extra: null,
    opcoes: {},
  };
}
