import "server-only";

import { cache } from "react";

import { carregarEstadoAcessoSessao } from "@/lib/auth/carregar-estado-acesso";
import {
  acessoOperacionalDesativado,
  type EstadoAcessoSessao,
} from "@/lib/auth/estado-acesso";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

import {
  carregarPermissoesDoVinculo,
  type SessaoPermissoes,
} from "./carregar";

export type { SessaoPermissoes };

export { carregarPermissoesDoVinculo };

export type DiagnosticoSessao =
  | { tipo: "nao_autenticado"; sessao: null; estado: null }
  | { tipo: "acesso_desativado"; sessao: null; estado: EstadoAcessoSessao }
  | { tipo: "sem_empresa"; sessao: null; estado: EstadoAcessoSessao }
  | { tipo: "ok"; sessao: SessaoPermissoes; estado: EstadoAcessoSessao };

export const obterDiagnosticoSessao = cache(
  async (): Promise<DiagnosticoSessao> => {
    const supabase = await createClient();
    const { data: claimsData, error } = await obterClaimsSessao(supabase);
    const usuarioId = claimsData?.claims?.sub;

    if (error || !usuarioId) {
      return { tipo: "nao_autenticado", sessao: null, estado: null };
    }

    const estado = await carregarEstadoAcessoSessao(
      supabase,
      String(usuarioId)
    );

    if (acessoOperacionalDesativado(estado)) {
      return { tipo: "acesso_desativado", sessao: null, estado };
    }

    if (!estado.temVinculoOperacional || !estado.empresaId) {
      return { tipo: "sem_empresa", sessao: null, estado };
    }

    const sessao = await carregarPermissoesDoVinculo({
      supabase,
      usuarioId: String(usuarioId),
      empresaId: estado.empresaId,
      perfil: String(estado.perfil ?? ""),
    });

    return { tipo: "ok", sessao, estado };
  }
);

export const obterPermissoesSessao = cache(async (): Promise<SessaoPermissoes | null> => {
  const diagnostico = await obterDiagnosticoSessao();
  return diagnostico.sessao;
});
