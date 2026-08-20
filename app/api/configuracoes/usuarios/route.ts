import {
  NextRequest,
  NextResponse,
} from "next/server";
import { revalidatePath } from "next/cache";

import {
  ErroAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

import {
  perfilUsuarioValido,
} from "@/lib/usuarios/perfis";

import { createAdminClient } from "@/lib/supabase/admin";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { substituirPermissoesUsuarioEmpresa } from "@/lib/permissoes/gravar";

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

function emailValido(
  email: string
) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function mensagemAuth(
  mensagem: string
) {
  const normalizada =
    mensagem.toLowerCase();

  if (
    normalizada.includes(
      "already"
    ) ||
    normalizada.includes(
      "registered"
    ) ||
    normalizada.includes(
      "exists"
    )
  ) {
    return "Já existe um login cadastrado com este e-mail.";
  }

  return "Não foi possível criar o login no Supabase Auth.";
}

export async function POST(
  request: NextRequest
) {
  try {
    const sessao = await exigirPermissao({
      modulo: "usuarios",
      acao: "criar",
    });
    const admin = createAdminClient();
    const empresaId = sessao.empresaId;

    let body: {
      nome?: unknown;
      email?: unknown;
      senha?: unknown;
      perfil?: unknown;
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

    const nome =
      texto(body.nome);

    const email =
      texto(
        body.email
      ).toLowerCase();

    const senha =
      texto(body.senha);

    const perfil =
      texto(
        body.perfil
      ).toLowerCase();

    if (
      nome.length < 2
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Informe o nome do usuário.",
        },
        422
      );
    }

    if (
      !emailValido(
        email
      )
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Informe um e-mail válido.",
        },
        422
      );
    }

    if (
      senha.length < 8
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "A senha provisória deve ter pelo menos 8 caracteres.",
        },
        422
      );
    }

    if (
      !perfilUsuarioValido(
        perfil
      )
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Perfil de acesso inválido.",
        },
        422
      );
    }

    const {
      data: usuarioMesmoEmail,
    } =
      await admin
        .from("usuarios")
        .select("id")
        .ilike(
          "email",
          email
        )
        .maybeSingle();

    if (
      usuarioMesmoEmail
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Já existe um usuário cadastrado com este e-mail.",
        },
        409
      );
    }

    const {
      data: authData,
      error: authCreateError,
    } =
      await admin
        .auth.admin
        .createUser({
          email,
          password:
            senha,
          email_confirm:
            true,
          user_metadata: {
            nome,
          },
        });

    if (
      authCreateError ||
      !authData.user
    ) {
      return resposta(
        {
          ok: false,
          erro: mensagemAuth(
            authCreateError
              ?.message ??
              ""
          ),
        },
        409
      );
    }

    const novoUsuarioId =
      authData.user.id;

    const rollback =
      async () => {
        await admin
          .from(
            "usuarios_permissoes_empresas"
          )
          .delete()
          .eq(
            "usuario_id",
            novoUsuarioId
          )
          .eq(
            "empresa_id",
            empresaId
          );

        await admin
          .from(
            "usuarios_empresas"
          )
          .delete()
          .eq(
            "usuario_id",
            novoUsuarioId
          )
          .eq(
            "empresa_id",
            empresaId
          );

        await admin
          .from("usuarios")
          .delete()
          .eq(
            "id",
            novoUsuarioId
          );

        await admin
          .auth.admin
          .deleteUser(
            novoUsuarioId
          );
      };

    const {
      error: usuarioError,
    } =
      await admin
        .from("usuarios")
        .upsert(
          {
            id:
              novoUsuarioId,
            nome,
            email,
            ativo:
              true,
          },
          {
            onConflict:
              "id",
          }
        );

    if (
      usuarioError
    ) {
      await rollback();

      return resposta(
        {
          ok: false,
          erro:
            `Login criado, mas não foi possível registrar o usuário: ${usuarioError.message}`,
        },
        500
      );
    }

    const {
      error: vinculoError,
    } =
      await admin
        .from(
          "usuarios_empresas"
        )
        .insert({
          usuario_id:
            novoUsuarioId,
          empresa_id:
            empresaId,
          perfil,
          principal:
            true,
          ativo:
            true,
        });

    if (
      vinculoError
    ) {
      await rollback();

      return resposta(
        {
          ok: false,
          erro:
            `Não foi possível vincular o usuário à empresa: ${vinculoError.message}`,
        },
        500
      );
    }

    try {
      await substituirPermissoesUsuarioEmpresa({
        admin,
        usuarioId: novoUsuarioId,
        empresaId,
        perfil,
      });
    } catch (error) {
      await rollback();
      return resposta(
        {
          ok: false,
          erro:
            error instanceof Error
              ? error.message
              : "Não foi possível gravar as permissões iniciais.",
        },
        500
      );
    }

    revalidatePath("/", "layout");
    revalidatePath("/configuracoes/usuarios");

    return resposta(
      {
        ok: true,
        usuario: {
          id:
            novoUsuarioId,
          nome,
          email,
          perfil,
          ativo:
            true,
        },
        mensagem:
          "Usuário criado com sucesso.",
      },
      201
    );
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return resposta(
        {
          ok: false,
          erro: error.message,
        },
        error.status
      );
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
            : "Erro inesperado ao criar usuário.",
      },
      500
    );
  }
}
