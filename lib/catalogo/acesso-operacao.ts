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
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";

export async function exigirOperacaoCatalogo(input: {
  empresaId: string;
  acao: AcaoDoModulo<"catalogo">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "catalogo",
    modulo: "catalogo",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function planoCatalogoPermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(
    identidade.empresaId,
    "catalogo"
  );

  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}

export function resultadoNegacaoCatalogo(error: unknown): {
  ok: false;
  erro: string;
  codigo?: "RECURSO_NAO_CONTRATADO";
} | null {
  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return entitlement;
  }
  if (error instanceof ErroPermissao) {
    if (error.status === 401) {
      redirect("/login");
    }
    return { ok: false, erro: error.message };
  }
  if (error instanceof ErroEntitlement) {
    return {
      ok: false,
      erro: error.message,
      codigo: "RECURSO_NAO_CONTRATADO",
    };
  }
  return null;
}
