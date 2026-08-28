import type { SupabaseClient } from "@supabase/supabase-js";

import { tipoDestinoPorUf } from "@/lib/fiscal/operacoes/resolver-cfop";

import type { ContextoFiscalEmpresa } from "./tipos";
import {
  dataReferenciaIso,
  type ContextoOperacaoFiscal,
  type TipoOperacaoFiscal,
} from "./tipos";

const TIPOS = new Set<TipoOperacaoFiscal>([
  "venda",
  "bonificacao",
  "transferencia",
  "devolucao",
  "outra",
]);

export function montarContextoOperacaoFiscal(params: {
  empresa: ContextoFiscalEmpresa;
  produtoId?: string | null;
  origemMercadoria?: string | null;
  quantidade?: number | null;
  valor?: number | null;
  tipoOperacao?: string | null;
  ufDestino?: string | null;
  destinatarioId?: string | null;
  contribuinteIcmsDestinatario?: boolean | null;
  consumidorFinal?: boolean | null;
  naturezaId?: string | null;
  dataReferencia?: string | null;
}): ContextoOperacaoFiscal {
  const tipo = TIPOS.has(params.tipoOperacao as TipoOperacaoFiscal)
    ? (params.tipoOperacao as TipoOperacaoFiscal)
    : "venda";
  return {
    empresa: params.empresa,
    produtoId: params.produtoId ?? null,
    origemMercadoria: params.origemMercadoria ?? null,
    quantidade: params.quantidade ?? null,
    valor: params.valor ?? null,
    tipoOperacao: tipo,
    ufOrigem: params.empresa.uf,
    ufDestino: params.ufDestino ? String(params.ufDestino).toUpperCase() : null,
    destinatarioId: params.destinatarioId ?? null,
    contribuinteIcmsDestinatario: params.contribuinteIcmsDestinatario ?? null,
    consumidorFinal: params.consumidorFinal ?? null,
    naturezaId: params.naturezaId ?? null,
    dataReferencia: dataReferenciaIso(params.dataReferencia),
  };
}

export function destinoOperacao(contexto: ContextoOperacaoFiscal) {
  return tipoDestinoPorUf(contexto.ufOrigem, contexto.ufDestino);
}

export async function carregarDestinatarioOperacao(params: {
  supabase: SupabaseClient;
  empresaId: string;
  destinatarioId: string;
}) {
  const { data } = await params.supabase
    .from("clientes")
    .select(
      "id, empresa_id, uf, contribuinte_icms, consumidor_final, indicador_ie_destinatario"
    )
    .eq("empresa_id", params.empresaId)
    .eq("id", params.destinatarioId)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== params.empresaId) {
    return null;
  }
  return {
    id: String(data.id),
    uf: data.uf ? String(data.uf).toUpperCase() : null,
    contribuinteIcms: Boolean(data.contribuinte_icms),
    consumidorFinal: Boolean(data.consumidor_final),
  };
}
