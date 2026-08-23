import { dataQuitacaoTitulo, tituloPassaNaAba } from "@/lib/carteira/titulos";
import { carregarResumoCarteiraListagem } from "@/lib/clientes/carregar-resumo-carteira";
import { createClient } from "@/lib/supabase/server";

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

function arredondar(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export async function carregarCarteiraApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  clienteId: string;
}) {
  const resumo = await carregarResumoCarteiraListagem(input);
  if (!resumo) {
    return null;
  }

  const { data: cliente, error: erroCliente } = await input.supabase
    .from("clientes")
    .select(
      "id, nome, nome_fantasia, limite_credito, saldo_devedor, bloqueado, dia_vencimento, ativo"
    )
    .eq("empresa_id", input.empresaId)
    .eq("id", input.clienteId)
    .maybeSingle();

  if (erroCliente) {
    throw new Error(erroCliente.message);
  }
  if (!cliente) {
    return null;
  }

  const [recebimentosResult, estornosResult, titulosResult, itensResult, movimentosResult, vendasResult] =
    await Promise.all([
    input.supabase
      .from("carteira_cliente_recebimentos")
      .select(
        "id, forma_pagamento_nome, modo, valor, saldo_anterior, saldo_posterior, observacao, processado_at, created_at"
      )
      .eq("empresa_id", input.empresaId)
      .eq("cliente_id", input.clienteId)
      .order("created_at", { ascending: false })
      .limit(100),
    input.supabase
      .from("carteira_cliente_recebimento_estornos")
      .select("id, recebimento_id, alocacao_id, valor, motivo, status, created_at")
      .eq("empresa_id", input.empresaId)
      .eq("cliente_id", input.clienteId)
      .order("created_at", { ascending: false }),
    input.supabase
      .from("carteira_cliente_titulos")
      .select(
        "id, venda_id, numero_venda, valor_original, valor_aberto, vencimento, status, created_at, updated_at"
      )
      .eq("empresa_id", input.empresaId)
      .eq("cliente_id", input.clienteId)
      .order("created_at", { ascending: false }),
    input.supabase
      .from("carteira_cliente_itens")
      .select(
        "id, titulo_id, produto_nome, valor_original, valor_aberto, status, created_at"
      )
      .eq("empresa_id", input.empresaId)
      .eq("cliente_id", input.clienteId)
      .order("created_at", { ascending: true }),
    input.supabase
      .from("carteira_cliente_movimentacoes")
      .select(
        "id, tipo, origem, valor, venda_id, titulo_id, recebimento_id, descricao, created_at"
      )
      .eq("empresa_id", input.empresaId)
      .eq("cliente_id", input.clienteId)
      .order("created_at", { ascending: false })
      .limit(200),
    input.supabase
      .from("vendas")
      .select(
        "id, numero, status, valor_total, finalizada_at, cancelada_at, motivo_cancelamento, created_at"
      )
      .eq("empresa_id", input.empresaId)
      .eq("cliente_id", input.clienteId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (recebimentosResult.error) {
    throw new Error(recebimentosResult.error.message);
  }
  if (estornosResult.error) {
    throw new Error(estornosResult.error.message);
  }
  if (titulosResult.error) {
    throw new Error(titulosResult.error.message);
  }
  if (itensResult.error) {
    throw new Error(itensResult.error.message);
  }
  if (movimentosResult.error) {
    throw new Error(movimentosResult.error.message);
  }
  if (vendasResult.error) {
    throw new Error(vendasResult.error.message);
  }

  const recebimentos = recebimentosResult.data ?? [];
  const recebimentoIds = recebimentos.map((item) => item.id);
  const alocacoesResult = recebimentoIds.length
    ? await input.supabase
        .from("carteira_cliente_recebimento_alocacoes")
        .select("id, recebimento_id, item_id, valor, created_at")
        .eq("empresa_id", input.empresaId)
        .in("recebimento_id", recebimentoIds)
    : { data: [], error: null };

  if (alocacoesResult.error) {
    throw new Error(alocacoesResult.error.message);
  }

  const vendaIds = (vendasResult.data ?? []).map((venda) => venda.id);
  const itensVendaResult = vendaIds.length
    ? await input.supabase
        .from("vendas_itens")
        .select("venda_id, produto_nome, quantidade, valor_total")
        .eq("empresa_id", input.empresaId)
        .in("venda_id", vendaIds)
    : { data: [], error: null };

  if (itensVendaResult.error) {
    throw new Error(itensVendaResult.error.message);
  }

  const itemPorId = new Map(resumo.itens.map((item) => [item.id, item]));
  const itemIdsAlocados = Array.from(
    new Set((alocacoesResult.data ?? []).map((item) => String(item.item_id)))
  ).filter((id) => !itemPorId.has(id));

  if (itemIdsAlocados.length) {
    const { data: itensAlocados, error } = await input.supabase
      .from("carteira_cliente_itens")
      .select("id, produto_nome, valor_original, valor_aberto")
      .eq("empresa_id", input.empresaId)
      .eq("cliente_id", input.clienteId)
      .in("id", itemIdsAlocados);
    if (error) {
      throw new Error(error.message);
    }
    for (const item of itensAlocados ?? []) {
      itemPorId.set(String(item.id), {
        id: String(item.id),
        titulo_id: "",
        venda_id: null,
        numero_venda: null,
        data: null,
        produto_nome: String(item.produto_nome ?? "Item"),
        valor_original: Number(item.valor_original ?? 0),
        valor_recebido: 0,
        valor_aberto: Number(item.valor_aberto ?? 0),
        vencido: false,
      });
    }
  }

  const estornos = estornosResult.data ?? [];
  const alocacoesEstornadas = new Set(
    estornos
      .filter((item) => item.status !== "CANCELADO")
      .map((item) => item.alocacao_id)
      .filter(Boolean)
  );
  const recebimentosEstornados = new Set(
    estornos
      .filter((item) => item.status !== "CANCELADO" && item.recebimento_id)
      .map((item) => String(item.recebimento_id))
  );
  const tituloPorItemId = new Map(
    (itensResult.data ?? []).map((item) => [String(item.id), String(item.titulo_id)])
  );
  const recebimentoPorId = new Map(
    recebimentos.map((item) => [String(item.id), item])
  );
  const datasRecebimentoPorTitulo = new Map<string, string[]>();
  for (const alocacao of alocacoesResult.data ?? []) {
    const tituloId = tituloPorItemId.get(String(alocacao.item_id));
    const recebimento = recebimentoPorId.get(String(alocacao.recebimento_id));
    if (!tituloId || !recebimento) {
      continue;
    }
    const lista = datasRecebimentoPorTitulo.get(tituloId) ?? [];
    lista.push(String(recebimento.processado_at ?? recebimento.created_at));
    datasRecebimentoPorTitulo.set(tituloId, lista);
  }

  const limite = Number(cliente.limite_credito ?? 0);
  const debitoAberto = resumo.situacao.debitoAberto;
  const creditoAberto = resumo.situacao.creditoAberto;
  const disponivelFiado = arredondar(Math.max(0, limite - debitoAberto));

  return {
    cliente: {
      id: String(cliente.id),
      nome: String(cliente.nome ?? ""),
      nomeFantasia: cliente.nome_fantasia ? String(cliente.nome_fantasia) : null,
      limiteCredito: limite,
      saldoDevedor: Number(cliente.saldo_devedor ?? 0),
      bloqueado: Boolean(cliente.bloqueado),
      diaVencimento: cliente.dia_vencimento == null ? null : Number(cliente.dia_vencimento),
      ativo: cliente.ativo !== false,
      debitoAberto,
      creditoAberto,
      vencido: resumo.situacao.vencido,
      disponivelFiado,
    },
    itens: resumo.itens,
    creditos: resumo.creditos,
    formas: resumo.formas,
    recebimentos: recebimentos.map((recebimento) => {
      const alocacoes = (alocacoesResult.data ?? []).filter(
        (alocacao) => alocacao.recebimento_id === recebimento.id
      );
      const itens = alocacoes.map((alocacao) => {
        const item = itemPorId.get(String(alocacao.item_id));
        return {
          alocacaoId: String(alocacao.id),
          itemId: String(alocacao.item_id),
          produtoNome: item?.produto_nome ?? "Item",
          valor: Number(alocacao.valor ?? 0),
        };
      });
      const alocacoesAtivas = alocacoes.filter(
        (alocacao) => !alocacoesEstornadas.has(alocacao.id)
      );
      return {
        id: String(recebimento.id),
        formaPagamentoNome: recebimento.forma_pagamento_nome
          ? String(recebimento.forma_pagamento_nome)
          : null,
        modo: String(recebimento.modo ?? ""),
        valor: Number(recebimento.valor ?? 0),
        saldoAnterior: Number(recebimento.saldo_anterior ?? 0),
        saldoPosterior: Number(recebimento.saldo_posterior ?? 0),
        observacao: recebimento.observacao ? String(recebimento.observacao) : null,
        processadoAt: recebimento.processado_at
          ? String(recebimento.processado_at)
          : null,
        createdAt: String(recebimento.created_at),
        itens,
        podeEstornar:
          alocacoesAtivas.length > 0 &&
          !recebimentosEstornados.has(String(recebimento.id)),
      };
    }),
    quitadas: (titulosResult.data ?? [])
      .filter((titulo) => tituloPassaNaAba(titulo.status, "QUITADAS"))
      .map((titulo) => {
        const itens = (itensResult.data ?? []).filter(
          (item) => item.titulo_id === titulo.id
        );
        return {
          id: String(titulo.id),
          vendaId: titulo.venda_id ? String(titulo.venda_id) : null,
          numeroVenda: titulo.numero_venda ?? null,
          data: titulo.created_at ? String(titulo.created_at) : null,
          quitadoEm: dataQuitacaoTitulo({
            status: titulo.status,
            updated_at: titulo.updated_at,
            recebimentosProcessadosEm:
              datasRecebimentoPorTitulo.get(String(titulo.id)) ?? [],
          }),
          valorOriginal: Number(titulo.valor_original ?? 0),
          itens: itens.map((item) => ({
            id: String(item.id),
            produtoNome: String(item.produto_nome ?? "Item"),
            valorOriginal: Number(item.valor_original ?? 0),
          })),
        };
      }),
    movimentos: (movimentosResult.data ?? []).map((movimento) => ({
      id: String(movimento.id),
      tipo: String(movimento.tipo ?? ""),
      origem: String(movimento.origem ?? ""),
      valor: Number(movimento.valor ?? 0),
      vendaId: movimento.venda_id ? String(movimento.venda_id) : null,
      recebimentoId: movimento.recebimento_id
        ? String(movimento.recebimento_id)
        : null,
      descricao: movimento.descricao ? String(movimento.descricao) : null,
      createdAt: String(movimento.created_at),
    })),
    compras: (vendasResult.data ?? []).map((venda) => {
      const titulo = (titulosResult.data ?? []).find(
        (item) => item.venda_id === venda.id
      );
      const itens = (itensVendaResult.data ?? []).filter(
        (item) => item.venda_id === venda.id
      );
      return {
        id: String(venda.id),
        numero: venda.numero ?? null,
        status: String(venda.status ?? ""),
        valorTotal: Number(venda.valor_total ?? 0),
        data: String(venda.finalizada_at ?? venda.created_at),
        motivoCancelamento: venda.motivo_cancelamento
          ? String(venda.motivo_cancelamento)
          : null,
        carteiraStatus: titulo ? String(titulo.status) : null,
        carteiraAberto: titulo ? Number(titulo.valor_aberto ?? 0) : null,
        itens: itens.map((item) => ({
          produtoNome: String(item.produto_nome ?? "Item"),
          quantidade: Number(item.quantidade ?? 0),
          valorTotal: Number(item.valor_total ?? 0),
        })),
      };
    }),
  };
}
