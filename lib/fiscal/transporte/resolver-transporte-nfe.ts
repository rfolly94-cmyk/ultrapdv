import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizarDadosTransporteVenda,
  type DadosTransporteNfeVenda,
} from "@/lib/fiscal/transporte/dados-transporte-venda";

export type OrigemTransporteNfe = "operacao" | "venda" | "vazio";

export type TransporteNfeResolvido = {
  dados: DadosTransporteNfeVenda;
  origem: OrigemTransporteNfe;
};

function temRegistroTransporte(valor: unknown) {
  return valor !== null && valor !== undefined;
}

export function resolverDadosTransporteNfe(params: {
  dadosOperacao?: unknown;
  dadosVenda?: unknown;
}): TransporteNfeResolvido {
  if (temRegistroTransporte(params.dadosOperacao)) {
    return {
      dados: normalizarDadosTransporteVenda(params.dadosOperacao),
      origem: "operacao",
    };
  }
  if (temRegistroTransporte(params.dadosVenda)) {
    return {
      dados: normalizarDadosTransporteVenda(params.dadosVenda),
      origem: "venda",
    };
  }
  return {
    dados: normalizarDadosTransporteVenda(null),
    origem: "vazio",
  };
}

export async function carregarTransporteNfe55(params: {
  db: SupabaseClient;
  empresaId: string;
  operacaoId?: string | null;
  vendaId?: string | null;
}): Promise<TransporteNfeResolvido> {
  const empresaId = String(params.empresaId ?? "").trim();
  const operacaoId = String(params.operacaoId ?? "").trim();
  const vendaId = String(params.vendaId ?? "").trim();

  if (!empresaId) {
    return resolverDadosTransporteNfe({});
  }

  let dadosOperacao: unknown = null;

  if (operacaoId) {
    const { data } = await params.db
      .from("fiscal_operacoes")
      .select("dados_transporte")
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    dadosOperacao = data?.dados_transporte ?? null;
  } else if (vendaId) {
    const { data } = await params.db
      .from("fiscal_operacoes")
      .select("dados_transporte")
      .eq("empresa_id", empresaId)
      .eq("venda_id", vendaId)
      .not("dados_transporte", "is", null)
      .limit(1);
    const linha = Array.isArray(data) ? data[0] : data;
    dadosOperacao = linha?.dados_transporte ?? null;
  }

  let dadosVenda: unknown = null;
  if (vendaId && !temRegistroTransporte(dadosOperacao)) {
    const { data } = await params.db
      .from("vendas")
      .select("dados_transporte")
      .eq("id", vendaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    dadosVenda = data?.dados_transporte ?? null;
  }

  return resolverDadosTransporteNfe({
    dadosOperacao,
    dadosVenda,
  });
}
