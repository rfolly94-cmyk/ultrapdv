import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";

export {
  MENSAGEM_CAIXA_FECHADO_FINALIZAR,
  MENSAGEM_CAIXA_FECHADO_PDV,
  MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO,
} from "./mensagens";

/**
 * Sessão de caixa aberta da empresa ativa.
 * `filial_id` permanece reservado: enquanto for null, há no máximo um caixa
 * aberto por empresa (índice `ux_caixas_aberto_empresa_sem_filial`).
 */
export async function buscarCaixaAbertoEmpresa(
  supabase: SupabaseClient,
  empresaId: string
): Promise<{ id: string } | null> {
  const id = String(empresaId ?? "").trim();
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from("caixas")
    .select("id, empresa_id, status, filial_id")
    .eq("empresa_id", id)
    .eq("status", "aberto")
    .is("filial_id", null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (!registroPertenceAEmpresaAtiva(data, id)) {
    return null;
  }

  if (String(data.status) !== "aberto") {
    return null;
  }

  return { id: String(data.id) };
}
