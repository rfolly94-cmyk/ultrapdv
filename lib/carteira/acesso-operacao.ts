import "server-only";

import { NextResponse } from "next/server";

import { ErroPermissao } from "@/lib/permissoes/erro";
import { respostaErroPermissao } from "@/lib/permissoes/exigir-permissao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  resultadoErroEntitlement,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoCarteira(input: {
  empresaId: string;
  acao: AcaoDoModulo<"clientes">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "carteira",
    modulo: "clientes",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function exigirCancelamentoItensCarteira(input: {
  empresaId: string;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "carteira",
    modulo: "vendas",
    acao: "cancelar",
    origem: input.origem,
  });
}

export function respostaNegacaoCarteira(error: unknown) {
  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return NextResponse.json(entitlement, { status: 403 });
  }
  if (error instanceof ErroPermissao) {
    return respostaErroPermissao(error);
  }
  return null;
}
