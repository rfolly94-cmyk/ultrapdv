import "server-only";

import { redirect } from "next/navigation";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  planoPermiteRecursoEmpresa,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoProduto(input: {
  empresaId: string;
  acao: AcaoDoModulo<"produtos">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "produtos",
    modulo: "produtos",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function planoProdutosPermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(
    identidade.empresaId,
    "produtos"
  );

  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}
