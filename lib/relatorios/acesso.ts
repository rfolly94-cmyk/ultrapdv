import "server-only";

import { NextResponse } from "next/server";

import { ErroPermissao } from "@/lib/permissoes/erro";
import { respostaErroPermissao } from "@/lib/permissoes/exigir-permissao";
import {
  exigirAcessoOperacao,
  resultadoErroEntitlement,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoRelatorio(input: {
  empresaId: string;
  acao: "acessar" | "exportar";
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "relatorios",
    modulo: "relatorios",
    acao: input.acao,
    origem: input.origem,
  });
}

export function respostaNegacaoRelatorio(error: unknown) {
  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return NextResponse.json(entitlement, { status: 403 });
  }
  if (error instanceof ErroPermissao) {
    return respostaErroPermissao(error);
  }
  return null;
}
