import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  dataHoraRecibo,
  montarItensReciboRecebimento,
  type ReciboRecebimentoCarteira,
} from "./recibo-carteira";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export async function carregarReciboRecebimentoCarteiraDaEmpresaAtiva(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  clienteId: string;
  recebimentoId: string;
}): Promise<ReciboRecebimentoCarteira | null> {
  const { supabase, empresaId, clienteId, recebimentoId } = args;

  const { data: recebimento, error: erroRecebimento } = await supabase
    .from("carteira_cliente_recebimentos")
    .select(
      "id, empresa_id, cliente_id, usuario_id, forma_pagamento_nome, valor, processado_at, created_at"
    )
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId)
    .eq("id", recebimentoId)
    .maybeSingle();

  if (erroRecebimento) {
    throw new Error(erroRecebimento.message);
  }

  if (
    !recebimento ||
    recebimento.empresa_id !== empresaId ||
    recebimento.cliente_id !== clienteId ||
    recebimento.id !== recebimentoId
  ) {
    return null;
  }

  const [
    empresaResult,
    fiscalResult,
    clienteResult,
    alocacoesResult,
    operadorResult,
  ] = await Promise.all([
    supabase
      .from("empresas")
      .select("nome_fantasia, razao_social, cnpj")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("empresas_fiscal")
      .select("telefone, logradouro, numero, bairro, municipio, uf")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase
      .from("clientes")
      .select("id, empresa_id, nome, nome_fantasia, cpf_cnpj")
      .eq("empresa_id", empresaId)
      .eq("id", clienteId)
      .maybeSingle(),
    supabase
      .from("carteira_cliente_recebimento_alocacoes")
      .select("item_id, valor, created_at")
      .eq("empresa_id", empresaId)
      .eq("recebimento_id", recebimentoId)
      .order("created_at", { ascending: true }),
    recebimento.usuario_id
      ? supabase
          .from("usuarios")
          .select("id, nome")
          .eq("id", recebimento.usuario_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (empresaResult.error) {
    throw new Error(empresaResult.error.message);
  }
  if (clienteResult.error) {
    throw new Error(clienteResult.error.message);
  }
  if (
    !clienteResult.data ||
    clienteResult.data.empresa_id !== empresaId ||
    clienteResult.data.id !== clienteId
  ) {
    return null;
  }

  if (alocacoesResult.error) {
    throw new Error(alocacoesResult.error.message);
  }

  const alocacoes = alocacoesResult.data ?? [];
  const itemIds = Array.from(
    new Set(alocacoes.map((item) => String(item.item_id)).filter(Boolean))
  );

  const itensResult = itemIds.length
    ? await supabase
        .from("carteira_cliente_itens")
        .select("id, titulo_id, produto_nome")
        .eq("empresa_id", empresaId)
        .in("id", itemIds)
    : { data: [], error: null };

  if (itensResult.error) {
    throw new Error(itensResult.error.message);
  }

  const itens = itensResult.data ?? [];
  const tituloIds = Array.from(
    new Set(itens.map((item) => String(item.titulo_id)).filter(Boolean))
  );

  const titulosResult = tituloIds.length
    ? await supabase
        .from("carteira_cliente_titulos")
        .select("id, numero_venda")
        .eq("empresa_id", empresaId)
        .in("id", tituloIds)
    : { data: [], error: null };

  if (titulosResult.error) {
    throw new Error(titulosResult.error.message);
  }

  const fiscal = fiscalResult.data;
  const endereco = [
    fiscal?.logradouro,
    fiscal?.numero,
    fiscal?.bairro,
    fiscal?.municipio,
    fiscal?.uf,
  ]
    .filter(Boolean)
    .join(", ");

  const dataIso = recebimento.processado_at ?? recebimento.created_at;
  const dataHora = dataHoraRecibo(dataIso);

  return {
    empresaNome:
      texto(empresaResult.data?.nome_fantasia) ||
      texto(empresaResult.data?.razao_social) ||
      "UltraPDV",
    empresaDocumento: texto(empresaResult.data?.cnpj),
    empresaTelefone: texto(fiscal?.telefone),
    empresaEndereco: texto(endereco),
    clienteNome:
      texto(clienteResult.data.nome_fantasia) ||
      texto(clienteResult.data.nome) ||
      "Cliente",
    clienteDocumento: texto(clienteResult.data.cpf_cnpj),
    recebimentoId: String(recebimento.id),
    dataIso,
    dataHora,
    formaPagamento: texto(recebimento.forma_pagamento_nome) || "-",
    valor: Number(recebimento.valor ?? 0),
    itens: montarItensReciboRecebimento({
      alocacoes,
      itens,
      titulos: titulosResult.data ?? [],
    }),
    operadorNome: texto(operadorResult.data?.nome),
    rodapeDataHora: dataHora,
  };
}
