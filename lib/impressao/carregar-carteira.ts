import "server-only";

import { itensEmAbertoParaImpressao } from "@/lib/carteira/cancelar-itens";
import { dataDaVendaCarteira } from "@/lib/carteira/periodo";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

function dinheiro(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dataCurta(valor: string | null | undefined) {
  if (!valor) {
    return "-";
  }
  return new Date(valor).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

export function linhasItensAbertosCarteira(input: {
  empresa: string;
  cliente: string;
  grupos: Array<{
    numero: number | string | null;
    data: string | null;
    itens: Array<{
      produto_nome: string;
      quantidade: number | string;
      valor_original: number | string;
      valor_aberto: number | string;
    }>;
  }>;
  total: number;
  hoje: string;
}) {
  const linhas = [
    input.empresa,
    "ITENS EM ABERTO - CARTEIRA",
    "",
    `Cliente: ${input.cliente}`,
    `Data: ${input.hoje}`,
    "--------------------------------",
  ];

  for (const grupo of input.grupos) {
    linhas.push(`Venda #${grupo.numero ?? "-"}`);
    linhas.push(dataCurta(grupo.data));
    for (const item of grupo.itens) {
      const original = Number(item.valor_original ?? 0);
      const aberto = Number(item.valor_aberto ?? 0);
      const pago = Math.max(0, original - aberto);
      linhas.push(String(item.produto_nome ?? ""));
      linhas.push(`Qtd: ${Number(item.quantidade ?? 0)}`);
      linhas.push(`Original: ${dinheiro(original)}`);
      linhas.push(`Pago: ${dinheiro(pago)}`);
      linhas.push(`Aberto: ${dinheiro(aberto)}`);
    }
    linhas.push("--------------------------------");
  }

  if (!input.grupos.length) {
    linhas.push("Nenhum item em aberto neste cliente.");
    linhas.push("--------------------------------");
  }

  linhas.push(`TOTAL EM ABERTO: ${dinheiro(input.total)}`);
  linhas.push("--------------------------------");
  linhas.push("UltraPDV");
  return linhas;
}

export async function carregarItensAbertosCarteiraDaEmpresaAtiva(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  clienteId: string;
}) {
  const { supabase, empresaId, clienteId } = args;
  const [
    clienteResult,
    empresaResult,
    titulosResult,
    itensResult,
    vendasResult,
  ] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome, nome_fantasia")
      .eq("empresa_id", empresaId)
      .eq("id", clienteId)
      .maybeSingle(),
    supabase
      .from("empresas")
      .select("razao_social, nome_fantasia")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("carteira_cliente_titulos")
      .select("id, venda_id, numero_venda, valor_aberto, status, created_at")
      .eq("empresa_id", empresaId)
      .eq("cliente_id", clienteId),
    supabase
      .from("carteira_cliente_itens")
      .select(
        "id, titulo_id, produto_nome, quantidade, valor_original, valor_aberto, status"
      )
      .eq("empresa_id", empresaId)
      .eq("cliente_id", clienteId),
    supabase
      .from("vendas")
      .select("id, finalizada_at, created_at")
      .eq("empresa_id", empresaId)
      .eq("cliente_id", clienteId),
  ]);

  if (clienteResult.error) {
    throw new Error(clienteResult.error.message);
  }
  if (!clienteResult.data) {
    return null;
  }

  type ItemAberto = {
    id: string;
    titulo_id: string;
    produto_nome: string;
    quantidade: number | string;
    valor_original: number | string;
    valor_aberto: number | string;
    status: string;
  };

  const abertos = itensEmAbertoParaImpressao(
    (itensResult.data ?? []) as ItemAberto[]
  );
  const tituloPorId = new Map(
    (titulosResult.data ?? []).map((titulo) => [titulo.id, titulo])
  );
  const vendaPorId = new Map(
    (vendasResult.data ?? []).map((venda) => [venda.id, venda])
  );

  const grupos = new Map<
    string,
    {
      numero: number | string | null;
      data: string | null;
      itens: ItemAberto[];
    }
  >();

  for (const item of abertos) {
    const titulo = tituloPorId.get(item.titulo_id);
    if (!titulo) {
      continue;
    }
    const venda = vendaPorId.get(titulo.venda_id);
    const atual = grupos.get(titulo.id) ?? {
      numero: titulo.numero_venda,
      data: dataDaVendaCarteira({
        finalizada_at: venda?.finalizada_at ?? null,
        created_at: venda?.created_at ?? titulo.created_at,
      }),
      itens: [] as ItemAberto[],
    };
    atual.itens.push(item);
    grupos.set(titulo.id, atual);
  }

  const total = abertos.reduce(
    (soma, item) => soma + Number(item.valor_aberto ?? 0),
    0
  );

  return {
    empresa:
      empresaResult.data?.nome_fantasia ||
      empresaResult.data?.razao_social ||
      "ULTRAPDV",
    cliente:
      clienteResult.data.nome_fantasia ||
      clienteResult.data.nome ||
      "Cliente",
    grupos: Array.from(grupos.values()),
    total,
    hoje: new Date().toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    }),
  };
}
