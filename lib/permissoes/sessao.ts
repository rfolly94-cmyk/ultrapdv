import "server-only";

import { cache } from "react";

import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { createClient } from "@/lib/supabase/server";

import {
  carregarPermissoesDoVinculo,
  type SessaoPermissoes,
} from "./carregar";

export type { SessaoPermissoes };

export { carregarPermissoesDoVinculo };

export const obterPermissoesSessao = cache(async (): Promise<SessaoPermissoes | null> => {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return null;
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
    perfil: string | null;
    usuario_id: string;
  }>(supabase, usuarioId, "empresa_id, perfil, usuario_id");

  if (!vinculo) {
    return null;
  }

  return carregarPermissoesDoVinculo({
    supabase,
    usuarioId: String(usuarioId),
    empresaId: String(vinculo.empresa_id),
    perfil: String(vinculo.perfil ?? ""),
  });
});
