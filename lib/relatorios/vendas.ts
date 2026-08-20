import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  faturamentoVendas,
  paginarSemAlterarTotais,
  quantidadeItensVendidos,
  quantidadeVendasValidas,
  somarPagamentosPorForma,
  ticketMedio,
  totalDescontos,
  vendaValidaParaFaturamento,
  vendasNoPeriodo,
} from "./calculo";
import { obterContextoRelatorio, buscarEmLotes } from "./contexto";
import {
  formatarDataHora,
  formatarMoeda,
  formatarQuantidade,
  numeroSeguro,
} from "./formatacao";
import {
  chaveDiaSaoPaulo,
  dataVenda,
  resolverPeriodoRelatorio,
  rotuloDiaSaoPaulo,
} from "./periodo";
import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";
import type { ItemVendaRelatorio, PagamentoRelatorio, VendaRelatorio } from "./calculo";

export type VendaLinha = VendaRelatorio & {
  numero?: number | string | null;
  cliente_id?: string | null;
  usuario_id?: string | null;
};

export async function carregarBaseVendas(filtros: FiltrosRelatorio) {
  const ctx = await obterContextoRelatorio();
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);
  const inicioIso = janela.inicio.toISOString();

  const { data, error } = await ctx.supabase
    .from("vendas")
    .select(
      "id, empresa_id, numero, cliente_id, usuario_id, status, valor_total, desconto, finalizada_at, created_at"
    )
    .eq("empresa_id", ctx.empresaId)
    .or(
      `finalizada_at.gte.${inicioIso},and(finalizada_at.is.null,created_at.gte.${inicioIso})`
    )
    .order("created_at", { ascending: false })
    .limit(8000);

  if (error) {
    throw new Error(error.message);
  }

  const vendas = vendasNoPeriodo(
    filtrarRegistrosDaEmpresaAtiva((data ?? []) as VendaLinha[], ctx.empresaId),
    janela.inicio,
    janela.fim
  );

  const ids = vendas.map((venda) => venda.id);

  const [pagamentos, itens, clientes, usuarios, formas] = await Promise.all([
    buscarPagamentos(ctx.supabase, ctx.empresaId, ids),
    buscarItens(ctx.supabase, ctx.empresaId, ids),
    buscarNomes(
      ctx.supabase,
      "clientes",
      ctx.empresaId,
      vendas.map((venda) => venda.cliente_id)
    ),
    buscarUsuarios(
      ctx.supabase,
      vendas.map((venda) => venda.usuario_id)
    ),
    ctx.supabase
      .from("formas_pagamento")
      .select("id, nome, codigo")
      .eq("empresa_id", ctx.empresaId)
      .eq("ativo", true)
      .order("ordem"),
  ]);

  return {
    ctx,
    janela,
    vendas,
    pagamentos,
    itens,
    clientes,
    usuarios,
    formas: formas.data ?? [],
  };
}

async function buscarPagamentos(
  supabase: Awaited<ReturnType<typeof obterContextoRelatorio>>["supabase"],
  empresaId: string,
  vendaIds: string[]
) {
  if (vendaIds.length === 0) {
    return [] as PagamentoRelatorio[];
  }

  return buscarEmLotes(vendaIds, async (fatia) => {
    const { data, error } = await supabase
      .from("vendas_pagamentos")
      .select(
        "empresa_id, venda_id, forma_pagamento_id, forma_pagamento_nome, forma_pagamento_codigo, valor, status"
      )
      .eq("empresa_id", empresaId)
      .in("venda_id", fatia);
    if (error) {
      throw new Error(error.message);
    }
    return filtrarRegistrosDaEmpresaAtiva(
      (data ?? []) as PagamentoRelatorio[],
      empresaId
    );
  });
}

async function buscarItens(
  supabase: Awaited<ReturnType<typeof obterContextoRelatorio>>["supabase"],
  empresaId: string,
  vendaIds: string[]
) {
  if (vendaIds.length === 0) {
    return [] as ItemVendaRelatorio[];
  }

  return buscarEmLotes(vendaIds, async (fatia) => {
    const { data, error } = await supabase
      .from("vendas_itens")
      .select(
        "empresa_id, venda_id, produto_id, produto_codigo, produto_nome, quantidade, valor_unitario, valor_total"
      )
      .eq("empresa_id", empresaId)
      .in("venda_id", fatia);
    if (error) {
      throw new Error(error.message);
    }
    return filtrarRegistrosDaEmpresaAtiva(
      (data ?? []) as ItemVendaRelatorio[],
      empresaId
    );
  });
}

async function buscarNomes(
  supabase: Awaited<ReturnType<typeof obterContextoRelatorio>>["supabase"],
  tabela: "clientes",
  empresaId: string,
  ids: Array<string | null | undefined>
) {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const mapa = new Map<string, string>();
  if (unicos.length === 0) {
    return mapa;
  }

  const linhas = await buscarEmLotes(unicos, async (fatia) => {
    const { data, error } = await supabase
      .from(tabela)
      .select("id, nome, empresa_id")
      .eq("empresa_id", empresaId)
      .in("id", fatia);
    if (error) {
      throw new Error(error.message);
    }
    return filtrarRegistrosDaEmpresaAtiva(data ?? [], empresaId);
  });

  for (const linha of linhas) {
    mapa.set(String(linha.id), String(linha.nome ?? ""));
  }
  return mapa;
}

async function buscarUsuarios(
  supabase: Awaited<ReturnType<typeof obterContextoRelatorio>>["supabase"],
  ids: Array<string | null | undefined>
) {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const mapa = new Map<string, string>();
  if (unicos.length === 0) {
    return mapa;
  }

  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome")
    .in("id", unicos);
  if (error) {
    throw new Error(error.message);
  }
  for (const linha of data ?? []) {
    mapa.set(String(linha.id), String(linha.nome ?? ""));
  }
  return mapa;
}

function rotuloPagamentos(
  vendaId: string,
  pagamentos: PagamentoRelatorio[]
) {
  const nomes = somarPagamentosPorForma(
    pagamentos.filter((item) => item.venda_id === vendaId),
    new Set([vendaId])
  ).map((item) => item.nome);
  return nomes.length ? nomes.join(" + ") : "—";
}

export async function carregarRelatorioVendas(
  filtros: FiltrosRelatorio
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const base = await carregarBaseVendas(filtros);
  let filtradas = base.vendas;
  if (filtros.status === "finalizada" || filtros.status === "cancelada") {
    filtradas = filtradas.filter((venda) => venda.status === filtros.status);
  }
  if (filtros.clienteId) {
    filtradas = filtradas.filter((venda) => venda.cliente_id === filtros.clienteId);
  }
  if (filtros.vendedorId) {
    filtradas = filtradas.filter((venda) => venda.usuario_id === filtros.vendedorId);
  }
  if (filtros.formaId) {
    const vendaIdsForma = new Set(
      base.pagamentos
        .filter((item) => String((item as { forma_pagamento_id?: string }).forma_pagamento_id ?? "") === filtros.formaId)
        .map((item) => item.venda_id)
    );
    filtradas = filtradas.filter((venda) => vendaIdsForma.has(venda.id));
  }

  const validasFiltradas = filtradas.filter((venda) =>
    vendaValidaParaFaturamento(venda.status)
  );
  const idsValidasFiltradas = new Set(validasFiltradas.map((venda) => venda.id));
  const faturamento = faturamentoVendas(filtradas);
  const qtd = quantidadeVendasValidas(filtradas);
  const itensQtd = quantidadeItensVendidos(base.itens, idsValidasFiltradas);
  const pagina = paginarSemAlterarTotais(
    filtradas,
    filtros.pagina,
    filtros.porPagina
  );

  const porDia = new Map<string, number>();
  for (const venda of validasFiltradas) {
    const chave = chaveDiaSaoPaulo(dataVenda(venda));
    porDia.set(chave, (porDia.get(chave) ?? 0) + numeroSeguro(venda.valor_total));
  }

  return {
    titulo: "Vendas no período",
    vazio: "Nenhuma venda encontrada para este período.",
    indicadores: [
      { label: "Faturamento", valor: formatarMoeda(faturamento), hint: "Somente vendas finalizadas" },
      { label: "Vendas", valor: String(qtd) },
      { label: "Ticket médio", valor: formatarMoeda(ticketMedio(faturamento, qtd)) },
      { label: "Descontos", valor: formatarMoeda(totalDescontos(filtradas)) },
      { label: "Itens vendidos", valor: formatarQuantidade(itensQtd) },
    ],
    colunas: ["Data", "Venda", "Cliente", "Vendedor", "Pagamento", "Itens", "Total", "Status"],
    linhas: pagina.registros.map((venda) => ({
      id: venda.id,
      href: `/vendas/${venda.id}`,
      celulas: [
        formatarDataHora(dataVenda(venda)),
        `#${venda.numero ?? "—"}`,
        venda.cliente_id
          ? base.clientes.get(venda.cliente_id) || "Cliente"
          : "Consumidor",
        venda.usuario_id ? base.usuarios.get(venda.usuario_id) || "—" : "—",
        rotuloPagamentos(venda.id, base.pagamentos),
        formatarQuantidade(
          quantidadeItensVendidos(base.itens, new Set([venda.id]))
        ),
        formatarMoeda(venda.valor_total),
        venda.status,
      ],
    })),
    totalFiltrado: pagina.total,
    grafico: [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([chave, valor]) => ({ rotulo: rotuloDiaSaoPaulo(chave), valor })),
    extra: null,
    opcoes: {
      clientes: [...base.clientes.entries()].map(([id, nome]) => ({ id, nome })),
      vendedores: [...base.usuarios.entries()].map(([id, nome]) => ({ id, nome })),
      formas: (base.formas as Array<{ id: string; nome: string }>).map((forma) => ({
        id: forma.id,
        nome: forma.nome,
      })),
    },
  };
}
