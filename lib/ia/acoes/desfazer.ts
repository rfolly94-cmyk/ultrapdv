import { persistirFiscalProdutoApi } from "@/lib/produtos/persistir-api";
import {
  persistirCamposBasicosProdutoApi,
  persistirEstoqueMinimoProdutoApi,
} from "@/lib/produtos/persistir-api";

import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import { registrarAuditoriaAcao } from "./auditoria";
import { carregarPropostaAcao } from "./carregar";
import { hashDaEntidade } from "./estado";
import { podeDesfazerTipo } from "./regras";
import { MENSAGEM_FALHA_APLICAR, MENSAGEM_STALE_ENTIDADE, MENSAGEM_SUCESSO_APLICAR } from "./tipos";

export async function desfazerAcaoIa(params: {
  ctx: ContextoFerramentaIa;
  propostaId: string;
}) {
  const carregada = await carregarPropostaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    propostaId: params.propostaId,
  });
  if (!carregada.ok) {
    return { ok: false as const, erro: carregada.erro };
  }
  const proposta = carregada.proposta;
  if (proposta.status !== "executada") {
    return { ok: false as const, erro: "Só é possível desfazer uma alteração já aplicada." };
  }
  if (!podeDesfazerTipo(proposta.tipo) || !proposta.entidadeId) {
    return { ok: false as const, erro: "Esta alteração não pode ser desfeita com segurança." };
  }

  const ids = Array.isArray(proposta.payload.campos.notificacaoIds)
    ? (proposta.payload.campos.notificacaoIds as unknown[]).map((id) => String(id))
    : undefined;
  const estado = await hashDaEntidade({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    tipo: proposta.tipo,
    entidadeTipo: proposta.entidadeTipo,
    entidadeId: proposta.entidadeId,
    ids,
  });
  if (!estado) {
    return { ok: false as const, erro: "Registro não encontrado nesta empresa." };
  }
  const hashDepois = String(proposta.resultado.hashDepois ?? "");
  if (hashDepois && estado.hash !== hashDepois) {
    return { ok: false as const, erro: MENSAGEM_STALE_ENTIDADE };
  }

  const antes = proposta.payload.antes;
  if (proposta.tipo === "atualizacao_fiscal_produto" || proposta.tipo === "atribuicao_grupo_fiscal") {
    const gravado = await persistirFiscalProdutoApi({
      supabase: params.ctx.supabase,
      empresaId: params.ctx.empresaId,
      produtoId: proposta.entidadeId,
      ncm: String(antes.ncm ?? antes.ncm ?? ""),
      cest: String(antes.cest ?? ""),
      origemProduto: String(antes.origemProduto ?? antes.origem_produto ?? "0"),
      grupoFiscalId: antes.grupoFiscalId
        ? String(antes.grupoFiscalId)
        : antes.grupo_fiscal_id
          ? String(antes.grupo_fiscal_id)
          : null,
    });
    if (!gravado.ok) {
      return { ok: false as const, erro: gravado.erro };
    }
  } else if (proposta.tipo === "atualizacao_basica_produto") {
    if (proposta.payload.campos.alterarDescricao || proposta.payload.campos.alterarCategoria) {
      const gravado = await persistirCamposBasicosProdutoApi({
        supabase: params.ctx.supabase,
        empresaId: params.ctx.empresaId,
        produtoId: proposta.entidadeId,
        descricao: antes.descricao == null ? null : String(antes.descricao),
        categoriaId: antes.categoriaId == null ? null : String(antes.categoriaId),
        alterarDescricao: Boolean(proposta.payload.campos.alterarDescricao),
        alterarCategoria: Boolean(proposta.payload.campos.alterarCategoria),
      });
      if (!gravado.ok) {
        return { ok: false as const, erro: gravado.erro };
      }
    }
    if (proposta.payload.campos.alterarEstoqueMinimo) {
      const gravado = await persistirEstoqueMinimoProdutoApi({
        supabase: params.ctx.supabase,
        empresaId: params.ctx.empresaId,
        produtoId: proposta.entidadeId,
        estoqueMinimo: Number(antes.estoqueMinimo ?? 0),
      });
      if (!gravado.ok) {
        return { ok: false as const, erro: gravado.erro };
      }
    }
  } else {
    return { ok: false as const, erro: "Esta alteração não pode ser desfeita com segurança." };
  }

  await registrarAuditoriaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    conversaId: proposta.conversaId,
    propostaId: proposta.id,
    entidade: "desfazer",
    entidadeId: proposta.entidadeId,
    tipoAcao: "desfazer",
    valoresAnteriores: proposta.payload.depois,
    valoresNovos: antes,
    sugestao: { desfazerDe: proposta.id },
    resultado: "ok",
  });

  return {
    ok: true as const,
    mensagem: MENSAGEM_SUCESSO_APLICAR,
    conversaId: proposta.conversaId,
  };
}
