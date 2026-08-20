import { createClient } from "@/lib/supabase/server";

export async function obterPerfilSessao() {
  try {
    const supabase = await createClient();
    const { data: claimsData, error } = await supabase.auth.getClaims();
    const usuarioId = claimsData?.claims?.sub;

    if (error || !usuarioId) {
      return null;
    }

    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("perfil")
      .eq("usuario_id", String(usuarioId))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

    return vinculo?.perfil ? String(vinculo.perfil).toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function obterRotuloUsuarioSessao() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as
      | {
          email?: string;
          user_metadata?: { name?: string; full_name?: string };
        }
      | undefined;

    if (error || !claims) {
      return null;
    }

    const nome =
      claims.user_metadata?.full_name ||
      claims.user_metadata?.name ||
      claims.email ||
      null;

    return nome ? String(nome).trim() || null : null;
  } catch {
    return null;
  }
}
