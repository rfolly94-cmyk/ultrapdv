import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaIaIndisponivel } from "../schema";
import type {
  EntidadeAcaoIa,
  PayloadAcaoIa,
  PropostaAcaoPersistida,
  StatusPropostaIa,
  TipoAcaoIa,
} from "./tipos";

export function mapearProposta(row: Record<string, unknown>): PropostaAcaoPersistida | null {
  const tipo = String(row.tipo ?? "") as TipoAcaoIa;
  const entidadeTipo = String(row.entidade_tipo ?? "") as EntidadeAcaoIa;
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as PayloadAcaoIa)
      : null;
  if (!payload) {
    return null;
  }
  return {
    id: String(row.id),
    empresaId: String(row.empresa_id),
    usuarioId: String(row.usuario_id),
    conversaId: String(row.conversa_id),
    tipo,
    entidadeTipo,
    entidadeId: row.entidade_id ? String(row.entidade_id) : null,
    descricao: String(row.descricao ?? ""),
    payload,
    hashEstado: String(row.hash_estado ?? ""),
    status: String(row.status ?? "pendente") as StatusPropostaIa,
    idempotencyKey: String(row.idempotency_key ?? ""),
    expiresAt: String(row.expires_at ?? ""),
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    executedAt: row.executed_at ? String(row.executed_at) : null,
    resultado:
      row.resultado && typeof row.resultado === "object"
        ? (row.resultado as Record<string, unknown>)
        : {},
    erro: row.erro ? String(row.erro) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function carregarPropostaAcao(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  propostaId: string;
}) {
  const { data, error } = await params.supabase
    .from("ia_propostas_acoes")
    .select(
      "id, empresa_id, usuario_id, conversa_id, tipo, entidade_tipo, entidade_id, descricao, payload, hash_estado, status, idempotency_key, expires_at, confirmed_at, executed_at, resultado, erro, created_at"
    )
    .eq("empresa_id", params.empresaId)
    .eq("usuario_id", params.usuarioId)
    .eq("id", params.propostaId)
    .maybeSingle();
  if (error) {
    if (tabelaIaIndisponivel(error)) {
      return { ok: false as const, indisponivel: true, erro: error.message };
    }
    return { ok: false as const, erro: error.message };
  }
  if (!data || String(data.empresa_id) !== params.empresaId) {
    return { ok: false as const, erro: "Proposta não encontrada nesta conversa." };
  }
  const proposta = mapearProposta(data as Record<string, unknown>);
  if (!proposta) {
    return { ok: false as const, erro: "Proposta inválida." };
  }
  return { ok: true as const, proposta };
}
