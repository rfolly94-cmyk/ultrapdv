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
import {
  origemDasPermissoes,
  resolverPermissoesEfetivas,
  sanitizarMatrizRecebida,
} from "@/lib/permissoes/resolver";
import { ultimoAdministradorFicariaIndefeso } from "@/lib/permissoes/ultimo-administrador";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

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

async function podeRemoverAdministrador(
  admin: ReturnType<typeof createAdminClient>,
  empresaId: string,
  usuarioId: string
) {
  const {
    count,
    error,
  } =
    await admin
      .from(
        "usuarios_empresas"
      )
      .select(
        "usuario_id",
        {
          count:
            "exact",
          head:
            true,
        }
      )
      .eq(
        "empresa_id",
        empresaId
      )
      .eq(
        "perfil",
        "administrador"
      )
      .eq(
        "ativo",
        true
      )
      .neq(
        "usuario_id",
        usuarioId
      );

  if (
    error
  ) {
    throw new Error(
      error.message
    );
  }

  return (
    count ?? 0
  ) >= 1;
}

export async function GET(
  _request: NextRequest,
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
      acao: "acessar",
    });
    const admin = createAdminClient();
    const { id: alvoId } = await params;

    const { data: vinculo, error } = await admin
      .from("usuarios_empresas")
      .select("usuario_id, perfil, ativo")
      .eq("empresa_id", sessao.empresaId)
      .eq("usuario_id", alvoId)
      .maybeSingle();

    if (error) {
      return resposta({ ok: false, erro: error.message }, 500);
    }

    if (!vinculo) {
      return resposta({ ok: false, erro: "Recurso não encontrado." }, 404);
    }

    const perfil = String(vinculo.perfil ?? "").toLowerCase();
    const { data: linhas } = await admin
      .from("usuarios_permissoes_empresas")
      .select("modulo, permissoes")
      .eq("empresa_id", sessao.empresaId)
      .eq("usuario_id", alvoId);

    const permissoesLinhas = (linhas ?? []).map((linha) => ({
      modulo: String(linha.modulo ?? ""),
      permissoes:
        linha.permissoes && typeof linha.permissoes === "object"
          ? (linha.permissoes as Record<string, boolean>)
          : {},
    }));

    const efetivas = resolverPermissoesEfetivas({
      perfil,
      linhas: permissoesLinhas,
    });

    return resposta({
      ok: true,
      perfil,
      ativo: vinculo.ativo === true,
      permissoes: efetivas,
      origem: origemDasPermissoes({
        perfil,
        linhas: permissoesLinhas,
        efetivas,
      }),
    });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return resposta({ ok: false, erro: error.message }, error.status);
    }

    if (error instanceof ErroAdministracaoUsuarios) {
      return resposta({ ok: false, erro: error.message }, error.status);
    }

    return resposta(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro inesperado ao carregar permissões.",
      },
      500
    );
  }
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
    const usuarioAtualId = sessao.usuarioId;

    const {
      id: alvoId,
    } =
      await params;

    let body: {
      nome?: unknown;
      perfil?: unknown;
      ativo?: unknown;
      aplicar_preset?: unknown;
      permissoes?: unknown;
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

    const perfil =
      texto(
        body.perfil
      ).toLowerCase();

    const ativo =
      body.ativo ===
        true;

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
      !perfilUsuarioValido(
        perfil
      )
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Perfil inválido.",
        },
        422
      );
    }

    const {
      data: vinculoAtual,
      error:
        vinculoBuscaError,
    } =
      await admin
        .from(
          "usuarios_empresas"
        )
        .select(
          "usuario_id, perfil, ativo"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "usuario_id",
          alvoId
        )
        .maybeSingle();

    if (
      vinculoBuscaError
    ) {
      return resposta(
        {
          ok: false,
          erro:
            vinculoBuscaError.message,
        },
        500
      );
    }

    if (!vinculoAtual) {
      return resposta(
        {
          ok: false,
          erro: "Recurso não encontrado.",
        },
        404
      );
    }

    const aplicarPreset = body.aplicar_preset === true;
    const matrizRecebida = sanitizarMatrizRecebida(body.permissoes);

    if (aplicarPreset || matrizRecebida) {
      if (!temPermissao(sessao.permissoes, "usuarios", "alterar_permissoes")) {
        return resposta(
          {
            ok: false,
            erro: "Você não tem permissão para alterar permissões.",
          },
          403
        );
      }
    }

    if (ativo === false && vinculoAtual.ativo === true) {
      if (!temPermissao(sessao.permissoes, "usuarios", "desativar")) {
        return resposta(
          {
            ok: false,
            erro: "Você não tem permissão para desativar usuários.",
          },
          403
        );
      }
    }

    const alterandoProprioAcesso =
      alvoId ===
        usuarioAtualId &&
      (
        !ativo ||
        perfil !==
          String(
            vinculoAtual.perfil
          ).toLowerCase()
      );

    if (
      alterandoProprioAcesso
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Você não pode desativar o próprio acesso nem alterar o próprio perfil nesta tela.",
        },
        409
      );
    }

    const eraAdminAtivo =
      String(
        vinculoAtual.perfil
      ).toLowerCase() ===
        "administrador" &&
      vinculoAtual.ativo ===
        true;

    const deixaraDeSerAdminAtivo =
      eraAdminAtivo &&
      (
        perfil !==
          "administrador" ||
        !ativo
      );

    if (
      deixaraDeSerAdminAtivo
    ) {
      const temOutroAdmin =
        await podeRemoverAdministrador(
          admin,
          empresaId,
          alvoId
        );

      if (
        ultimoAdministradorFicariaIndefeso({
          eraAdminAtivo,
          novoPerfil: perfil,
          novoAtivo: ativo,
          outrosAdminsAtivos: temOutroAdmin ? 1 : 0,
        })
      ) {
        return resposta(
          {
            ok: false,
            erro:
              "A empresa precisa manter pelo menos um administrador ativo.",
          },
          409
        );
      }
    }

    const {
      error:
        usuarioUpdateError,
    } =
      await admin
        .from("usuarios")
        .update({
          nome,
        })
        .eq(
          "id",
          alvoId
        );

    if (
      usuarioUpdateError
    ) {
      return resposta(
        {
          ok: false,
          erro:
            usuarioUpdateError.message,
        },
        500
      );
    }

    const {
      error:
        vinculoUpdateError,
    } =
      await admin
        .from(
          "usuarios_empresas"
        )
        .update({
          perfil,
          ativo,
        })
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "usuario_id",
          alvoId
        );

    if (
      vinculoUpdateError
    ) {
      return resposta(
        {
          ok: false,
          erro:
            vinculoUpdateError.message,
        },
        500
      );
    }

    if (aplicarPreset) {
      await substituirPermissoesUsuarioEmpresa({
        admin,
        usuarioId: alvoId,
        empresaId,
        perfil,
      });
    } else if (matrizRecebida && perfil !== "administrador") {
      await substituirPermissoesUsuarioEmpresa({
        admin,
        usuarioId: alvoId,
        empresaId,
        perfil,
        matriz: matrizRecebida,
      });
    } else if (perfil === "administrador") {
      await substituirPermissoesUsuarioEmpresa({
        admin,
        usuarioId: alvoId,
        empresaId,
        perfil,
      });
    }

    // Mantém metadado de nome do Auth coerente.
    // Falha aqui não desfaz o vínculo comercial.
    await admin
      .auth.admin
      .updateUserById(
        alvoId,
        {
          user_metadata: {
            nome,
          },
        }
      );

    revalidatePath("/", "layout");
    revalidatePath("/configuracoes/usuarios");

    return resposta({
      ok: true,
      mensagem:
        "Usuário atualizado com sucesso.",
    });
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
            : "Erro inesperado ao atualizar usuário.",
      },
      500
    );
  }
}
