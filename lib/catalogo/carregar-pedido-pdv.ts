import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PedidoPdvInicial } from "@/lib/catalogo/tipos";
import { formatarMoeda } from "@/lib/catalogo/regras";

function montarEndereco(pedido: {
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  complemento: string | null;
  referencia: string | null;
}) {
  const linha = [
    pedido.rua,
    pedido.numero,
    pedido.bairro,
    pedido.cidade,
    pedido.cep,
  ]
    .filter(Boolean)
    .join(", ");

  const extras = [pedido.complemento, pedido.referencia]
    .filter(Boolean)
    .join(" · ");

  if (!linha && !extras) {
    return null;
  }

  return extras ? `${linha}${linha ? " · " : ""}${extras}` : linha;
}

export async function carregarPedidoParaPdv(
  supabase: SupabaseClient,
  empresaId: string,
  pedidoId: string
): Promise<PedidoPdvInicial | null> {
  const { data: pedido, error } = await supabase
    .from("catalogo_pedidos")
    .select(`
      id,
      codigo,
      cliente_nome,
      cliente_whatsapp,
      tipo_entrega,
      cep,
      rua,
      numero,
      bairro,
      complemento,
      cidade,
      referencia,
      observacao,
      status,
      venda_id,
      catalogo_pedido_itens (
        produto_id,
        codigo_produto,
        nome_produto,
        quantidade,
        preco_unitario
      )
    `)
    .eq("empresa_id", empresaId)
    .eq("id", pedidoId)
    .maybeSingle();

  if (error || !pedido) {
    return null;
  }

  if (pedido.status === "CANCELADO" || pedido.status === "CONVERTIDO" || pedido.venda_id) {
    return null;
  }

  const itensRaw = Array.isArray(pedido.catalogo_pedido_itens)
    ? pedido.catalogo_pedido_itens
    : [];

  const produtoIds = itensRaw
    .map((item) => item.produto_id)
    .filter((id): id is string => Boolean(id));

  const [{ data: produtos }, { data: estoques }] = await Promise.all([
    produtoIds.length
      ? supabase
          .from("produtos")
          .select("id, codigo, nome, unidade_medida, preco_venda, ativo")
          .eq("empresa_id", empresaId)
          .in("id", produtoIds)
      : Promise.resolve({ data: [] }),
    produtoIds.length
      ? supabase
          .from("estoque_atual")
          .select("produto_id, quantidade")
          .eq("empresa_id", empresaId)
          .in("produto_id", produtoIds)
      : Promise.resolve({ data: [] }),
  ]);

  const produtosPorId = new Map(
    (produtos ?? []).map((produto) => [produto.id, produto])
  );
  const estoquePorId = new Map(
    (estoques ?? []).map((item) => [
      item.produto_id,
      Number(item.quantidade ?? 0),
    ])
  );

  const avisos: PedidoPdvInicial["avisos"] = [];
  const itens: PedidoPdvInicial["itens"] = [];

  for (const item of itensRaw) {
    const produto = item.produto_id
      ? produtosPorId.get(item.produto_id)
      : undefined;
    const quantidade = Number(item.quantidade);
    const precoPedido = Number(item.preco_unitario);

    if (!produto || !produto.ativo) {
      avisos.push({
        produtoId: item.produto_id ?? item.codigo_produto,
        nome: item.nome_produto,
        tipo: "indisponivel",
        detalhe: `Produto indisponível: ${item.nome_produto}. Remova ou substitua manualmente no PDV.`,
      });
      continue;
    }

    const precoAtual = Number(produto.preco_venda ?? 0);
    const estoque = estoquePorId.get(produto.id) ?? 0;

    if (Math.round(precoAtual * 100) !== Math.round(precoPedido * 100)) {
      avisos.push({
        produtoId: produto.id,
        nome: produto.nome,
        tipo: "preco",
        detalhe: `Preço alterado — ${produto.nome}. Pedido: ${formatarMoeda(precoPedido)}. Preço atual: ${formatarMoeda(precoAtual)}.`,
      });
    }

    if (estoque < quantidade) {
      avisos.push({
        produtoId: produto.id,
        nome: produto.nome,
        tipo: "estoque",
        detalhe: `Estoque insuficiente: ${produto.nome} — solicitado ${quantidade}, disponível ${estoque}.`,
      });
    }

    itens.push({
      produtoId: produto.id,
      codigo: produto.codigo,
      nome: produto.nome,
      unidadeMedida: produto.unidade_medida,
      quantidade,
      precoAtual,
      precoPedido,
    });
  }

  return {
    pedidoId: pedido.id,
    codigo: Number(pedido.codigo),
    clienteNome: pedido.cliente_nome,
    clienteWhatsapp: pedido.cliente_whatsapp,
    tipoEntrega: pedido.tipo_entrega,
    endereco: montarEndereco(pedido),
    observacao: pedido.observacao,
    avisos,
    itens,
  };
}
