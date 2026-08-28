import { persistirFiscalProdutoApi } from "@/lib/produtos/persistir-api";
import { criarGrupoFiscalApi, type DadosGrupoFiscalApi } from "@/lib/produtos/persistir-grupo-fiscal";

import type { ContextoFerramentaIa } from "../../ferramentas/contexto";
import { autorizarFerramentaIa } from "../../permissoes";
import { registrarAuditoriaAcao } from "../auditoria";
import { hashProdutoFiscal } from "../estado";
import {
  MENSAGEM_FALHA_APLICAR,
  MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  MENSAGEM_SUCESSO_APLICAR,
  type PropostaAcaoPersistida,
  type ResultadoExecucaoAcao,
} from "../tipos";

export async function aplicarAtribuicaoGrupoFiscal(params: {
  ctx: ContextoFerramentaIa;
  proposta: PropostaAcaoPersistida;
}): Promise<ResultadoExecucaoAcao> {
  const auth = await autorizarFerramentaIa({
    empresaId: params.ctx.empresaId,
    permissoes: params.ctx.permissoes,
    recurso: "produtos",
    acao: "editar",
    mensagem: MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  });
  if (!auth.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: auth.erro };
  }
  const produtoId = params.proposta.entidadeId;
  const grupoFiscalId = String(params.proposta.payload.campos.grupoFiscalId ?? "").trim();
  if (!produtoId || !grupoFiscalId) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: "Produto ou grupo ausente." };
  }

  const { data: grupo } = await params.ctx.supabase
    .from("grupos_fiscais")
    .select("id, empresa_id, nome, ativo")
    .eq("empresa_id", params.ctx.empresaId)
    .eq("id", grupoFiscalId)
    .maybeSingle();
  if (!grupo || String(grupo.empresa_id) !== params.ctx.empresaId || !grupo.ativo) {
    return {
      ok: false,
      mensagem: MENSAGEM_FALHA_APLICAR,
      erro: "Grupo fiscal inválido ou de outra empresa.",
    };
  }

  const snap = await hashProdutoFiscal({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    produtoId,
  });
  if (!snap) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: "Produto não encontrado nesta empresa." };
  }

  const gravado = await persistirFiscalProdutoApi({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    produtoId,
    ncm: String(snap.campos.ncm ?? ""),
    cest: String(snap.campos.cest ?? ""),
    origemProduto: String(snap.campos.origem_produto ?? "0"),
    grupoFiscalId,
  });
  if (!gravado.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: gravado.erro };
  }

  const depois = { grupoFiscalId, grupoNome: String(grupo.nome) };
  await registrarAuditoriaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    conversaId: params.proposta.conversaId,
    propostaId: params.proposta.id,
    entidade: "produto_fiscal",
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

export async function criarGrupoFiscalConfirmado(params: {
  ctx: ContextoFerramentaIa;
  proposta: PropostaAcaoPersistida;
  nomeGrupo?: string;
}): Promise<ResultadoExecucaoAcao> {
  const auth = await autorizarFerramentaIa({
    empresaId: params.ctx.empresaId,
    permissoes: params.ctx.permissoes,
    recurso: "produtos",
    acao: "criar",
    mensagem: "Você não possui permissão para criar grupo fiscal.",
  });
  if (!auth.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: auth.erro };
  }
  const campos = params.proposta.payload.campos;
  const nome = String(params.nomeGrupo ?? campos.nome ?? "").trim();
  const dados: DadosGrupoFiscalApi = {
    nome,
    descricao: campos.descricao ? String(campos.descricao) : null,
    cfopInterno: String(campos.cfopInterno ?? ""),
    cfopInterestadual: String(campos.cfopInterestadual ?? ""),
    icmsCstCsosn: String(campos.icmsCstCsosn ?? ""),
    icmsAliquota: campos.icmsAliquota == null ? null : Number(campos.icmsAliquota),
    pisCst: String(campos.pisCst ?? ""),
    pisAliquota: campos.pisAliquota == null ? null : Number(campos.pisAliquota),
    cofinsCst: String(campos.cofinsCst ?? ""),
    cofinsAliquota: campos.cofinsAliquota == null ? null : Number(campos.cofinsAliquota),
    ipiAplicavel: Boolean(campos.ipiAplicavel),
    ipiCst: campos.ipiCst ? String(campos.ipiCst) : null,
    ipiAliquota: campos.ipiAliquota == null ? null : Number(campos.ipiAliquota),
    ipiEnquadramento: campos.ipiEnquadramento ? String(campos.ipiEnquadramento) : null,
    cstIbscbs: String(campos.cstIbscbs ?? ""),
    classificacaoIbscbs: String(campos.classificacaoIbscbs ?? ""),
    aliquotaIbsUf: campos.aliquotaIbsUf == null ? null : Number(campos.aliquotaIbsUf),
    aliquotaIbsMunicipio:
      campos.aliquotaIbsMunicipio == null ? null : Number(campos.aliquotaIbsMunicipio),
    aliquotaCbs: campos.aliquotaCbs == null ? null : Number(campos.aliquotaCbs),
  };
  const criado = await criarGrupoFiscalApi({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    dados,
  });
  if (!criado.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: criado.erro };
  }
  await registrarAuditoriaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    conversaId: params.proposta.conversaId,
    propostaId: params.proposta.id,
    entidade: "grupo_fiscal",
    entidadeId: criado.id,
    tipoAcao: params.proposta.tipo,
    valoresAnteriores: {},
    valoresNovos: { ...dados, id: criado.id },
    resultado: "ok",
  });
  return {
    ok: true,
    mensagem: "Grupo fiscal criado. Nenhum produto foi movido automaticamente.",
    entidadeId: criado.id,
    depois: { id: criado.id, nome },
    podeDesfazer: false,
  };
}
