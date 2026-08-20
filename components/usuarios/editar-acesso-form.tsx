"use client";

import { useEffect, useState } from "react";

import {
  PERFIS_USUARIO,
  PERFIS_USUARIO_LABEL,
  type PerfilUsuario,
} from "@/lib/usuarios/perfis";
import { origemDasPermissoes } from "@/lib/permissoes/resolver";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import type { OrigemPermissao, PermissoesEfetivas } from "@/lib/permissoes/tipos";
import { MatrizPermissoes } from "@/components/usuarios/matriz-permissoes";
import type { UsuarioWorkspaceItem } from "@/components/usuarios/usuarios-workspace";

export function EditarAcessoForm({
  usuario,
  usuarioAtualId,
  processando,
  podeAlterarPermissoes,
  onCancelar,
  onSalvar,
}: {
  usuario: UsuarioWorkspaceItem;
  usuarioAtualId: string;
  processando: boolean;
  podeAlterarPermissoes: boolean;
  onCancelar: () => void;
  onSalvar: (payload: {
    nome: string;
    perfil: string;
    ativo: boolean;
    aplicarPreset: boolean;
    permissoes: PermissoesEfetivas | null;
  }) => void;
}) {
  const ehProprio = usuario.id === usuarioAtualId;
  const [nome, setNome] = useState(usuario.nome);
  const [perfil, setPerfil] = useState(usuario.perfil);
  const [ativo, setAtivo] = useState(usuario.ativo);
  const [permissoes, setPermissoes] = useState<PermissoesEfetivas>(
    presetDoPerfil(usuario.perfil)
  );
  const [origem, setOrigem] = useState<OrigemPermissao>("perfil_padrao");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aplicarPreset, setAplicarPreset] = useState(false);
  const perfilMudou = perfil !== usuario.perfil;

  useEffect(() => {
    let cancelado = false;

    async function carregar() {
      setCarregando(true);
      setErro(null);

      try {
        const response = await fetch(
          `/api/configuracoes/usuarios/${usuario.id}`
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          erro?: string;
          perfil?: string;
          permissoes?: PermissoesEfetivas;
          origem?: OrigemPermissao;
        };

        if (!response.ok || !payload.ok || !payload.permissoes) {
          throw new Error(payload.erro ?? "Não foi possível carregar as permissões.");
        }

        if (!cancelado) {
          setPermissoes(payload.permissoes);
          setOrigem(payload.origem ?? "perfil_padrao");
        }
      } catch (error) {
        if (!cancelado) {
          setErro(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar as permissões."
          );
        }
      } finally {
        if (!cancelado) {
          setCarregando(false);
        }
      }
    }

    void carregar();

    return () => {
      cancelado = true;
    };
  }, [usuario.id]);

  const admin = perfil === "administrador";

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSalvar({
          nome,
          perfil,
          ativo,
          aplicarPreset: perfilMudou ? aplicarPreset : false,
          permissoes:
            admin || (perfilMudou && aplicarPreset) ? null : permissoes,
        });
      }}
    >
      <label className="block text-sm font-medium text-zinc-700">
        Nome
        <input
          value={nome}
          onChange={(event) => setNome(event.target.value)}
          required
          className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm"
        />
      </label>

      <div>
        <p className="text-sm font-medium text-zinc-700">E-mail</p>
        <input
          value={usuario.email}
          disabled
          className="mt-2 w-full rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-2.5 text-sm text-zinc-500"
        />
      </div>

      <label className="block text-sm font-medium text-zinc-700">
        Perfil
        <select
          value={perfil}
          disabled={ehProprio}
          onChange={(event) => {
            const next = event.target.value;
            setPerfil(next);
            setAplicarPreset(true);
          }}
          className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm"
        >
          {PERFIS_USUARIO.map((item) => (
            <option key={item} value={item}>
              {PERFIS_USUARIO_LABEL[item as PerfilUsuario]}
            </option>
          ))}
        </select>
      </label>

      {perfilMudou && !ehProprio && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">Aplicar permissões padrão do novo perfil?</p>
          <div className="mt-3 grid gap-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={aplicarPreset}
                onChange={() => {
                  setAplicarPreset(true);
                  setPermissoes(presetDoPerfil(perfil));
                }}
              />
              Aplicar perfil padrão
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={!aplicarPreset}
                onChange={() => setAplicarPreset(false)}
              />
              Manter permissões personalizadas
            </label>
          </div>
        </div>
      )}

      <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4">
        <input
          type="checkbox"
          checked={ativo}
          disabled={ehProprio}
          onChange={(event) => setAtivo(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium text-zinc-900">
            Acesso ativo
          </span>
          <span className="mt-1 block text-xs text-zinc-500">
            Desmarcar bloqueia o vínculo deste usuário com esta empresa sem apagar o histórico.
          </span>
        </span>
      </label>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900">Permissões</h3>
          <span className="text-xs text-zinc-500">
            {origem === "administrador"
              ? "Acesso total do administrador"
              : origem === "personalizada"
                ? "Personalizada"
                : "Perfil padrão"}
            {origemDasPermissoes({ perfil, efetivas: permissoes }) ===
            "personalizada"
              ? perfilMudou
                ? ""
                : ""
              : ""}
          </span>
        </div>

        {admin ? (
          <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">
            Administrador tem acesso total a todos os módulos desta empresa.
          </p>
        ) : carregando ? (
          <p className="text-sm text-zinc-500">Carregando permissões...</p>
        ) : erro ? (
          <p className="text-sm text-red-600">{erro}</p>
        ) : (
          <MatrizPermissoes
            valor={perfilMudou && aplicarPreset ? presetDoPerfil(perfil) : permissoes}
            onChange={setPermissoes}
            somenteLeitura={!podeAlterarPermissoes || ehProprio}
          />
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-zinc-200 pt-5">
        <button
          type="button"
          disabled={processando}
          onClick={onCancelar}
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={processando || carregando}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          {processando ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}
