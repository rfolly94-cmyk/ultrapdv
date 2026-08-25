import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";

import { controleCaixaAtivoDoRegistro } from "./controle";
import { MENSAGEM_CONTROLE_CAIXA_DESATIVADO_OPERACAO } from "./mensagens";

export async function controleCaixaAtivo(
  supabase: SupabaseClient,
  empresaId: string
): Promise<boolean> {
  const id = String(empresaId ?? "").trim();
  if (!id) {
    return controleCaixaAtivoDoRegistro(undefined);
  }

  const { data, error } = await supabase
    .from("caixa_configuracoes")
    .select("empresa_id, controle_caixa_ativo")
    .eq("empresa_id", id)
    .maybeSingle();

  if (error || !data) {
    return controleCaixaAtivoDoRegistro(undefined);
  }

  if (!registroPertenceAEmpresaAtiva(data, id)) {
    return controleCaixaAtivoDoRegistro(undefined);
  }

  return controleCaixaAtivoDoRegistro(
    (data as { controle_caixa_ativo?: unknown }).controle_caixa_ativo
  );
}

export async function recusarSessaoCaixaSeControleDesativado(
  supabase: SupabaseClient,
  empresaId: string
): Promise<{ ok: false; erro: string } | null> {
  if (await controleCaixaAtivo(supabase, empresaId)) {
    return null;
  }
  return { ok: false, erro: MENSAGEM_CONTROLE_CAIXA_DESATIVADO_OPERACAO };
}
