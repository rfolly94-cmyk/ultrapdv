"use server";

import { revalidatePath } from "next/cache";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import {
  exigirOperacaoPdv,
  resultadoNegacaoPdv,
} from "@/lib/pdv/acesso-operacao";
import { gravarPreferenciasPdvSessao } from "@/lib/pdv/preferencias-servidor";
import type { PreferenciasPdv } from "@/lib/pdv/preferencias";

export async function salvarPreferenciasPdvAction(input: PreferenciasPdv) {
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

  if (resultado.ok) {
    revalidatePath("/pdv");
  }

  return resultado;
}
