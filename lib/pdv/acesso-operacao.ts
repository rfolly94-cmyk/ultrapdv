import "server-only";

import { redirect } from "next/navigation";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  planoPermiteRecursoEmpresa,
  resultadoErroEntitlement,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoPdv(input: {
  empresaId: string;
  acao: AcaoDoModulo<"pdv">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "pdv",
    modulo: "pdv",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function exigirEdicaoPdv(input: {
  empresaId: string;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "pdv",
    modulo: "vendas",
    acao: "editar",
    origem: input.origem,
  });
}

export async function planoPdvPermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(identidade.empresaId, "pdv");

  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}

export function resultadoNegacaoPdv(error: unknown): {
  ok: false;
  erro: string;
  codigo?: "RECURSO_NAO_CONTRATADO";
} | null {
  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return entitlement;
  }
  if (error instanceof ErroPermissao) {
    return { ok: false, erro: error.message };
  }
  return null;
}
