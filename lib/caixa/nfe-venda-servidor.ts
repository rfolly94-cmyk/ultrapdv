import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { controleCaixaAtivo } from "@/lib/caixa/controle-servidor";
import { recusarInicioVendaNfeSemCaixa } from "@/lib/caixa/nfe-venda";
import { buscarCaixaAbertoEmpresa } from "@/lib/caixa/sessao-aberta";

/**
 * Guard de início da NF-e de venda nova: Caixa da empresa ativa, nunca
 * `empresa_id` vindo do browser. Reusa `nfeVendaNovaExigeCaixa` + sessão aberta.
 */
export async function recusarNovaVendaNfeSemCaixaAberto(params: {
  supabase: SupabaseClient;
  empresaId: string;
  tipoOperacaoInterno?: string | null;
  vinculaVenda?: boolean | null;
  vendaId?: string | null;
}): Promise<{ ok: false; erro: string } | null> {
  const tipo = String(params.tipoOperacaoInterno ?? "").trim();
  let vinculaVenda = params.vinculaVenda;
  if (vinculaVenda == null && tipo) {
    const { data } = await params.supabase
      .from("fiscal_tipos_operacao")
      .select("codigo, vincula_venda")
      .eq("codigo", tipo)
      .maybeSingle();
    vinculaVenda = data?.vincula_venda === true;
  }

  const [controleAtivo, caixaAberto] = await Promise.all([
    controleCaixaAtivo(params.supabase, params.empresaId),
    buscarCaixaAbertoEmpresa(params.supabase, params.empresaId),
  ]);

  const erro = recusarInicioVendaNfeSemCaixa({
    tipoOperacaoInterno: tipo,
    vinculaVenda: vinculaVenda === true,
    vendaId: params.vendaId,
    controleAtivo,
    caixaAberto: caixaAberto !== null,
  });
  if (!erro) {
    return null;
  }
  return { ok: false, erro };
}
