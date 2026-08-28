import {
  faturamentoVendas,
  quantidadeVendasValidas,
  somarPagamentosPorForma,
  ticketMedio,
  vendaValidaParaFaturamento,
  vendasNoPeriodo,
} from "@/lib/relatorios/calculo";
import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { buscarEmLotes } from "@/lib/relatorios/contexto";
import type { ItemVendaRelatorio, PagamentoRelatorio, VendaRelatorio } from "@/lib/relatorios/calculo";

type VendaAssistente = VendaRelatorio & {
  cliente_id?: string | null;
  numero?: string | number | null;
};

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { janelaPeriodoAssistente, periodoAssistenteValido, arredondarMoeda } from "../periodo";
import { hrefVendaAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type PeriodoAssistente,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

async function carregarVendasPeriodo(
  ctx: ContextoFerramentaIa,
  periodo: PeriodoAssistente,
  clienteId?: string
) {
  const janela = janelaPeriodoAssistente(periodo);
  const { data, error } = await ctx.supabase
    .from("vendas")
    .select(
      "id, empresa_id, numero, cliente_id, status, valor_total, desconto, finalizada_at, created_at"
    )
    .eq("empresa_id", ctx.empresaId)
    .order("created_at", { ascending: false })
    .limit(4000);
  if (error) {
    throw new Error(error.message);
  }
  const vendas = (
    vendasNoPeriodo(
      filtrarRegistrosDaEmpresaAtiva((data ?? []) as VendaAssistente[], ctx.empresaId),
      janela.inicio,
      janela.fim
    ) as VendaAssistente[]
  ).filter((venda) =>
    clienteId ? String(venda.cliente_id ?? "") === clienteId : true
  );
  const validas = vendas.filter((venda) =>
    vendaValidaParaFaturamento(venda.status)
  );
  const ids = validas.map((venda) => venda.id);
  const [pagamentos, itens] = await Promise.all([
    ids.length
      ? buscarEmLotes(ids, async (fatia) => {
          const { data: rows } = await ctx.supabase
            .from("vendas_pagamentos")
            .select(
              "empresa_id, venda_id, forma_pagamento_nome, forma_pagamento_codigo, valor, status"
            )
            .eq("empresa_id", ctx.empresaId)
            .in("venda_id", fatia);
          return filtrarRegistrosDaEmpresaAtiva(
            (rows ?? []) as PagamentoRelatorio[],
            ctx.empresaId
          );
        })
      : Promise.resolve([] as PagamentoRelatorio[]),
    ids.length
      ? buscarEmLotes(ids, async (fatia) => {
          const { data: rows } = await ctx.supabase
            .from("vendas_itens")
            .select(
              "empresa_id, venda_id, produto_id, produto_nome, quantidade, valor_total"
            )
            .eq("empresa_id", ctx.empresaId)
            .in("venda_id", fatia);
          return filtrarRegistrosDaEmpresaAtiva(
            (rows ?? []) as ItemVendaRelatorio[],
            ctx.empresaId
          );
        })
      : Promise.resolve([] as ItemVendaRelatorio[]),
  ]);
  const idsValidas = new Set(validas.map((venda) => venda.id));
  const faturamento = arredondarMoeda(faturamentoVendas(validas));
  const quantidade = quantidadeVendasValidas(validas);
  return {
    janela,
    vendas: validas as VendaAssistente[],
    pagamentos,
    itens,
    resumo: {
      periodo: janela.rotulo,
      total: faturamento,
      quantidadeVendas: quantidade,
      ticketMedio: arredondarMoeda(ticketMedio(faturamento, quantidade)),
      formas: somarPagamentosPorForma(pagamentos, idsValidas)
        .slice(0, 8)
        .map((item) => ({
          nome: item.nome,
          operacoes: item.operacoes,
          valor: arredondarMoeda(item.valor),
        })),
    },
  };
}

export async function consultarVendasIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "vendas",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_vendas", auth);
  }
  try {
    const periodoInformado = String(args.periodo ?? "").trim() !== "";
    const pedirRankingClientes = args.rankingClientes === true;
    const clienteIdArg = String(args.clienteId ?? "").trim();
    const vendaId = String(
      args.vendaId ??
        (!periodoInformado && !pedirRankingClientes && !clienteIdArg
          ? ctx.tela.vendaId
          : "") ??
        ""
    ).trim();
    if (vendaId) {
      const { data, error } = await ctx.supabase
        .from("vendas")
        .select(
          "id, empresa_id, numero, status, valor_total, desconto, cliente_id, finalizada_at, created_at"
        )
        .eq("empresa_id", ctx.empresaId)
        .eq("id", vendaId)
        .maybeSingle();
      if (error) {
        return {
          ok: false,
          ferramenta: "consultar_vendas",
          erro: MENSAGEM_IA_FALHA_CONSULTA,
          codigo: "falha",
        };
      }
      if (!data || String(data.empresa_id) !== ctx.empresaId) {
        return {
          ok: false,
          ferramenta: "consultar_vendas",
          erro: "Venda não encontrada nesta empresa.",
          codigo: "nao_encontrado",
        };
      }
      return {
        ok: true,
        ferramenta: "consultar_vendas",
        dados: {
          id: data.id,
          numero: data.numero,
          status: data.status,
          total: Number(data.valor_total ?? 0),
          desconto: Number(data.desconto ?? 0),
        },
        acoes: [{ label: "Ver venda", href: hrefVendaAssistente(String(data.id)) }],
      };
    }
    const periodo = periodoAssistenteValido(String(args.periodo ?? "hoje"));
    const clienteId = String(args.clienteId ?? "").trim();
    const carregado = await carregarVendasPeriodo(ctx, periodo, clienteId || undefined);
    const maior = [...carregado.vendas].sort(
      (a, b) => Number(b.valor_total ?? 0) - Number(a.valor_total ?? 0)
    )[0];
    let rankingClientes: Array<{
      clienteId: string;
      nome?: string;
      quantidade: number;
      total: number;
    }> | null = null;
    if (pedirRankingClientes) {
      const mapa = new Map<string, { quantidade: number; total: number }>();
      for (const venda of carregado.vendas) {
        const id = String(venda.cliente_id ?? "");
        if (!id) continue;
        const atual = mapa.get(id) ?? { quantidade: 0, total: 0 };
        atual.quantidade += 1;
        atual.total += Number(venda.valor_total ?? 0);
        mapa.set(id, atual);
      }
      const top = [...mapa.entries()]
        .map(([id, item]) => ({
          clienteId: id,
          quantidade: item.quantidade,
          total: arredondarMoeda(item.total),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8);
      if (top.length) {
        const { data: clientes } = await ctx.supabase
          .from("clientes")
          .select("id, empresa_id, nome")
          .eq("empresa_id", ctx.empresaId)
          .in(
            "id",
            top.map((item) => item.clienteId)
          );
        const nomes = new Map(
          filtrarRegistrosDaEmpresaAtiva(clientes ?? [], ctx.empresaId).map((item) => [
            String(item.id),
            String(item.nome),
          ])
        );
        rankingClientes = top.map((item) => ({
          ...item,
          nome: nomes.get(item.clienteId) ?? "Cliente",
        }));
      } else {
        rankingClientes = [];
      }
    }
    return {
      ok: true,
      ferramenta: "consultar_vendas",
      dados: {
        ...carregado.resumo,
        maiorVenda: maior
          ? {
              id: maior.id,
              numero: maior.numero,
              total: arredondarMoeda(Number(maior.valor_total ?? 0)),
            }
          : null,
        ultimaVenda: carregado.vendas[0]
          ? {
              id: carregado.vendas[0].id,
              numero: carregado.vendas[0].numero,
              total: arredondarMoeda(Number(carregado.vendas[0].valor_total ?? 0)),
            }
          : null,
        rankingClientes,
      },
      acoes: [{ label: "Ver vendas", href: "/vendas" }],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_vendas",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function resumirVendasPeriodoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "vendas",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("resumir_vendas_periodo", auth);
  }
  try {
    const periodo = periodoAssistenteValido(String(args.periodo ?? "mes"));
    const comparar = args.compararAnterior === true;
    const atual = await carregarVendasPeriodo(ctx, periodo);
    let anterior = null;
    if (comparar) {
      const outro =
        periodo === "hoje"
          ? "ontem"
          : periodo === "semana"
            ? "semana_anterior"
            : periodo === "mes"
              ? "mes_anterior"
              : periodo === "7d"
                ? "semana_anterior"
                : null;
      if (outro) {
        const prev = await carregarVendasPeriodo(ctx, outro);
        const evolucao =
          prev.resumo.total === 0
            ? null
            : arredondarMoeda(
                ((atual.resumo.total - prev.resumo.total) / prev.resumo.total) *
                  100
              );
        anterior = { ...prev.resumo, evolucaoPercentual: evolucao };
      }
    }
    return {
      ok: true,
      ferramenta: "resumir_vendas_periodo",
      dados: { atual: atual.resumo, comparativo: anterior },
      acoes: [{ label: "Ver vendas", href: "/vendas" }],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "resumir_vendas_periodo",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function rankingProdutosIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "vendas",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("ranking_produtos", auth);
  }
  try {
    const periodo = periodoAssistenteValido(String(args.periodo ?? "mes"));
    const carregado = await carregarVendasPeriodo(ctx, periodo);
    const idsValidas = new Set(carregado.vendas.map((venda) => venda.id));
    const mapa = new Map<
      string,
      { nome: string; quantidade: number; total: number }
    >();
    for (const item of carregado.itens) {
      if (!idsValidas.has(item.venda_id)) {
        continue;
      }
      const id = String(item.produto_id ?? item.produto_nome ?? "item");
      const atual = mapa.get(id) ?? {
        nome: String(item.produto_nome ?? "Produto"),
        quantidade: 0,
        total: 0,
      };
      atual.quantidade += Number(item.quantidade ?? 0);
      atual.total += Number(item.valor_total ?? 0);
      mapa.set(id, atual);
    }
    const ranking = [...mapa.entries()]
      .map(([produtoId, item]) => ({
        produtoId,
        nome: item.nome,
        quantidade: arredondarMoeda(item.quantidade),
        total: arredondarMoeda(item.total),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    return {
      ok: true,
      ferramenta: "ranking_produtos",
      dados: { periodo: carregado.janela.rotulo, ranking },
    };
  } catch {
    return {
      ok: false,
      ferramenta: "ranking_produtos",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
