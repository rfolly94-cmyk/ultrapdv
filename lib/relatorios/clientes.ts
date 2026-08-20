import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  clienteSemComprarHa,
  paginarSemAlterarTotais,
  ticketMedio,
  ultimaCompraPorCliente,
  vendaValidaParaFaturamento,
} from "./calculo";
import { formatarData, formatarMoeda, numeroSeguro } from "./formatacao";
import { dataVenda, resolverPeriodoRelatorio } from "./periodo";
import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";
import { carregarBaseVendas } from "./vendas";

export async function carregarRelatorioClientes(
  filtros: FiltrosRelatorio
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const base = await carregarBaseVendas(filtros);
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);

  const { data: clientes, error } = await base.ctx.supabase
    .from("clientes")
    .select(
      "id, empresa_id, nome, ativo, bloqueado, created_at"
    )
    .eq("empresa_id", base.ctx.empresaId)
    .order("nome");

  if (error) {
    throw new Error(error.message);
  }

  const cadastro = filtrarRegistrosDaEmpresaAtiva(clientes ?? [], base.ctx.empresaId);
  const busca = filtros.q.toLowerCase();
  const vendasValidas = base.vendas.filter((venda) =>
    vendaValidaParaFaturamento(venda.status)
  );

  const { data: vendasRecentes } = await base.ctx.supabase
    .from("vendas")
    .select("cliente_id, empresa_id, status, finalizada_at, created_at")
    .eq("empresa_id", base.ctx.empresaId)
    .eq("status", "finalizada")
    .not("cliente_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(8000);

  const ultimaReal = ultimaCompraPorCliente(
    filtrarRegistrosDaEmpresaAtiva(vendasRecentes ?? [], base.ctx.empresaId)
  );

  const porCliente = new Map<
    string,
    { compras: number; total: number; ultima: string | null }
  >();

  for (const venda of vendasValidas) {
    if (!venda.cliente_id) {
      continue;
    }
    const atual = porCliente.get(venda.cliente_id) ?? {
      compras: 0,
      total: 0,
      ultima: null,
    };
    atual.compras += 1;
    atual.total += numeroSeguro(venda.valor_total);
    const data = dataVenda(venda);
    if (!atual.ultima || data > atual.ultima) {
      atual.ultima = data;
    }
    porCliente.set(venda.cliente_id, atual);
  }

  let linhas = cadastro.map((cliente) => {
    const stats = porCliente.get(cliente.id) ?? {
      compras: 0,
      total: 0,
      ultima: null as string | null,
    };
    return {
      id: cliente.id,
      nome: String(cliente.nome ?? "Cliente"),
      ativo: cliente.ativo !== false,
      bloqueado: cliente.bloqueado === true,
      createdAt: cliente.created_at as string,
      ...stats,
      ultima: ultimaReal.get(cliente.id) ?? stats.ultima,
      ticket: ticketMedio(stats.total, stats.compras),
    };
  });

  if (busca) {
    linhas = linhas.filter((item) => item.nome.toLowerCase().includes(busca));
  }
  if (filtros.status === "ativo") {
    linhas = linhas.filter((item) => item.ativo && !item.bloqueado);
  }
  if (filtros.status === "bloqueado") {
    linhas = linhas.filter((item) => item.bloqueado);
  }

  const diasSemComprar = Number(filtros.semComprar || 0);
  if (diasSemComprar > 0) {
    linhas = linhas.filter((item) =>
      clienteSemComprarHa(item.ultima, diasSemComprar)
    );
  }

  if (filtros.ordenacao === "ultima") {
    linhas.sort((a, b) => String(b.ultima ?? "").localeCompare(String(a.ultima ?? "")));
  } else if (filtros.ordenacao === "compras") {
    linhas.sort((a, b) => b.compras - a.compras);
  } else {
    linhas.sort((a, b) => b.total - a.total);
  }

  const compraram = porCliente.size;
  const novos = cadastro.filter((cliente) => {
    const criado = new Date(String(cliente.created_at));
    return criado >= janela.inicio && criado < janela.fim;
  }).length;
  const ticketGeral = ticketMedio(
    [...porCliente.values()].reduce((total, item) => total + item.total, 0),
    compraram
  );

  const pagina = paginarSemAlterarTotais(linhas, filtros.pagina, filtros.porPagina);

  return {
    titulo: "Clientes",
    vazio: "Nenhum cliente encontrado para estes filtros.",
    indicadores: [
      { label: "Clientes cadastrados", valor: String(cadastro.length) },
      {
        label: "Clientes ativos",
        valor: String(cadastro.filter((item) => item.ativo !== false && item.bloqueado !== true).length),
      },
      { label: "Compraram no período", valor: String(compraram) },
      { label: "Novos clientes", valor: String(novos) },
      { label: "Ticket médio por cliente", valor: formatarMoeda(ticketGeral) },
    ],
    colunas: ["Cliente", "Compras", "Total comprado", "Ticket médio", "Última compra"],
    linhas: pagina.registros.map((item) => ({
      id: item.id,
      href: `/clientes?editar=${item.id}`,
      celulas: [
        item.nome,
        String(item.compras),
        formatarMoeda(item.total),
        formatarMoeda(item.ticket),
        item.ultima ? formatarData(item.ultima) : "Sem compra",
      ],
    })),
    totalFiltrado: pagina.total,
    extra: null,
    opcoes: {},
  };
}
