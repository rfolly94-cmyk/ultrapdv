import {
  redirect,
} from "next/navigation";

import {
  ErroAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";
import { createAdminClient } from "@/lib/supabase/admin";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

import {
  UsuariosWorkspace,
  type UsuarioWorkspaceItem,
} from "@/components/usuarios/usuarios-workspace";

export const metadata = {
  title: "Usuários",
};

function TelaAcessoNegado({
  mensagem,
}: {
  mensagem: string;
}) {
  return (
    <main className="min-h-screen bg-zinc-100 p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-amber-700">
            Usuários e acessos
          </p>

          <h1 className="mt-2 text-2xl font-bold text-zinc-950">
            Acesso não liberado
          </h1>

          <p className="mt-3 text-sm leading-6 text-zinc-600">
            {mensagem}
          </p>

          <a
            href="/painel"
            className="mt-6 inline-flex rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            Voltar ao painel
          </a>
        </div>
      </div>
    </main>
  );
}

export default async function
UsuariosPage() {
  let sessao:
    Awaited<
      ReturnType<
        typeof exigirPermissao
      >
    >;

  try {
    sessao = await exigirPermissao({
      modulo: "usuarios",
      acao: "acessar",
    });
  } catch (error) {
    if (
      error instanceof ErroPermissao ||
      error instanceof ErroAdministracaoUsuarios
    ) {
      if (error.status === 401) {
        redirect("/login");
      }

      return (
        <TelaAcessoNegado
          mensagem={error.message}
        />
      );
    }

    throw error;
  }

  const admin = createAdminClient();
  const empresaId = sessao.empresaId;
  const usuarioAtualId = sessao.usuarioId;

  const {
    data: vinculos,
    error: vinculosError,
  } =
    await admin
      .from(
        "usuarios_empresas"
      )
      .select(
        "usuario_id, perfil, principal, ativo, created_at"
      )
      .eq(
        "empresa_id",
        empresaId
      )
      .order(
        "created_at",
        {
          ascending:
            true,
        }
      );

  if (
    vinculosError
  ) {
    throw new Error(
      vinculosError.message
    );
  }

  const ids =
    Array.from(
      new Set(
        (
          vinculos ??
          []
        ).map(
          (item) =>
            String(
              item.usuario_id
            )
        )
      )
    );

  let usuarios:
    Array<{
      id: string;
      nome:
        | string
        | null;
      email:
        | string
        | null;
      ativo: boolean;
      created_at: string;
    }> = [];

  if (
    ids.length > 0
  ) {
    const {
      data,
      error,
    } =
      await admin
        .from(
          "usuarios"
        )
        .select(
          "id, nome, email, ativo, created_at"
        )
        .in(
          "id",
          ids
        );

    if (
      error
    ) {
      throw new Error(
        error.message
      );
    }

    usuarios =
      (
        data ??
        []
      ).map(
        (item) => ({
          id:
            String(
              item.id
            ),
          nome:
            item.nome,
          email:
            item.email,
          ativo:
            Boolean(
              item.ativo
            ),
          created_at:
            String(
              item.created_at
            ),
        })
      );
  }

  const porId =
    new Map(
      usuarios.map(
        (item) => [
          item.id,
          item,
        ]
      )
    );

  const itens:
    UsuarioWorkspaceItem[] =
      (
        vinculos ??
        []
      ).map(
        (vinculo) => {
          const usuario =
            porId.get(
              String(
                vinculo.usuario_id
              )
            );

          return {
            id:
              String(
                vinculo.usuario_id
              ),
            nome:
              usuario?.nome ??
              "Usuário",
            email:
              usuario?.email ??
              "",
            perfil:
              String(
                vinculo.perfil
              ),
            ativo:
              Boolean(
                vinculo.ativo
              ),
            principal:
              Boolean(
                vinculo.principal
              ),
            createdAt:
              String(
                vinculo.created_at
              ),
          };
        }
      )
      .sort(
        (a, b) =>
          a.nome.localeCompare(
            b.nome,
            "pt-BR"
          )
      );

  return (
    <UsuariosWorkspace
      usuarios={itens}
      usuarioAtualId={usuarioAtualId}
      podeCriar={temPermissao(sessao.permissoes, "usuarios", "criar")}
      podeEditar={temPermissao(sessao.permissoes, "usuarios", "editar")}
      podeAlterarPermissoes={temPermissao(
        sessao.permissoes,
        "usuarios",
        "alterar_permissoes"
      )}
    />
  );
}
