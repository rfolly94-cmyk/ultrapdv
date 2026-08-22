import "server-only";

import { NextResponse } from "next/server";

import { ErroPermissao } from "@/lib/permissoes/erro";
import { respostaErroPermissao } from "@/lib/permissoes/exigir-permissao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  resultadoErroEntitlement,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoContabilidade(input: {
  empresaId: string;
  acao: AcaoDoModulo<"contabilidade">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "contabilidade",
    modulo: "contabilidade",
    acao: input.acao,
    origem: input.origem,
  });
}

export function respostaNegacaoContabilidade(error: unknown) {
  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return NextResponse.json(entitlement, { status: 403 });
  }
  if (error instanceof ErroPermissao) {
    return respostaErroPermissao(error);
  }
  return null;
}
