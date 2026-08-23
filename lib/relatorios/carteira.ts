import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { paginarSemAlterarTotais } from "./calculo";
import { obterContextoRelatorio } from "./contexto";
import { formatarData, formatarDataHora, formatarMoeda, numeroSeguro } from "./formatacao";
import { resolverPeriodoRelatorio, noIntervalo } from "./periodo";
import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";

function chaveHoje() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function carregarRelatorioCarteira(
  filtros: FiltrosRelatorio
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const ctx = await obterContextoRelatorio();
  const hoje = chaveHoje();

  const [{ data: clientes, error: erroClientes }, { data: titulos, error: erroTitulos }] =
    await Promise.all([
      ctx.supabase
        .from("clientes")
        .select(
          "id, empresa_id, nome, limite_credito, saldo_devedor, bloqueado"
        )
        .eq("empresa_id", ctx.empresaId)
        .order("nome"),
      ctx.supabase
        .from("carteira_cliente_titulos")
        .select("empresa_id, cliente_id, valor_aberto, vencimento, status")
        .eq("empresa_id", ctx.empresaId)
        .in("status", ["ABERTO", "PARCIAL"]),
    ]);

  if (erroClientes) {
    throw new Error(erroClientes.message);
  }
  if (erroTitulos) {
    throw new Error(erroTitulos.message);
  }

  const busca = filtros.q.toLowerCase();
  const titulosEmpresa = filtrarRegistrosDaEmpresaAtiva(titulos ?? [], ctx.empresaId);
  const vencimentoPorCliente = new Map<string, string | null>();
  for (const titulo of titulosEmpresa) {
    const atual = vencimentoPorCliente.get(titulo.cliente_id);
    if (!atual || (titulo.vencimento && titulo.vencimento < atual)) {
      vencimentoPorCliente.set(titulo.cliente_id, titulo.vencimento ?? null);
    }
  }

  let linhas = filtrarRegistrosDaEmpresaAtiva(clientes ?? [], ctx.empresaId)
    .filter((cliente) => numeroSeguro(cliente.saldo_devedor) > 0)
    .map((cliente) => {
      const limite = numeroSeguro(cliente.limite_credito);
      const saldo = numeroSeguro(cliente.saldo_devedor);
      const vencimento = vencimentoPorCliente.get(cliente.id) ?? null;
      let situacao = "Em aberto";
      if (cliente.bloqueado) {
        situacao = "Bloqueado";
      } else if (vencimento && vencimento < hoje) {
        situacao = "Vencido";
      }
      return {
        id: cliente.id,
        nome: String(cliente.nome ?? "Cliente"),
        limite,
        saldo,
        disponivel: Math.max(0, limite - saldo),
        vencimento,
        situacao,
      };
    });

  if (busca) {
    linhas = linhas.filter((item) => item.nome.toLowerCase().includes(busca));
  }

  const totalAberto = linhas.reduce((total, item) => total + item.saldo, 0);
  const vencido = linhas
    .filter((item) => item.situacao === "Vencido")
    .reduce((total, item) => total + item.saldo, 0);

  const pagina = paginarSemAlterarTotais(linhas, filtros.pagina, filtros.porPagina);
  const recebimentos = await carregarRecebimentos(ctx, filtros);
  const creditoDisponivel = linhas.reduce((total, item) => total + item.disponivel, 0);

  return {
    titulo: "Carteira / Fiado",
    vazio: "Nenhum cliente com saldo devedor.",
    indicadores: [
      { label: "Total em aberto", valor: formatarMoeda(totalAberto) },
      { label: "Total vencido", valor: formatarMoeda(vencido) },
      { label: "A vencer", valor: formatarMoeda(Math.max(0, totalAberto - vencido)) },
      { label: "Recebido no período", valor: formatarMoeda(recebimentos.total) },
      { label: "Crédito disponível", valor: formatarMoeda(creditoDisponivel) },
      { label: "Clientes com saldo", valor: String(linhas.length) },
    ],
    colunas: ["Cliente", "Limite", "Saldo devedor", "Crédito disponível", "Vencimento", "Situação"],
    linhas: pagina.registros.map((item) => ({
      id: item.id,
      href: `/clientes/${item.id}/carteira`,
      celulas: [
        item.nome,
        formatarMoeda(item.limite),
        formatarMoeda(item.saldo),
        formatarMoeda(item.disponivel),
        item.vencimento ? formatarData(item.vencimento) : "—",
        item.situacao,
      ],
    })),
    totalFiltrado: pagina.total,
    extra: {
      titulo: "Recebimentos",
      colunas: ["Data", "Cliente", "Valor", "Tipo/Origem"],
      linhas: recebimentos.linhas,
    },
    opcoes: {},
  };
}

async function carregarRecebimentos(
  ctx: Awaited<ReturnType<typeof obterContextoRelatorio>>,
  filtros: FiltrosRelatorio
) {
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);
  const { data, error } = await ctx.supabase
    .from("carteira_cliente_recebimentos")
    .select(
      "id, empresa_id, cliente_id, valor, modo, forma_pagamento_nome, created_at"
    )
    .eq("empresa_id", ctx.empresaId)
    .gte("created_at", janela.inicio.toISOString())
    .lt("created_at", janela.fim.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  const recebidos = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).filter((item) =>
    noIntervalo(item.created_at, janela.inicio, janela.fim)
  );
  const clienteIds = [...new Set(recebidos.map((item) => item.cliente_id))];
  const nomes = new Map<string, string>();
  if (clienteIds.length > 0) {
    const { data: clientes } = await ctx.supabase
      .from("clientes")
      .select("id, nome, empresa_id")
      .eq("empresa_id", ctx.empresaId)
      .in("id", clienteIds);
    for (const cliente of filtrarRegistrosDaEmpresaAtiva(clientes ?? [], ctx.empresaId)) {
      nomes.set(cliente.id, cliente.nome);
    }
  }

  return {
    total: recebidos.reduce((soma, item) => soma + numeroSeguro(item.valor), 0),
    linhas: recebidos.map((item) => ({
      id: item.id,
      href: `/clientes/${item.cliente_id}/carteira`,
      celulas: [
        formatarDataHora(item.created_at),
        nomes.get(item.cliente_id) || "Cliente",
        formatarMoeda(item.valor),
        `${item.modo} · ${item.forma_pagamento_nome || "Recebimento"}`,
      ],
    })),
  };
}
