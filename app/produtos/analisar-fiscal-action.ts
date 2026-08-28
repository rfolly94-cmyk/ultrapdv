"use server";

import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { classificarProdutoFiscal } from "@/lib/fiscal/motor/classificar";
import type { ResultadoClassificacaoFiscal } from "@/lib/fiscal/motor/tipos";
import { createClient } from "@/lib/supabase/server";

export async function analisarProdutoFiscalAction(produtoId: string): Promise<
  | { ok: true; resultado: ResultadoClassificacaoFiscal }
  | { ok: false; erro: string }
> {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    return { ok: false, erro: "Faça login para analisar o fiscal." };
  }
  if (!temPermissao(sessao.permissoes, "fiscal", "acessar")) {
    return {
      ok: false,
      erro: "Você não possui permissão para analisar o fiscal deste produto.",
    };
  }
  if (!temPermissao(sessao.permissoes, "produtos", "acessar")) {
    return {
      ok: false,
      erro: "Você não possui permissão para ler este produto.",
    };
  }
  const id = String(produtoId ?? "").trim();
  if (!id) {
    return { ok: false, erro: "Produto não informado." };
  }
  const supabase = await createClient();
  const saida = await classificarProdutoFiscal({
    supabase,
    empresaId: sessao.empresaId,
    usuarioId: sessao.usuarioId,
    registrarAnalise: true,
    entrada: { produtoId: id },
  });
  if (!saida.ok) {
    return { ok: false, erro: saida.erro };
  }
  return { ok: true, resultado: saida.resultado };
}
