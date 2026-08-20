import { createClient } from "@/lib/supabase/server";
import { pagamentoFinanceiramenteValido } from "@/lib/vendas/pagamentos-financeiros";
import {
  chaveDiaSaoPaulo,
  resolverPeriodo,
  rotuloDiaSaoPaulo,
  type PeriodoDashboard,
} from "@/lib/dashboard/periodo";

export type DashboardAlerta = {
  tipo: "fiscal" | "estoque" | "carteira";
  titulo: string;
  detalhe: string;
  href: string;
};

export type DashboardListaItem = {
  id: string;
  titulo: string;
  detalhe: string;
  extra: string;
  href: string;
  status?: string;
};

export type DashboardDados = {
  empresaNome: string;
  periodoRotulo: string;
  kpis: {
    vendas: number;
    faturamento: number;
    ticketMedio: number;
    recebido: number;
    clientesAtendidos: number;
  };
  fiscal: {
    autorizadas: number;
    aguardandoReconciliacao: number;
    aguardandoInutilizacao: number;
    comErro: number;
    canceladas: number;
  };
  carteira: {
    saldoAberto: number;
    clientesDevedores: number;
    recebimentos: number;
    vendasFiado: number;
    valorVencido: number;
  };
  estoque: {
    baixo: number;
    zerados: number;
    quantidadeTotal: number;
    valorCusto: number;
    ultimaMovimentacao: string | null;
  };
  alertas: DashboardAlerta[];
  ultimasVendas: DashboardListaItem[];
  ultimasEmissoes: DashboardListaItem[];
  ultimasMovimentacoes: DashboardListaItem[];
  graficoVendas: Array<{ chave: string; rotulo: string; valor: number }>;
  graficoPagamentos: Array<{ nome: string; valor: number }>;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dataVenda(venda: {
  finalizada_at: string | null;
  created_at: string;
}) {
  return venda.finalizada_at ?? venda.created_at;
}

function noIntervalo(
  valor: string | null | undefined,
  inicio: Date,
  fim: Date
) {
  if (!valor) {
    return false;
  }

  const data = new Date(valor);
  return data >= inicio && data < fim;
}

export async function carregarDashboard(
  periodo: PeriodoDashboard
): Promise<DashboardDados | { redirect: "/login" | "/onboarding" }> {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    return { redirect: "/login" };
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select(
      `
      empresa_id,
      empresas (
        nome_fantasia,
        razao_social
      )
    `
    )
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    return { redirect: "/onboarding" };
  }

  const empresaId = vinculo.empresa_id;
  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;
  const janela = resolverPeriodo(periodo);
  const inicioConsulta = janela.inicioGrafico.toISOString();

  const [
    vendasRes,
    fiscalRes,
    estoqueRes,
    produtosRes,
    movsRes,
    titulosRes,
    recebimentosRes,
    formasRes,
    clientesDevedoresRes,
  ] = await Promise.all([
    supabase
      .from("vendas")
      .select(
        "id, numero, cliente_id, status, valor_total, finalizada_at, created_at"
      )
      .eq("empresa_id", empresaId)
      .or(
        `created_at.gte.${inicioConsulta},finalizada_at.gte.${inicioConsulta}`
      )
      .order("created_at", { ascending: false })
      .limit(800),
    supabase
      .from("fiscal_emissoes")
      .select(
        "id, origem_id, modelo, serie, numero, status, created_at, autorizada_at"
      )
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("estoque_atual")
      .select("produto_id, quantidade, estoque_minimo")
      .eq("empresa_id", empresaId),
    supabase
      .from("produtos")
      .select("id, nome, ativo, preco_custo")
      .eq("empresa_id", empresaId),
    supabase
      .from("estoque_movimentacoes")
      .select("id, produto_id, tipo, quantidade, created_at")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("carteira_cliente_titulos")
      .select("id, cliente_id, valor_aberto, vencimento, status")
      .eq("empresa_id", empresaId)
      .in("status", ["ABERTO", "PARCIAL"]),
    supabase
      .from("carteira_cliente_recebimentos")
      .select("id, valor, created_at")
      .eq("empresa_id", empresaId)
      .gte("created_at", janela.inicio.toISOString())
      .lt("created_at", janela.fim.toISOString()),
    supabase
      .from("formas_pagamento")
      .select("codigo, nome, permite_fiado")
      .eq("empresa_id", empresaId),
    supabase
      .from("clientes")
      .select("id, nome, saldo_devedor")
      .eq("empresa_id", empresaId)
      .gt("saldo_devedor", 0),
  ]);

  if (vendasRes.error) {
    throw new Error(vendasRes.error.message);
  }
  if (fiscalRes.error) {
    throw new Error(fiscalRes.error.message);
  }
  if (estoqueRes.error) {
    throw new Error(estoqueRes.error.message);
  }
  if (produtosRes.error) {
    throw new Error(produtosRes.error.message);
  }
  if (movsRes.error) {
    throw new Error(movsRes.error.message);
  }
  if (titulosRes.error) {
    throw new Error(titulosRes.error.message);
  }
  if (recebimentosRes.error) {
    throw new Error(recebimentosRes.error.message);
  }
  if (formasRes.error) {
    throw new Error(formasRes.error.message);
  }
  if (clientesDevedoresRes.error) {
    throw new Error(clientesDevedoresRes.error.message);
  }

  const vendas = vendasRes.data ?? [];
  const vendaIds = vendas.map((venda) => venda.id);

  const pagamentosRes =
    vendaIds.length > 0
      ? await supabase
          .from("vendas_pagamentos")
          .select(
            "venda_id, forma_pagamento_codigo, forma_pagamento_nome, valor, status"
          )
          .eq("empresa_id", empresaId)
          .in("venda_id", vendaIds)
      : { data: [], error: null };

  if (pagamentosRes.error) {
    throw new Error(pagamentosRes.error.message);
  }

  const clienteIdsVendas = Array.from(
    new Set(
      vendas
        .map((venda) => venda.cliente_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const clientesJaCarregados = new Set(
    (clientesDevedoresRes.data ?? []).map((cliente) => cliente.id)
  );
  const clientesFaltando = clienteIdsVendas.filter(
    (id) => !clientesJaCarregados.has(id)
  );

  const clientesNomesRes =
    clientesFaltando.length > 0
      ? await supabase
          .from("clientes")
          .select("id, nome")
          .eq("empresa_id", empresaId)
          .in("id", clientesFaltando)
      : { data: [], error: null };

  if (clientesNomesRes.error) {
    throw new Error(clientesNomesRes.error.message);
  }

  const nomesClientes = new Map<string, string>();
  for (const cliente of clientesDevedoresRes.data ?? []) {
    nomesClientes.set(cliente.id, cliente.nome);
  }
  for (const cliente of clientesNomesRes.data ?? []) {
    nomesClientes.set(cliente.id, cliente.nome);
  }

  const produtosPorId = new Map(
    (produtosRes.data ?? []).map((produto) => [produto.id, produto])
  );
  const fiadoPorCodigo = new Set(
    (formasRes.data ?? [])
      .filter((forma) => forma.permite_fiado)
      .map((forma) => String(forma.codigo ?? "").toUpperCase())
  );

  function ehFiado(codigo: string | null, nome: string | null) {
    if (fiadoPorCodigo.has(String(codigo ?? "").toUpperCase())) {
      return true;
    }

    return /fiado/i.test(`${codigo ?? ""} ${nome ?? ""}`);
  }

  const vendasPeriodo = vendas.filter(
    (venda) =>
      venda.status === "finalizada" &&
      noIntervalo(dataVenda(venda), janela.inicio, janela.fim)
  );
  const faturamento = vendasPeriodo.reduce(
    (total, venda) => total + numero(venda.valor_total),
    0
  );
  const idsVendasPeriodo = new Set(vendasPeriodo.map((venda) => venda.id));
  const pagamentos = pagamentosRes.data ?? [];

  const recebidoVendas = pagamentos
    .filter(
      (pagamento) =>
        idsVendasPeriodo.has(pagamento.venda_id) &&
        pagamentoFinanceiramenteValido(pagamento.status) &&
        !ehFiado(
          pagamento.forma_pagamento_codigo,
          pagamento.forma_pagamento_nome
        )
    )
    .reduce((total, pagamento) => total + numero(pagamento.valor), 0);

  const recebidoCarteira = (recebimentosRes.data ?? []).reduce(
    (total, item) => total + numero(item.valor),
    0
  );

  const vendasFiado = vendasPeriodo.filter((venda) =>
    pagamentos.some(
      (pagamento) =>
        pagamento.venda_id === venda.id &&
        pagamentoFinanceiramenteValido(pagamento.status) &&
        ehFiado(
          pagamento.forma_pagamento_codigo,
          pagamento.forma_pagamento_nome
        )
    )
  ).length;

  const pagamentosGrafico = new Map<string, number>();
  for (const pagamento of pagamentos) {
    if (
      !idsVendasPeriodo.has(pagamento.venda_id) ||
      !pagamentoFinanceiramenteValido(pagamento.status)
    ) {
      continue;
    }

    const nome =
      pagamento.forma_pagamento_nome ||
      pagamento.forma_pagamento_codigo ||
      "Outros";
    pagamentosGrafico.set(
      nome,
      (pagamentosGrafico.get(nome) ?? 0) + numero(pagamento.valor)
    );
  }

  const emissoes = fiscalRes.data ?? [];
  const autorizadas = emissoes.filter(
    (item) =>
      item.status === "autorizada" &&
      noIntervalo(
        item.autorizada_at ?? item.created_at,
        janela.inicio,
        janela.fim
      )
  ).length;
  const canceladas = emissoes.filter(
    (item) =>
      item.status === "cancelada" &&
      noIntervalo(item.created_at, janela.inicio, janela.fim)
  ).length;
  const aguardandoReconciliacao = emissoes.filter((item) =>
    ["aguardando_reconciliacao", "erro_comunicacao", "enviando"].includes(
      item.status
    )
  ).length;
  const aguardandoInutilizacao = emissoes.filter(
    (item) => item.status === "aguardando_inutilizacao"
  ).length;
  const comErro = emissoes.filter((item) =>
    ["rejeitada", "erro_comunicacao"].includes(item.status)
  ).length;

  const hojeChave = chaveDiaSaoPaulo(janela.inicioHoje);
  const titulosAbertos = titulosRes.data ?? [];
  const valorVencido = titulosAbertos
    .filter(
      (titulo) =>
        numero(titulo.valor_aberto) > 0 &&
        titulo.vencimento &&
        titulo.vencimento < hojeChave
    )
    .reduce((total, titulo) => total + numero(titulo.valor_aberto), 0);

  const saldoAberto = (clientesDevedoresRes.data ?? []).reduce(
    (total, cliente) => total + numero(cliente.saldo_devedor),
    0
  );

  let baixo = 0;
  let zerados = 0;
  let quantidadeTotal = 0;
  let valorCusto = 0;

  for (const item of estoqueRes.data ?? []) {
    const produto = produtosPorId.get(item.produto_id);
    if (!produto?.ativo) {
      continue;
    }

    const qtd = numero(item.quantidade);
    const minimo = numero(item.estoque_minimo);
    quantidadeTotal += qtd;
    valorCusto += qtd * numero(produto.preco_custo);

    if (qtd <= 0) {
      zerados += 1;
    }

    if (qtd <= minimo) {
      baixo += 1;
    }
  }

  const ultimaMov = movsRes.data?.[0] ?? null;
  const ultimaMovimentacao = ultimaMov
    ? `${produtosPorId.get(ultimaMov.produto_id)?.nome ?? "Produto"} · ${ultimaMov.tipo} · ${new Date(
        ultimaMov.created_at
      ).toLocaleString("pt-BR")}`
    : null;

  const alertas: DashboardAlerta[] = [];

  if (aguardandoReconciliacao > 0) {
    alertas.push({
      tipo: "fiscal",
      titulo: "Emissões aguardando reconciliação",
      detalhe: `${aguardandoReconciliacao} documento(s) pendente(s)`,
      href: "/fiscal",
    });
  }
  if (aguardandoInutilizacao > 0) {
    alertas.push({
      tipo: "fiscal",
      titulo: "Numerações aguardando inutilização",
      detalhe: `${aguardandoInutilizacao} documento(s)`,
      href: "/fiscal",
    });
  }
  if (comErro > 0) {
    alertas.push({
      tipo: "fiscal",
      titulo: "Emissões rejeitadas ou com erro",
      detalhe: `${comErro} documento(s)`,
      href: "/fiscal",
    });
  }
  if (zerados > 0) {
    alertas.push({
      tipo: "estoque",
      titulo: "Produtos sem estoque",
      detalhe: `${zerados} produto(s) zerado(s)`,
      href: "/estoque",
    });
  }
  if (baixo > 0) {
    alertas.push({
      tipo: "estoque",
      titulo: "Estoque baixo",
      detalhe: `${baixo} produto(s) com quantidade ≤ mínimo`,
      href: "/estoque",
    });
  }
  if ((clientesDevedoresRes.data ?? []).length > 0) {
    alertas.push({
      tipo: "carteira",
      titulo: "Clientes com saldo devedor",
      detalhe: `${clientesDevedoresRes.data?.length} cliente(s) · ${moeda.format(saldoAberto)}`,
      href: "/clientes",
    });
  }
  if (valorVencido > 0) {
    alertas.push({
      tipo: "carteira",
      titulo: "Títulos vencidos em aberto",
      detalhe: moeda.format(valorVencido),
      href: "/clientes",
    });
  }

  const dias: string[] = [];
  for (let i = janela.diasGrafico - 1; i >= 0; i -= 1) {
    const data = new Date(
      janela.inicioHoje.getTime() - i * 24 * 60 * 60 * 1000
    );
    dias.push(chaveDiaSaoPaulo(data));
  }

  const vendasPorDia = new Map(dias.map((dia) => [dia, 0]));
  const vendasGrafico = vendas.filter(
    (venda) =>
      venda.status === "finalizada" &&
      noIntervalo(dataVenda(venda), janela.inicioGrafico, janela.fim)
  );
  for (const venda of vendasGrafico) {
    const chave = chaveDiaSaoPaulo(dataVenda(venda));
    if (vendasPorDia.has(chave)) {
      vendasPorDia.set(
        chave,
        (vendasPorDia.get(chave) ?? 0) + numero(venda.valor_total)
      );
    }
  }

  return {
    empresaNome:
      empresa?.nome_fantasia || empresa?.razao_social || "Empresa",
    periodoRotulo: janela.rotulo,
    kpis: {
      vendas: vendasPeriodo.length,
      faturamento,
      ticketMedio:
        vendasPeriodo.length > 0 ? faturamento / vendasPeriodo.length : 0,
      recebido: recebidoVendas + recebidoCarteira,
      clientesAtendidos: new Set(
        vendasPeriodo
          .map((venda) => venda.cliente_id)
          .filter((id): id is string => Boolean(id))
      ).size,
    },
    fiscal: {
      autorizadas,
      aguardandoReconciliacao,
      aguardandoInutilizacao,
      comErro,
      canceladas,
    },
    carteira: {
      saldoAberto,
      clientesDevedores: clientesDevedoresRes.data?.length ?? 0,
      recebimentos: recebidoCarteira,
      vendasFiado,
      valorVencido,
    },
    estoque: {
      baixo,
      zerados,
      quantidadeTotal,
      valorCusto,
      ultimaMovimentacao,
    },
    alertas,
    ultimasVendas: vendas.slice(0, 8).map((venda) => ({
      id: venda.id,
      titulo: `#${venda.numero ?? "—"}`,
      detalhe: venda.cliente_id
        ? nomesClientes.get(venda.cliente_id) ?? "Cliente"
        : "Sem cliente",
      extra: moeda.format(numero(venda.valor_total)),
      href: `/vendas/${venda.id}`,
      status: venda.status,
    })),
    ultimasEmissoes: emissoes.slice(0, 8).map((emissao) => ({
      id: emissao.id,
      titulo: `${emissao.modelo === "55" ? "NF-e" : "NFC-e"} ${String(
        emissao.numero
      ).padStart(6, "0")}`,
      detalhe: `Série ${emissao.serie}`,
      extra: new Date(emissao.created_at).toLocaleDateString("pt-BR"),
      href: emissao.origem_id ? `/vendas/${emissao.origem_id}` : "/fiscal",
      status: emissao.status,
    })),
    ultimasMovimentacoes: (movsRes.data ?? []).map((movimento) => ({
      id: movimento.id,
      titulo: produtosPorId.get(movimento.produto_id)?.nome ?? "Produto",
      detalhe: movimento.tipo.replace(/_/g, " "),
      extra: `${numero(movimento.quantidade)} · ${new Date(
        movimento.created_at
      ).toLocaleString("pt-BR")}`,
      href: "/estoque",
    })),
    graficoVendas: dias.map((chave) => ({
      chave,
      rotulo: rotuloDiaSaoPaulo(chave),
      valor: vendasPorDia.get(chave) ?? 0,
    })),
    graficoPagamentos: Array.from(pagamentosGrafico.entries())
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6),
  };
}
