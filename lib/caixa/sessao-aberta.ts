import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import type { CaixaAvisoReaberto } from "./tipos";

export {
  MENSAGEM_CAIXA_FECHADO_FINALIZAR,
  MENSAGEM_CAIXA_FECHADO_PDV,
  MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO,
} from "./mensagens";

export type CaixaAbertoEmpresa = {
  id: string;
  reaberto: boolean;
  aviso: CaixaAvisoReaberto | null;
};

/**
 * Sessão de caixa aberta da empresa ativa.
 * `filial_id` permanece reservado: enquanto for null, há no máximo um caixa
 * aberto por empresa (índice `ux_caixas_aberto_empresa_sem_filial`).
 */
export async function buscarCaixaAbertoEmpresa(
  supabase: SupabaseClient,
  empresaId: string
): Promise<CaixaAbertoEmpresa | null> {
  const id = String(empresaId ?? "").trim();
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from("caixas")
    .select("id, empresa_id, status, filial_id, reaberto")
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

  const caixaId = String(data.id);
  const reaberto = data.reaberto === true;
  if (!reaberto) {
    return { id: caixaId, reaberto: false, aviso: null };
  }

  const { data: reabertura } = await supabase
    .from("caixa_reaberturas")
    .select("reaberto_em, reaberto_por, motivo")
    .eq("empresa_id", id)
    .eq("caixa_id", caixaId)
    .order("reaberto_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!reabertura) {
    return { id: caixaId, reaberto: true, aviso: null };
  }

  const porId = String(
    (reabertura as { reaberto_por?: unknown }).reaberto_por ?? ""
  );
  let nome: string | null = null;
  if (porId) {
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("id, nome")
      .eq("id", porId)
      .maybeSingle();
    const bruto = String((usuario as { nome?: unknown } | null)?.nome ?? "").trim();
    nome = bruto || null;
  }

  return {
    id: caixaId,
    reaberto: true,
    aviso: {
      reaberto_em: String(
        (reabertura as { reaberto_em?: unknown }).reaberto_em ?? ""
      ),
      reaberto_por_nome: nome,
      motivo: String((reabertura as { motivo?: unknown }).motivo ?? "").trim(),
    },
  };
}
