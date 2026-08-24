import "server-only";

import { redirect } from "next/navigation";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import {
  exigirAcessoOperacao,
  planoPermiteRecursoEmpresa,
} from "@/lib/plataforma/entitlements/exigir-recurso";

export async function exigirOperacaoCaixa(input: {
  empresaId: string;
  acao: AcaoDoModulo<"caixa">;
  origem: string;
}) {
  return exigirAcessoOperacao({
    empresaId: input.empresaId,
    recurso: "caixa",
    modulo: "caixa",
    acao: input.acao,
    origem: input.origem,
  });
}

export async function planoCaixaPermitidoNaSessao() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    redirect("/login");
  }

  const plano = await planoPermiteRecursoEmpresa(
    identidade.empresaId,
    "caixa"
  );

  return {
    empresaId: identidade.empresaId,
    permitido: plano.permitido,
  };
}
