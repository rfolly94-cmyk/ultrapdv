import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import {
  CODIGO_ACESSO_DESATIVADO,
  MENSAGEM_ACESSO_DESATIVADO,
} from "@/lib/auth/mensagens-acesso";

import { ErroPermissao, MENSAGEM_SEM_PERMISSAO } from "./erro";
import { obterDiagnosticoSessao, type SessaoPermissoes } from "./sessao";
import { acaoExisteNoModulo, temPermissao } from "./tem-permissao";
import type { AcaoDoModulo, ModuloPermissao } from "./tipos";

export async function exigirPermissao<M extends ModuloPermissao>(input: {
  modulo: M;
  acao: AcaoDoModulo<M>;
}): Promise<SessaoPermissoes> {
  const diagnostico = await obterDiagnosticoSessao();

  if (diagnostico.tipo === "nao_autenticado") {
    throw new ErroPermissao("Não autenticado.", 401);
  }

  if (diagnostico.tipo === "acesso_desativado") {
    throw new ErroPermissao(
      MENSAGEM_ACESSO_DESATIVADO,
      403,
      CODIGO_ACESSO_DESATIVADO
    );
  }

  if (diagnostico.tipo !== "ok" || !diagnostico.sessao) {
    throw new ErroPermissao("Não autenticado.", 401);
  }

  const sessao = diagnostico.sessao;

  if (!acaoExisteNoModulo(input.modulo, String(input.acao))) {
    throw new ErroPermissao(MENSAGEM_SEM_PERMISSAO, 403);
  }

  if (!temPermissao(sessao.permissoes, input.modulo, input.acao)) {
    throw new ErroPermissao(MENSAGEM_SEM_PERMISSAO, 403);
  }

  return sessao;
}

export async function exigirPermissaoOuRedirecionar<M extends ModuloPermissao>(input: {
  modulo: M;
  acao: AcaoDoModulo<M>;
}) {
  try {
    return await exigirPermissao(input);
  } catch (error) {
    if (error instanceof ErroPermissao && error.status === 401) {
      redirect("/login");
    }

    if (
      error instanceof ErroPermissao &&
      error.codigo === CODIGO_ACESSO_DESATIVADO
    ) {
      redirect("/acesso-desativado");
    }

    redirect("/acesso-negado");
  }
}

export async function exigirPermissaoNaAction<M extends ModuloPermissao>(input: {
  modulo: M;
  acao: AcaoDoModulo<M>;
}): Promise<SessaoPermissoes | { ok: false; erro: string }> {
  try {
    return await exigirPermissao(input);
  } catch (error) {
    if (error instanceof ErroPermissao) {
      if (error.status === 401) {
        redirect("/login");
      }

      if (error.codigo === CODIGO_ACESSO_DESATIVADO) {
        redirect("/acesso-desativado");
      }

      return { ok: false, erro: error.message };
    }

    throw error;
  }
}

export function respostaErroPermissao(error: unknown) {
  if (!(error instanceof ErroPermissao)) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      erro: error.message,
      ...(error.codigo ? { codigo: error.codigo } : {}),
    },
    { status: error.status }
  );
}
