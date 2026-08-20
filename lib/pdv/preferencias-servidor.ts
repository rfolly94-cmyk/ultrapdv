import "server-only";

import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { createClient } from "@/lib/supabase/server";
import {
  PREFERENCIAS_PDV_PADRAO,
  sanitizarPreferenciasPdv,
  tokensDaPaleta,
  type PreferenciasPdv,
} from "./preferencias";

export async function carregarPreferenciasPdvSessao(): Promise<PreferenciasPdv> {
  try {
    const supabase = await createClient();
    const { data: claimsData, error } = await supabase.auth.getClaims();
    const usuarioId = claimsData?.claims?.sub;

    if (error || !usuarioId) {
      return PREFERENCIAS_PDV_PADRAO;
    }

    const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
      empresa_id: string;
    }>(supabase, usuarioId, "empresa_id");

    if (!vinculo) {
      return PREFERENCIAS_PDV_PADRAO;
    }

    const { data, error: consultaError } = await supabase
      .from("usuarios_preferencias_pdv")
      .select(
        "paleta, cor_primaria, mostrar_logo_centro, mostrar_fotos_produtos, usuario_id, empresa_id"
      )
      .eq("usuario_id", String(usuarioId))
      .eq("empresa_id", vinculo.empresa_id)
      .maybeSingle();

    if (consultaError || !data) {
      return PREFERENCIAS_PDV_PADRAO;
    }

    return sanitizarPreferenciasPdv({
      paleta: data.paleta,
      corPrimaria: data.cor_primaria,
      mostrarLogoCentro: data.mostrar_logo_centro,
      mostrarFotosProdutos: data.mostrar_fotos_produtos,
    });
  } catch {
    return PREFERENCIAS_PDV_PADRAO;
  }
}

export async function gravarPreferenciasPdvSessao(input: PreferenciasPdv) {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return { ok: false as const, erro: "Não autenticado." };
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, usuarioId, "empresa_id");

  if (!vinculo) {
    return { ok: false as const, erro: "Empresa ativa não encontrada." };
  }

  const preferencias = sanitizarPreferenciasPdv(input);
  const agora = new Date().toISOString();
  const tokens = tokensDaPaleta(preferencias.paleta);

  const { error: upsertError } = await supabase
    .from("usuarios_preferencias_pdv")
    .upsert(
      {
        usuario_id: String(usuarioId),
        empresa_id: vinculo.empresa_id,
        paleta: preferencias.paleta,
        cor_primaria: tokens.primary,
        mostrar_logo_centro: preferencias.mostrarLogoCentro,
        mostrar_fotos_produtos: preferencias.mostrarFotosProdutos,
        updated_at: agora,
      },
      { onConflict: "usuario_id,empresa_id" }
    );

  if (upsertError) {
    return { ok: false as const, erro: upsertError.message };
  }

  return { ok: true as const, preferencias };
}
