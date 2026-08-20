import "server-only";

import { conversaEstaAtiva } from "./tipos";
import type { ConversaSuporte } from "./tipos";

export async function buscarConversaAtivaUsuario(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  usuarioId: string,
  empresaId: string
): Promise<ConversaSuporte | null> {
  const { data, error } = await supabase
    .from("suporte_conversas")
    .select(
      "id, empresa_id, aberto_por_usuario_id, atendente_master_usuario_id, status, assunto, ultima_mensagem_em, created_at"
    )
    .eq("aberto_por_usuario_id", usuarioId)
    .eq("empresa_id", empresaId)
    .in("status", ["aberta", "aguardando_suporte", "aguardando_cliente"])
    .order("ultima_mensagem_em", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const conversa = data?.[0] ?? null;
  if (!conversa || !conversaEstaAtiva(String(conversa.status))) {
    return null;
  }

  return conversa as ConversaSuporte;
}
