import "server-only";

import { decidirAcessoAdminPlataforma } from "@/lib/plataforma/autorizacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export class ErroAdminPlataforma extends Error {
  status: number;

  constructor(mensagem: string, status = 404) {
    super(mensagem);
    this.name = "ErroAdminPlataforma";
    this.status = status;
  }
}

export async function obterContextoAdminPlataforma() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (authError || !usuarioId) {
    throw new ErroAdminPlataforma("Não autenticado.", 401);
  }

  const { data: adminPlataforma, error } = await supabase
    .from("administradores_plataforma")
    .select("usuario_id, ativo")
    .eq("usuario_id", String(usuarioId))
    .eq("ativo", true)
    .maybeSingle();

  if (error) {
    throw new ErroAdminPlataforma(
      "Não foi possível validar o acesso à plataforma.",
      500
    );
  }

  const acesso = decidirAcessoAdminPlataforma({
    usuarioId: String(usuarioId),
    autenticado: true,
    admin: adminPlataforma
      ? {
          usuario_id: String(adminPlataforma.usuario_id),
          ativo: Boolean(adminPlataforma.ativo),
        }
      : null,
  });

  if (!acesso.ok) {
    throw new ErroAdminPlataforma("Recurso não encontrado.", acesso.status);
  }

  return {
    supabase,
    admin: createAdminClient(),
    usuarioId: String(usuarioId),
  };
}
