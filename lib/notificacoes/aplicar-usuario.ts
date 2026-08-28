import type { SupabaseClient } from "@supabase/supabase-js";

import { aplicarAcaoUsuario } from "./estado-usuario";
import {
  ADIAR_NOTIFICACAO,
  type OpcaoAdiarNotificacao,
} from "./tipos";

export async function aplicarEstadoNotificacaoUsuario(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  notificacaoId: string;
  acao: "lida" | "nao_lida" | "dispensar" | "adiar";
  adiar?: OpcaoAdiarNotificacao;
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { data: notificacao, error } = await params.supabase
    .from("notificacoes")
    .select("id, empresa_id")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.notificacaoId)
    .maybeSingle();
  if (error) {
    return { ok: false, erro: error.message };
  }
  if (!notificacao || String(notificacao.empresa_id) !== params.empresaId) {
    return { ok: false, erro: "Notificação não encontrada nesta empresa." };
  }

  const { data: atual } = await params.supabase
    .from("notificacoes_usuarios")
    .select("lida_em, dispensada_em, adiada_ate")
    .eq("empresa_id", params.empresaId)
    .eq("notificacao_id", params.notificacaoId)
    .eq("usuario_id", params.usuarioId)
    .maybeSingle();

  const proximo = aplicarAcaoUsuario({
    estado: {
      lidaEm: atual?.lida_em ? String(atual.lida_em) : null,
      dispensadaEm: atual?.dispensada_em ? String(atual.dispensada_em) : null,
      adiadaAte: atual?.adiada_ate ? String(atual.adiada_ate) : null,
    },
    acao: params.acao,
    adiar:
      params.adiar && (ADIAR_NOTIFICACAO as readonly string[]).includes(params.adiar)
        ? params.adiar
        : "1h",
    agora: new Date(),
  });

  const { error: erroUpsert } = await params.supabase.from("notificacoes_usuarios").upsert(
    {
      empresa_id: params.empresaId,
      notificacao_id: params.notificacaoId,
      usuario_id: params.usuarioId,
      lida_em: proximo.lidaEm,
      dispensada_em: proximo.dispensadaEm,
      adiada_ate: proximo.adiadaAte,
    },
    { onConflict: "empresa_id,notificacao_id,usuario_id" }
  );
  if (erroUpsert) {
    return { ok: false, erro: erroUpsert.message };
  }
  return { ok: true };
}
