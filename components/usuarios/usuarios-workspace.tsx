"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  PERFIS_USUARIO,
  PERFIS_USUARIO_LABEL,
  type PerfilUsuario,
} from "@/lib/usuarios/perfis";
import { ConfiguracoesModuleTabs } from "@/components/configuracoes/configuracoes-module-tabs";
import { EditarAcessoForm } from "@/components/usuarios/editar-acesso-form";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";

export type UsuarioWorkspaceItem = {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  ativo: boolean;
  principal: boolean;
  createdAt: string;
};

type Props = {
  usuarios:
    UsuarioWorkspaceItem[];
  usuarioAtualId: string;
  podeCriar?: boolean;
  podeEditar?: boolean;
  podeAlterarPermissoes?: boolean;
};

type ModoModal =
  | {
      tipo: "novo";
    }
  | {
      tipo: "editar";
      usuario:
        UsuarioWorkspaceItem;
    }
  | {
      tipo: "senha";
      usuario:
        UsuarioWorkspaceItem;
    }
  | null;

function rotuloPerfil(
  perfil: string
) {
  return (
    PERFIS_USUARIO_LABEL[
      perfil as PerfilUsuario
    ] ??
    perfil
  );
}

function dataCurta(
  valor: string
) {
  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle:
        "short",
    }
  ).format(data);
}

export function UsuariosWorkspace({
  usuarios,
  usuarioAtualId,
  podeCriar = false,
  podeEditar = false,
  podeAlterarPermissoes = false,
}: Props) {
  const router =
    useRouter();

  const [
    modal,
    setModal,
  ] =
    useState<ModoModal>(
      null
    );

  const [
    processando,
    setProcessando,
  ] =
    useState(false);

  const [
    mensagem,
    setMensagem,
  ] =
    useState<{
      tipo:
        | "sucesso"
        | "erro";
      texto: string;
    } | null>(
      null
    );

  const ativos =
    useMemo(
      () =>
        usuarios.filter(
          (item) =>
            item.ativo
        ).length,
      [usuarios]
    );

  const admins =
    useMemo(
      () =>
        usuarios.filter(
          (item) =>
            item.ativo &&
            item.perfil ===
              "administrador"
        ).length,
      [usuarios]
    );

  function sucesso(
    texto: string
  ) {
    setMensagem({
      tipo:
        "sucesso",
      texto,
    });
  }

  function erro(
    texto: string
  ) {
    setMensagem({
      tipo:
        "erro",
      texto,
    });
  }

  async function lerResposta(
    response: Response
  ) {
    const payload =
      await response.json()
        .catch(
          () => ({})
        ) as {
          ok?: boolean;
          erro?: string;
          mensagem?: string;
        };

    if (
      !response.ok ||
      !payload.ok
    ) {
      throw new Error(
        payload.erro ??
        "A operação não pôde ser concluída."
      );
    }

    return payload;
  }

  async function criarUsuario(
    formData: FormData
  ) {
    setProcessando(
      true
    );
    setMensagem(
      null
    );

    try {
      const response =
        await fetch(
          "/api/configuracoes/usuarios",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                nome:
                  formData.get(
                    "nome"
                  ),
                email:
                  formData.get(
                    "email"
                  ),
                senha:
                  formData.get(
                    "senha"
                  ),
                perfil:
                  formData.get(
                    "perfil"
                  ),
              }),
          }
        );

      const payload =
        await lerResposta(
          response
        );

      setModal(null);
      sucesso(
        payload.mensagem ??
          "Usuário criado com sucesso."
      );
      router.refresh();
    } catch (error) {
      erro(
        error instanceof Error
          ? error.message
          : "Erro ao criar usuário."
      );
    } finally {
      setProcessando(
        false
      );
    }
  }

  async function editarUsuario(
    usuario: UsuarioWorkspaceItem,
    payload: {
      nome: string;
      perfil: string;
      ativo: boolean;
      aplicarPreset: boolean;
      permissoes: import("@/lib/permissoes/tipos").PermissoesEfetivas | null;
    }
  ) {
    setProcessando(true);
    setMensagem(null);

    try {
      const response = await fetch(
        `/api/configuracoes/usuarios/${usuario.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nome: payload.nome,
            perfil: payload.perfil,
            ativo: payload.ativo,
            aplicar_preset: payload.aplicarPreset,
            permissoes: payload.permissoes,
          }),
        }
      );

      const resposta = await lerResposta(response);
      setModal(null);
      sucesso(resposta.mensagem ?? "Usuário atualizado com sucesso.");
      router.refresh();
    } catch (error) {
      erro(
        error instanceof Error
          ? error.message
          : "Erro ao atualizar usuário."
      );
    } finally {
      setProcessando(false);
    }
  }

  async function redefinirSenha(
    usuario:
      UsuarioWorkspaceItem,
    formData:
      FormData
  ) {
    setProcessando(
      true
    );
    setMensagem(
      null
    );

    try {
      const senha =
        String(
          formData.get(
            "senha"
          ) ?? ""
        );

      const confirmar =
        String(
          formData.get(
            "confirmar_senha"
          ) ?? ""
        );

      if (
        senha !==
        confirmar
      ) {
        throw new Error(
          "As senhas não coincidem."
        );
      }

      const response =
        await fetch(
          `/api/configuracoes/usuarios/${usuario.id}/senha`,
          {
            method:
              "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                senha,
              }),
          }
        );

      const payload =
        await lerResposta(
          response
        );

      setModal(null);
      sucesso(
        payload.mensagem ??
          "Senha redefinida com sucesso."
      );
    } catch (error) {
      erro(
        error instanceof Error
          ? error.message
          : "Erro ao redefinir senha."
      );
    } finally {
      setProcessando(
        false
      );
    }
  }

  return (
    <main className="updv-page">
      <PageHeader
        title="Usuários"
        count={usuarios.length}
        description="Vínculos, perfis e acesso da empresa."
        breadcrumb={[
          { label: "Configurações", href: "/configuracoes" },
          { label: "Usuários" },
        ]}
        actions={
          podeCriar ? (
            <button
              type="button"
              onClick={() => {
                setMensagem(null);
                setModal({ tipo: "novo" });
              }}
              className="updv-btn updv-btn-primary"
            >
              Novo usuário
            </button>
          ) : null
        }
      />
      <ConfiguracoesModuleTabs />
      <div className="flex min-h-0 flex-1 flex-col">

        {mensagem && (
          <div
            className={[
              "mx-4 mt-3 rounded border px-3 py-2 text-[13px]",
              mensagem.tipo === "sucesso"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            ].join(" ")}
          >
            {mensagem.texto}
          </div>
        )}

        <p className="px-4 py-2.5 text-[13px] text-zinc-500">
          {ativos} ativos · {admins} administradores
        </p>

        <DataTable minWidth={800}>
          <thead>
            <tr>
              <th>Ações</th>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Perfil</th>
              <th>Status</th>
              <th>Cadastro</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((usuario) => (
              <tr key={usuario.id}>
                <td>
                  <RowActions
                    onEdit={
                      podeEditar
                        ? () => {
                            setMensagem(null);
                            setModal({ tipo: "editar", usuario });
                          }
                        : undefined
                    }
                    editLabel="Editar acesso"
                    items={[
                      {
                        label: "Redefinir senha",
                        onClick: () => {
                          setMensagem(null);
                          setModal({ tipo: "senha", usuario });
                        },
                      },
                    ]}
                  />
                </td>
                <td className="font-medium">
                  {usuario.nome}
                  {usuario.id === usuarioAtualId ? (
                    <span className="ml-2 text-[11px] text-blue-600">Você</span>
                  ) : null}
                </td>
                <td>{usuario.email}</td>
                <td>{rotuloPerfil(usuario.perfil)}</td>
                <td>
                  <StatusBadge status={usuario.ativo ? "ativo" : "inativo"} />
                </td>
                <td>{dataCurta(usuario.createdAt)}</td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <DataTableEmpty colSpan={6}>
                Nenhum usuário cadastrado.
              </DataTableEmpty>
            )}
          </tbody>
        </DataTable>
      </div>

      {modal?.tipo ===
        "novo" && (
        <Modal
          titulo="Novo usuário"
          onClose={() =>
            !processando &&
            setModal(null)
          }
        >
          <form
            action={
              criarUsuario
            }
            className="space-y-4"
          >
            <Campo
              label="Nome"
              name="nome"
              required
            />

            <Campo
              label="E-mail"
              name="email"
              type="email"
              required
              autoComplete="off"
            />

            <Campo
              label="Senha provisória"
              name="senha"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />

            <PerfilSelect
              defaultValue="vendedor"
            />

            <p className="rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-500">
              O e-mail será confirmado no cadastro administrativo, então o funcionário poderá entrar imediatamente com a senha provisória.
            </p>

            <BotoesModal
              processando={
                processando
              }
              textoSalvar="Criar usuário"
              onCancelar={() =>
                setModal(
                  null
                )
              }
            />
          </form>
        </Modal>
      )}

      {modal?.tipo ===
        "editar" && (
        <Modal
          titulo="Editar acesso"
          largo
          onClose={() =>
            !processando &&
            setModal(null)
          }
        >
          <EditarAcessoForm
            usuario={modal.usuario}
            usuarioAtualId={usuarioAtualId}
            processando={processando}
            podeAlterarPermissoes={podeAlterarPermissoes}
            onCancelar={() => setModal(null)}
            onSalvar={(payload) =>
              editarUsuario(modal.usuario, payload)
            }
          />
        </Modal>
      )}

      {modal?.tipo ===
        "senha" && (
        <Modal
          titulo="Redefinir senha"
          onClose={() =>
            !processando &&
            setModal(null)
          }
        >
          <form
            action={(
              formData
            ) =>
              redefinirSenha(
                modal.usuario,
                formData
              )
            }
            className="space-y-4"
          >
            <div className="rounded-xl bg-zinc-50 p-4">
              <p className="font-medium text-zinc-900">
                {
                  modal.usuario
                    .nome
                }
              </p>

              <p className="mt-1 text-sm text-zinc-500">
                {
                  modal.usuario
                    .email
                }
              </p>
            </div>

            <Campo
              label="Nova senha"
              name="senha"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />

            <Campo
              label="Confirmar nova senha"
              name="confirmar_senha"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />

            <BotoesModal
              processando={
                processando
              }
              textoSalvar="Redefinir senha"
              onCancelar={() =>
                setModal(
                  null
                )
              }
            />
          </form>
        </Modal>
      )}
    </main>
  );
}

function Modal({
  titulo,
  children,
  onClose,
  largo = false,
}: {
  titulo: string;
  children:
    React.ReactNode;
  onClose: () => void;
  largo?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={
          onClose
        }
        className="absolute inset-0 bg-black/40"
      />

      <div className={`relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ${largo ? "max-w-4xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-zinc-950">
            {titulo}
          </h2>

          <button
            type="button"
            onClick={
              onClose
            }
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Fechar
          </button>
        </div>

        <div className="mt-5">
          {children}
        </div>
      </div>
    </div>
  );
}

function Label({
  children,
}: {
  children:
    React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-zinc-700">
      {children}
    </label>
  );
}

function Campo({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  minLength,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  return (
    <div>
      <Label>
        {label}
      </Label>

      <input
        name={name}
        type={type}
        defaultValue={
          defaultValue
        }
        required={
          required
        }
        minLength={
          minLength
        }
        autoComplete={
          autoComplete
        }
        className={
          inputClass
        }
      />
    </div>
  );
}

function PerfilSelect({
  defaultValue,
  disabled = false,
}: {
  defaultValue:
    string;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label>
        Perfil
      </Label>

      <select
        name="perfil"
        defaultValue={
          defaultValue
        }
        disabled={
          disabled
        }
        className={
          inputClass
        }
      >
        {PERFIS_USUARIO.map(
          (perfil) => (
            <option
              key={
                perfil
              }
              value={
                perfil
              }
            >
              {
                PERFIS_USUARIO_LABEL[
                  perfil
                ]
              }
            </option>
          )
        )}
      </select>

      {disabled && (
        <input
          type="hidden"
          name="perfil"
          value={
            defaultValue
          }
        />
      )}
    </div>
  );
}

function BotoesModal({
  processando,
  textoSalvar,
  onCancelar,
}: {
  processando:
    boolean;
  textoSalvar:
    string;
  onCancelar:
    () => void;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-zinc-200 pt-5">
      <button
        type="button"
        disabled={
          processando
        }
        onClick={
          onCancelar
        }
        className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        Cancelar
      </button>

      <button
        type="submit"
        disabled={
          processando
        }
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {processando
          ? "Salvando..."
          : textoSalvar}
      </button>
    </div>
  );
}

const inputClass =
  "mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-zinc-100";
