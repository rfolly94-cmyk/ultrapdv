import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoEventoContabilidade =
  | "COMPETENCIA_LIBERADA"
  | "ZIP_GERADO"
  | "INVENTARIO_GERADO";

export async function registrarEventoContabilidade(
  supabase: SupabaseClient,
  input: {
    empresaId: string;
    tipo: TipoEventoContabilidade;
    usuarioId?: string | null;
    ano?: number;
    mes?: number;
    detalhe?: string;
  }
) {
  const { error } = await supabase.from("contabilidade_eventos").insert({
    empresa_id: input.empresaId,
    tipo: input.tipo,
    usuario_id: input.usuarioId ?? null,
    ano: input.ano ?? null,
    mes: input.mes ?? null,
    detalhe: input.detalhe ?? null,
  });

  if (error) {
    console.error("Falha ao registrar evento de contabilidade:", error.message);
  }
}
