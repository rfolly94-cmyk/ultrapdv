import "server-only";

import { redirect } from "next/navigation";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  planoPermiteRecursoEmpresa,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoEstoque(input: {
  empresaId: string;
  acao: AcaoDoModulo<"estoque">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "estoque",
    modulo: "estoque",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function planoEstoquePermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(
    identidade.empresaId,
    "estoque"
  );

  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}
