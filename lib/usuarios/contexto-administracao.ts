import "server-only";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

export class ErroAdministracaoUsuarios
  extends Error {
  status: number;

  constructor(
    mensagem: string,
    status = 403
  ) {
    super(mensagem);
    this.name =
      "ErroAdministracaoUsuarios";
    this.status = status;
  }
}

export const MENSAGEM_ADMIN_DIAGNOSTICO =
  "Somente administradores da empresa podem executar este diagnóstico.";

export async function
obterContextoAdministracaoUsuarios(opcoes?: {
  mensagemNaoAdmin?: string;
}) {
  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } =
    await supabase.auth.getClaims();

  const usuarioId =
    claimsData?.claims?.sub;

  if (
    authError ||
    !usuarioId
  ) {
    throw new ErroAdministracaoUsuarios(
      "Não autenticado.",
      401
    );
  }

  /*
   * O vínculo deve pertencer ao usuário autenticado.
   *
   * Sem este filtro, uma tabela/RLS permissiva pode devolver
   * vários vínculos ativos/principais de usuários diferentes,
   * fazendo .maybeSingle() falhar com:
   *
   * "JSON object requested, multiple (or no) rows returned"
   */
  const {
    data: vinculo,
    error: vinculoError,
  } =
    await supabase
      .from(
        "usuarios_empresas"
      )
      .select(
        "usuario_id, empresa_id, perfil, principal, ativo"
      )
      .eq(
        "usuario_id",
        String(usuarioId)
      )
      .eq(
        "principal",
        true
      )
      .eq(
        "ativo",
        true
      )
      .maybeSingle();

  if (
    vinculoError
  ) {
    throw new ErroAdministracaoUsuarios(
      `Não foi possível consultar o vínculo da empresa: ${vinculoError.message}`,
      500
    );
  }

  if (
    !vinculo
  ) {
    throw new ErroAdministracaoUsuarios(
      "Nenhum vínculo principal e ativo foi encontrado para este login.",
      403
    );
  }

  const perfil =
    String(
      vinculo.perfil ??
      ""
    )
      .trim()
      .toLowerCase();

  if (
    perfil !==
    "administrador"
  ) {
    throw new ErroAdministracaoUsuarios(
      opcoes?.mensagemNaoAdmin ??
        `Este acesso possui perfil "${vinculo.perfil ?? "sem perfil"}". Somente administradores podem gerenciar usuários.`,
      403
    );
  }

  return {
    supabase,
    admin:
      createAdminClient(),
    usuarioId:
      String(usuarioId),
    empresaId:
      String(
        vinculo.empresa_id
      ),
    perfil,
  };
}
