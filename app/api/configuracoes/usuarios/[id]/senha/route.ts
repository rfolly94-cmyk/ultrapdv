import {
  NextRequest,
  NextResponse,
} from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import {
  ErroAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

function resposta(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
    }
  );
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const sessao = await exigirPermissao({
      modulo: "usuarios",
      acao: "editar",
    });
    const admin = createAdminClient();
    const empresaId = sessao.empresaId;

    const {
      id: usuarioId,
    } =
      await params;

    let body: {
      senha?: unknown;
    };

    try {
      body =
        await request.json();
    } catch {
      return resposta(
        {
          ok: false,
          erro:
            "JSON inválido.",
        },
        400
      );
    }

    const senha =
      texto(body.senha);

    if (
      senha.length < 8
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "A nova senha deve ter pelo menos 8 caracteres.",
        },
        422
      );
    }

    const {
      data: vinculo,
      error:
        vinculoError,
    } =
      await admin
        .from(
          "usuarios_empresas"
        )
        .select(
          "usuario_id"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "usuario_id",
          usuarioId
        )
        .maybeSingle();

    if (
      vinculoError
    ) {
      return resposta(
        {
          ok: false,
          erro:
            vinculoError.message,
        },
        500
      );
    }

    if (
      !vinculo
    ) {
      console.error(
        "[usuarios] vinculo ausente na empresa ativa ao redefinir senha",
        {
          usuarioId,
          empresaId,
        }
      );
      return resposta(
        {
          ok: false,
          erro:
            "Recurso não encontrado.",
        },
        404
      );
    }

    const {
      error:
        authUpdateError,
    } =
      await admin
        .auth.admin
        .updateUserById(
          usuarioId,
          {
            password:
              senha,
          }
        );

    if (
      authUpdateError
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Não foi possível redefinir a senha deste usuário.",
        },
        500
      );
    }

    return resposta({
      ok: true,
      mensagem:
        "Senha redefinida com sucesso.",
    });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return resposta({ ok: false, erro: error.message }, error.status);
    }

    if (
      error instanceof
      ErroAdministracaoUsuarios
    ) {
      return resposta(
        {
          ok: false,
          erro:
            error.message,
        },
        error.status
      );
    }

    return resposta(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro inesperado ao redefinir senha.",
      },
      500
    );
  }
}
