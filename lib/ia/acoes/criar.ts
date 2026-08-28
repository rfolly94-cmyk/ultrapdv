import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaIaIndisponivel } from "../schema";
import { MAX_PROPOSTAS_PENDENTES, TTL_PROPOSTA_MS, type PayloadAcaoIa, type TipoAcaoIa, type EntidadeAcaoIa } from "./tipos";
import { hashEstadoEntidade } from "./hash";

export async function contarPendentesUsuario(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
}) {
  const { count, error } = await params.supabase
    .from("ia_propostas_acoes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", params.empresaId)
    .eq("usuario_id", params.usuarioId)
    .eq("status", "pendente");
  if (error) {
    if (tabelaIaIndisponivel(error)) {
      return { ok: false as const, indisponivel: true, erro: error.message };
    }
    return { ok: false as const, erro: error.message };
  }
  return { ok: true as const, total: count ?? 0 };
}

export async function criarPropostaAcao(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  conversaId: string;
  tipo: TipoAcaoIa;
  entidadeTipo: EntidadeAcaoIa;
  entidadeId: string | null;
  descricao: string;
  payload: PayloadAcaoIa;
  hashEstado: string;
  idempotencyKey?: string;
}) {
  const limite = await contarPendentesUsuario({
    supabase: params.supabase,
    empresaId: params.empresaId,
    usuarioId: params.usuarioId,
  });
  if (!limite.ok) {
    return limite;
  }
  if (limite.total >= MAX_PROPOSTAS_PENDENTES) {
    return {
      ok: false as const,
      erro: "Há propostas pendentes demais. Confirme ou cancele as anteriores.",
    };
  }

  const idempotencyKey =
    params.idempotencyKey ??
    hashEstadoEntidade({
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      conversaId: params.conversaId,
      tipo: params.tipo,
      entidadeId: params.entidadeId,
      hashEstado: params.hashEstado,
      depois: params.payload.depois,
    });

  const { data: existente } = await params.supabase
    .from("ia_propostas_acoes")
    .select("id, status, payload, entidade_tipo, entidade_id, tipo, descricao")
    .eq("empresa_id", params.empresaId)
    .eq("usuario_id", params.usuarioId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existente && String(existente.status) === "pendente") {
    return {
      ok: true as const,
      propostaId: String(existente.id),
      reutilizada: true,
    };
  }

  const agora = new Date();
  const { data, error } = await params.supabase
    .from("ia_propostas_acoes")
    .insert({
      empresa_id: params.empresaId,
      usuario_id: params.usuarioId,
      conversa_id: params.conversaId,
      tipo: params.tipo,
      entidade_tipo: params.entidadeTipo,
      entidade_id: params.entidadeId,
      descricao: params.descricao.slice(0, 500),
      payload: params.payload,
      hash_estado: params.hashEstado,
      status: "pendente",
      idempotency_key: `${idempotencyKey}:${agora.getTime()}`,
      expires_at: new Date(agora.getTime() + TTL_PROPOSTA_MS).toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (tabelaIaIndisponivel(error)) {
      return { ok: false as const, indisponivel: true, erro: error?.message ?? "" };
    }
    return { ok: false as const, erro: error?.message ?? "Não foi possível criar a proposta." };
  }
  return { ok: true as const, propostaId: String(data.id), reutilizada: false };
}
