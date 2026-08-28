import {
  persistirCamposBasicosProdutoApi,
  persistirEstoqueMinimoProdutoApi,
} from "@/lib/produtos/persistir-api";

import type { ContextoFerramentaIa } from "../../ferramentas/contexto";
import { autorizarFerramentaIa } from "../../permissoes";
import { registrarAuditoriaAcao } from "../auditoria";
import {
  MENSAGEM_FALHA_APLICAR,
  MENSAGEM_IA_SEM_PERMISSAO_ALTERAR,
  MENSAGEM_SUCESSO_APLICAR,
  type PropostaAcaoPersistida,
  type ResultadoExecucaoAcao,
} from "../tipos";

export async function aplicarAtualizacaoBasicaProduto(params: {
  ctx: ContextoFerramentaIa;
  proposta: PropostaAcaoPersistida;
}): Promise<ResultadoExecucaoAcao> {
  const produtoId = params.proposta.entidadeId;
  if (!produtoId) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: "Produto ausente." };
  }
  const campos = params.proposta.payload.campos;
  const alterarDescricao = Boolean(campos.alterarDescricao);
  const alterarCategoria = Boolean(campos.alterarCategoria);
  const alterarMinimo = Boolean(campos.alterarEstoqueMinimo);

  if (alterarDescricao || alterarCategoria) {
    const auth = await autorizarFerramentaIa({
      empresaId: params.ctx.empresaId,
      permissoes: params.ctx.permissoes,
      recurso: "produtos",
      acao: "editar",
      mensagem: MENSAGEM_IA_SEM_PERMISSAO_ALTERAR,
    });
    if (!auth.ok) {
      return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: auth.erro };
    }
    const gravado = await persistirCamposBasicosProdutoApi({
      supabase: params.ctx.supabase,
      empresaId: params.ctx.empresaId,
      produtoId,
      descricao: campos.descricao == null ? null : String(campos.descricao),
      categoriaId: campos.categoriaId == null ? null : String(campos.categoriaId),
      alterarDescricao,
      alterarCategoria,
    });
    if (!gravado.ok) {
      return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: gravado.erro };
    }
  }

  if (alterarMinimo) {
    const authEstoque = await autorizarFerramentaIa({
      empresaId: params.ctx.empresaId,
      permissoes: params.ctx.permissoes,
      recurso: "estoque",
      acao: "ajustar",
      mensagem: MENSAGEM_IA_SEM_PERMISSAO_ALTERAR,
    });
    if (!authEstoque.ok) {
      return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: authEstoque.erro };
    }
    const minimo = Number(campos.estoqueMinimo);
    const gravado = await persistirEstoqueMinimoProdutoApi({
      supabase: params.ctx.supabase,
      empresaId: params.ctx.empresaId,
      produtoId,
      estoqueMinimo: minimo,
    });
    if (!gravado.ok) {
      return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: gravado.erro };
    }
  }

  const depois = {
    descricao: alterarDescricao ? campos.descricao ?? null : params.proposta.payload.antes.descricao,
    categoriaId: alterarCategoria
      ? campos.categoriaId ?? null
      : params.proposta.payload.antes.categoriaId,
    estoqueMinimo: alterarMinimo
      ? campos.estoqueMinimo ?? null
      : params.proposta.payload.antes.estoqueMinimo,
  };
  await registrarAuditoriaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    conversaId: params.proposta.conversaId,
    propostaId: params.proposta.id,
    entidade: "produto",
    entidadeId: produtoId,
    tipoAcao: params.proposta.tipo,
    valoresAnteriores: params.proposta.payload.antes,
    valoresNovos: depois,
    resultado: "ok",
  });
  return {
    ok: true,
    mensagem: MENSAGEM_SUCESSO_APLICAR,
    entidadeId: produtoId,
    depois,
    podeDesfazer: true,
  };
}
