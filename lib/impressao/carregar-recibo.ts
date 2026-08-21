import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { pagamentoFinanceiramenteValido } from "@/lib/vendas/pagamentos-financeiros";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

export type ReciboVendaDados = {
  vendaId: string;
  numero: string;
  data: string | null;
  cliente: string;
  empresaNome: string;
  empresaDocumento: string;
  itens: Array<{
    nome: string;
    quantidade: number;
    total: number;
  }>;
  pagamentos: Array<{
    nome: string;
    valor: number;
  }>;
  desconto: number;
  acrescimo: number;
  total: number;
  troco: number;
};

export async function carregarReciboVendaDaEmpresaAtiva(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  vendaId: string;
}): Promise<ReciboVendaDados | null> {
  const { supabase, empresaId, vendaId } = args;

  const { data: venda } = await supabase
    .from("vendas")
    .select(
      "id, empresa_id, numero, cliente_id, valor_total, desconto, acrescimo, troco, finalizada_at, created_at"
    )
    .eq("empresa_id", empresaId)
    .eq("id", vendaId)
    .maybeSingle();

  if (!venda || venda.empresa_id !== empresaId) {
    return null;
  }

  const [{ data: empresa }, { data: cliente }, { data: itens }, { data: pagamentos }] =
    await Promise.all([
      supabase
        .from("empresas")
        .select("nome_fantasia, razao_social, cnpj")
        .eq("id", empresaId)
        .maybeSingle(),
      venda.cliente_id
        ? supabase
            .from("clientes")
            .select("id, empresa_id, nome")
            .eq("empresa_id", empresaId)
            .eq("id", venda.cliente_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("vendas_itens")
        .select("produto_nome, quantidade, valor_total, empresa_id")
        .eq("empresa_id", empresaId)
        .eq("venda_id", vendaId),
      supabase
        .from("vendas_pagamentos")
        .select("forma_pagamento_nome, valor, status, empresa_id")
        .eq("empresa_id", empresaId)
        .eq("venda_id", vendaId),
    ]);

  const clienteNome =
    cliente && cliente.empresa_id === empresaId
      ? cliente.nome
      : "Consumidor";

  return {
    vendaId: String(venda.id),
    numero: String(venda.numero ?? "—"),
    data: venda.finalizada_at ?? venda.created_at,
    cliente: clienteNome || "Consumidor",
    empresaNome: empresa?.nome_fantasia || empresa?.razao_social || "Empresa",
    empresaDocumento: String(empresa?.cnpj ?? ""),
    itens: (itens ?? [])
      .filter((item) => item.empresa_id === empresaId)
      .map((item) => ({
        nome: String(item.produto_nome ?? "Item"),
        quantidade: Number(item.quantidade ?? 0),
        total: Number(item.valor_total ?? 0),
      })),
    pagamentos: (pagamentos ?? [])
      .filter(
        (item) =>
          item.empresa_id === empresaId &&
          pagamentoFinanceiramenteValido(item.status)
      )
      .map((item) => ({
        nome: String(item.forma_pagamento_nome ?? "Pagamento"),
        valor: Number(item.valor ?? 0),
      })),
    desconto: Number(venda.desconto ?? 0),
    acrescimo: Number(venda.acrescimo ?? 0),
    total: Number(venda.valor_total ?? 0),
    troco: Number(venda.troco ?? 0),
  };
}

export function linhasReciboComercial(recibo: ReciboVendaDados) {
  const moeda = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const data = recibo.data
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(recibo.data))
    : "—";

  const linhas = [
    "UltraPDV",
    recibo.empresaNome,
    recibo.empresaDocumento ? `CNPJ ${recibo.empresaDocumento}` : "",
    "--------------------------------",
    `Recibo #${recibo.numero}`,
    data,
    `Cliente: ${recibo.cliente}`,
    "--------------------------------",
  ];

  for (const item of recibo.itens) {
    linhas.push(
      `${item.quantidade}x ${item.nome}`.slice(0, 42),
      `  ${moeda.format(item.total)}`
    );
  }

  linhas.push("--------------------------------");
  if (recibo.desconto > 0) {
    linhas.push(`Desconto ${moeda.format(recibo.desconto)}`);
  }
  if (recibo.acrescimo > 0) {
    linhas.push(`Acrescimo ${moeda.format(recibo.acrescimo)}`);
  }
  linhas.push(`TOTAL ${moeda.format(recibo.total)}`);
  for (const pagamento of recibo.pagamentos) {
    linhas.push(`${pagamento.nome} ${moeda.format(pagamento.valor)}`);
  }
  if (recibo.troco > 0) {
    linhas.push(`Troco ${moeda.format(recibo.troco)}`);
  }
  linhas.push("--------------------------------", "Sem valor fiscal");
  return linhas.filter((linha) => linha.length > 0);
}
