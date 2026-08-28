import { consultarRegraFiscalOficial } from "@/lib/fiscal/base-oficial/consultar";
import { classificarProdutoFiscal } from "@/lib/fiscal/motor/classificar";
import { persistirFiscalProdutoApi } from "@/lib/produtos/persistir-api";
import {
  validarDadosFiscaisProduto,
  type DadosFiscaisProduto,
} from "@/lib/produtos/dados-fiscais-produto";

import type { ContextoFerramentaIa } from "../../ferramentas/contexto";
import { autorizarFerramentaIa } from "../../permissoes";
import { registrarAuditoriaAcao } from "../auditoria";
import {
  MENSAGEM_FALHA_APLICAR,
  MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  MENSAGEM_STALE_PRODUTO,
  MENSAGEM_SUCESSO_APLICAR,
  type PayloadAcaoIa,
  type PropostaAcaoPersistida,
  type ResultadoExecucaoAcao,
} from "../tipos";

export async function aplicarAtualizacaoFiscalProduto(params: {
  ctx: ContextoFerramentaIa;
  proposta: PropostaAcaoPersistida;
}): Promise<ResultadoExecucaoAcao> {
  const authProd = await autorizarFerramentaIa({
    empresaId: params.ctx.empresaId,
    permissoes: params.ctx.permissoes,
    recurso: "produtos",
    acao: "editar",
    mensagem: MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  });
  if (!authProd.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: authProd.erro };
  }
  const authFiscal = await autorizarFerramentaIa({
    empresaId: params.ctx.empresaId,
    permissoes: params.ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
    mensagem: MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  });
  if (!authFiscal.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: authFiscal.erro };
  }

  const produtoId = params.proposta.entidadeId;
  if (!produtoId) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: "Produto ausente na proposta." };
  }

  const motor = await classificarProdutoFiscal({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    entrada: { produtoId },
  });
  if (!motor.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: motor.erro };
  }

  const campos = params.proposta.payload.campos;
  const ncm = String(campos.ncm ?? "").replace(/\D/g, "");
  const cest = String(campos.cest ?? "").replace(/\D/g, "");
  const origemProduto = String(campos.origemProduto ?? "0");
  const grupoFiscalId = campos.grupoFiscalId ? String(campos.grupoFiscalId) : null;

  const ncmMotor = motor.resultado.ncmSugerido?.codigo ?? null;
  if (ncm && ncmMotor && ncm !== ncmMotor) {
    return { ok: false, mensagem: MENSAGEM_STALE_PRODUTO, erro: MENSAGEM_STALE_PRODUTO };
  }

  if (ncm) {
    const regra = await consultarRegraFiscalOficial({
      supabase: params.ctx.supabase,
      tipo: "ncm",
      codigo: ncm,
    });
    if (!regra) {
      return {
        ok: false,
        mensagem: MENSAGEM_FALHA_APLICAR,
        erro: "A vigência da regra NCM não permite gravar este código.",
      };
    }
  }
  if (cest) {
    const regra = await consultarRegraFiscalOficial({
      supabase: params.ctx.supabase,
      tipo: "cest",
      codigo: cest,
    });
    if (!regra) {
      return {
        ok: false,
        mensagem: MENSAGEM_FALHA_APLICAR,
        erro: "A vigência da regra CEST não permite gravar este código.",
      };
    }
  }

  const dadosFiscais: DadosFiscaisProduto = { ncm, cest, origemProduto };
  const erro = validarDadosFiscaisProduto(dadosFiscais);
  if (erro) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro };
  }

  const gravado = await persistirFiscalProdutoApi({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    produtoId,
    ncm: dadosFiscais.ncm,
    cest: dadosFiscais.cest,
    origemProduto: dadosFiscais.origemProduto,
    grupoFiscalId,
  });
  if (!gravado.ok) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: gravado.erro };
  }

  const depois = {
    ncm: dadosFiscais.ncm || null,
    cest: dadosFiscais.cest || null,
    origemProduto: dadosFiscais.origemProduto,
    grupoFiscalId,
  };
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
    sugestao: campos,
    fontes: params.proposta.payload.fontes,
    versaoTabelas:
      params.proposta.payload.versaoFiscal ??
      (motor.resultado.versoes
        ? Object.entries(motor.resultado.versoes)
            .map(([fonte, valor]) => `${fonte}:${valor}`)
            .join(",")
        : null),
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

export function camposFiscaisPermitidos(payload: PayloadAcaoIa) {
  return {
    ncm: payload.campos.ncm ?? null,
    cest: payload.campos.cest ?? null,
    origemProduto: payload.campos.origemProduto ?? null,
    grupoFiscalId: payload.campos.grupoFiscalId ?? null,
  };
}
