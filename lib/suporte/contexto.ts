import "server-only";

import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { createClient } from "@/lib/supabase/server";

export class ErroSuporte extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroSuporte";
  }
}

export async function obterContextoSuporteUsuario() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    throw new ErroSuporte("Não autenticado.");
  }

  const { data: vinculo, error: erroVinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, usuarioId, "empresa_id");

  if (erroVinculo) {
    throw new ErroSuporte(erroVinculo.message);
  }
  if (!vinculo?.empresa_id) {
    throw new ErroSuporte("Empresa ativa não encontrada.");
  }

  return {
    supabase,
    usuarioId: String(usuarioId),
    empresaId: String(vinculo.empresa_id),
  };
}
