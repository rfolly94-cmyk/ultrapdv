import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import { carregarPropostaAcao } from "./carregar";
import { MENSAGEM_FALHA_APLICAR } from "./tipos";

export async function cancelarPropostaAcao(params: {
  ctx: ContextoFerramentaIa;
  propostaId: string;
}) {
  const carregada = await carregarPropostaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    propostaId: params.propostaId,
  });
  if (!carregada.ok) {
    return { ok: false as const, erro: carregada.erro };
  }
  if (carregada.proposta.status !== "pendente") {
    return { ok: false as const, erro: "Só é possível cancelar uma proposta pendente." };
  }
  const { error } = await params.ctx.supabase
    .from("ia_propostas_acoes")
    .update({ status: "cancelada" })
    .eq("empresa_id", params.ctx.empresaId)
    .eq("usuario_id", params.ctx.usuarioId)
    .eq("id", params.propostaId)
    .eq("status", "pendente");
  if (error) {
    return { ok: false as const, erro: error.message || MENSAGEM_FALHA_APLICAR };
  }
  return { ok: true as const, mensagem: "Proposta cancelada. Nada foi gravado." };
}
