import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { respostaErroPermissao } from "@/lib/permissoes/exigir-permissao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  planoPermiteRecursoEmpresa,
  resultadoErroEntitlement,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoVenda(input: {
  empresaId: string;
  acao: AcaoDoModulo<"vendas">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "vendas",
    modulo: "vendas",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function planoVendasPermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(
    identidade.empresaId,
    "vendas"
  );

  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}

export function respostaNegacaoVenda(error: unknown) {
  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return NextResponse.json(entitlement, { status: 403 });
  }
  if (error instanceof ErroPermissao) {
    return respostaErroPermissao(error);
  }
  return null;
}
