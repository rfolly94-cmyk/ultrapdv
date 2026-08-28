import type { SupabaseClient } from "@supabase/supabase-js";

export async function registrarAuditoriaAcao(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  conversaId?: string | null;
  propostaId?: string | null;
  entidade: "produto_fiscal" | "grupo_fiscal" | "produto" | "notificacao" | "desfazer";
  entidadeId: string;
  tipoAcao: string;
  valoresAnteriores: Record<string, unknown>;
  valoresNovos: Record<string, unknown>;
  sugestao?: Record<string, unknown>;
  fontes?: unknown[];
  versaoTabelas?: string | null;
  resultado?: string | null;
  erro?: string | null;
}) {
  const { error } = await params.supabase.from("ia_auditoria").insert({
    empresa_id: params.empresaId,
    usuario_id: params.usuarioId,
    conversa_id: params.conversaId ?? null,
    proposta_id: params.propostaId ?? null,
    entidade: params.entidade,
    entidade_id: params.entidadeId,
    tipo_acao: params.tipoAcao,
    valores_anteriores: params.valoresAnteriores,
    valores_novos: params.valoresNovos,
    sugestao: params.sugestao ?? {},
    fontes: params.fontes ?? [],
    versao_tabelas: params.versaoTabelas ?? null,
    resultado: params.resultado ?? null,
    erro: params.erro ?? null,
  });
  if (error) {
    console.error("[ia] falha ao registrar auditoria", error.message);
  }
}
