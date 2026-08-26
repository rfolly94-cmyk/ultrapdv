"use server";

import { revalidatePath } from "next/cache";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import {
  exigirOperacaoPdv,
  resultadoNegacaoPdv,
} from "@/lib/pdv/acesso-operacao";
import { gravarPreferenciasPdvSessao } from "@/lib/pdv/preferencias-servidor";
import type { PreferenciasPdv } from "@/lib/pdv/preferencias";
import { gravarPermitirVendaSemEstoqueSessao } from "@/lib/pdv/venda-sem-estoque-servidor";

export type SalvarPreferenciasPdvInput = PreferenciasPdv & {
  permitirVendaSemEstoque: boolean;
};

export async function salvarPreferenciasPdvAction(
  input: SalvarPreferenciasPdvInput
) {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    return { ok: false as const, erro: "Não autenticado." };
  }

  try {
    await exigirOperacaoPdv({
      empresaId: identidade.empresaId,
      acao: "acessar",
      origem: "salvarPreferenciasPdvAction",
    });
  } catch (error) {
    const negacao = resultadoNegacaoPdv(error);
    if (negacao) {
      return negacao;
    }
    throw error;
  }

  const resultado = await gravarPreferenciasPdvSessao(input);
  if (!resultado.ok) {
    return resultado;
  }

  const estoque = await gravarPermitirVendaSemEstoqueSessao(
    input.permitirVendaSemEstoque === true
  );
  if (!estoque.ok) {
    return estoque;
  }

  revalidatePath("/pdv");

  return {
    ok: true as const,
    preferencias: resultado.preferencias,
    permitirVendaSemEstoque: estoque.permitirVendaSemEstoque,
  };
}
