import "server-only";

import { redirect } from "next/navigation";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  planoPermiteRecursoEmpresa,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoCliente(input: {
  empresaId: string;
  acao: AcaoDoModulo<"clientes">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "clientes",
    modulo: "clientes",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function planoClientesPermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(
    identidade.empresaId,
    "clientes"
  );

  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}
