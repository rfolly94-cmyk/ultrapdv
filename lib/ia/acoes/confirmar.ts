import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import { tabelaIaIndisponivel } from "../schema";
import { registrarAuditoriaAcao } from "./auditoria";
import { carregarPropostaAcao } from "./carregar";
import { hashDaEntidade } from "./estado";
import { aplicarAtualizacaoFiscalProduto } from "./executores/fiscal-produto";
import {
  aplicarAtribuicaoGrupoFiscal,
  criarGrupoFiscalConfirmado,
} from "./executores/grupo-fiscal";
import { aplicarAcaoNotificacaoConfirmada } from "./executores/notificacoes";
import { aplicarAtualizacaoBasicaProduto } from "./executores/produto-basico";
import {
  bloquearStale,
  bloquearTrocaEmpresa,
  bloquearUsuario,
  podeConfirmarStatus,
} from "./regras";
import {
  MENSAGEM_FALHA_APLICAR,
  MENSAGEM_SUCESSO_APLICAR,
  type PropostaAcaoPersistida,
  type ResultadoExecucaoAcao,
} from "./tipos";

async function executarTipo(
  ctx: ContextoFerramentaIa,
  proposta: PropostaAcaoPersistida,
  nomeGrupo?: string
): Promise<ResultadoExecucaoAcao> {
  switch (proposta.tipo) {
    case "atualizacao_fiscal_produto":
      return aplicarAtualizacaoFiscalProduto({ ctx, proposta });
    case "atribuicao_grupo_fiscal":
      return aplicarAtribuicaoGrupoFiscal({ ctx, proposta });
    case "criacao_grupo_fiscal":
      return criarGrupoFiscalConfirmado({ ctx, proposta, nomeGrupo });
    case "atualizacao_basica_produto":
      return aplicarAtualizacaoBasicaProduto({ ctx, proposta });
    case "notificacao_lida":
    case "notificacao_dispensar":
    case "notificacao_adiar":
      return aplicarAcaoNotificacaoConfirmada({ ctx, proposta });
    case "desfazer":
      return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: "Use a ação de desfazer." };
    default:
      return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: "Tipo de ação não permitido." };
  }
}

export async function confirmarPropostaAcao(params: {
  ctx: ContextoFerramentaIa;
  propostaId: string;
  nomeGrupo?: string;
}): Promise<ResultadoExecucaoAcao & { propostaId: string; conversaId?: string }> {
  const carregada = await carregarPropostaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    propostaId: params.propostaId,
  });
  if (!carregada.ok) {
    return {
      ok: false,
      propostaId: params.propostaId,
      mensagem: MENSAGEM_FALHA_APLICAR,
      erro: carregada.erro,
    };
  }
  const proposta = carregada.proposta;

  const empresa = bloquearTrocaEmpresa(proposta.empresaId, params.ctx.empresaId);
  if (!empresa.ok) {
    return { ok: false, propostaId: proposta.id, mensagem: empresa.erro, erro: empresa.erro };
  }
  const usuario = bloquearUsuario(proposta.usuarioId, params.ctx.usuarioId);
  if (!usuario.ok) {
    return { ok: false, propostaId: proposta.id, mensagem: usuario.erro, erro: usuario.erro };
  }

  const status = podeConfirmarStatus(proposta.status, proposta.expiresAt);
  if (!status.ok) {
    if (proposta.status === "executada") {
      const mensagem =
        typeof proposta.resultado.mensagem === "string"
          ? proposta.resultado.mensagem
          : MENSAGEM_SUCESSO_APLICAR;
      return {
        ok: true,
        propostaId: proposta.id,
        conversaId: proposta.conversaId,
        mensagem,
        entidadeId: proposta.entidadeId,
        depois: proposta.resultado.depois as Record<string, unknown> | undefined,
        podeDesfazer: Boolean(proposta.resultado.podeDesfazer),
      };
    }
    return { ok: false, propostaId: proposta.id, mensagem: status.erro, erro: status.erro };
  }
  if (status.idempotente) {
    const mensagem =
      typeof proposta.resultado.mensagem === "string"
        ? proposta.resultado.mensagem
        : MENSAGEM_SUCESSO_APLICAR;
    return {
      ok: true,
      propostaId: proposta.id,
      conversaId: proposta.conversaId,
      mensagem,
      entidadeId: proposta.entidadeId,
      depois: proposta.resultado.depois as Record<string, unknown> | undefined,
      podeDesfazer: Boolean(proposta.resultado.podeDesfazer),
    };
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
    return {
      ok: false,
      propostaId: proposta.id,
      mensagem: MENSAGEM_FALHA_APLICAR,
      erro: "Registro não encontrado nesta empresa.",
    };
  }
  const stale = bloquearStale({
    hashAtual: estado.hash,
    hashProposta: proposta.hashEstado,
    entidadeTipo: proposta.entidadeTipo,
  });
  if (!stale.ok) {
    await params.ctx.supabase
      .from("ia_propostas_acoes")
      .update({ status: "expirada", erro: stale.erro })
      .eq("empresa_id", params.ctx.empresaId)
      .eq("id", proposta.id)
      .eq("usuario_id", params.ctx.usuarioId)
      .eq("status", "pendente");
    return { ok: false, propostaId: proposta.id, mensagem: stale.erro, erro: stale.erro };
  }

  const agora = new Date().toISOString();
  const { data: claimed, error: erroClaim } = await params.ctx.supabase
    .from("ia_propostas_acoes")
    .update({ status: "confirmada", confirmed_at: agora })
    .eq("empresa_id", params.ctx.empresaId)
    .eq("id", proposta.id)
    .eq("usuario_id", params.ctx.usuarioId)
    .eq("status", "pendente")
    .select("id")
    .maybeSingle();
  if (erroClaim && tabelaIaIndisponivel(erroClaim)) {
    return { ok: false, propostaId: proposta.id, mensagem: MENSAGEM_FALHA_APLICAR, erro: erroClaim.message };
  }
  if (!claimed) {
    const deNovo = await carregarPropostaAcao({
      supabase: params.ctx.supabase,
      empresaId: params.ctx.empresaId,
      usuarioId: params.ctx.usuarioId,
      propostaId: proposta.id,
    });
    if (deNovo.ok && deNovo.proposta.status === "executada") {
      const mensagem =
        typeof deNovo.proposta.resultado.mensagem === "string"
          ? deNovo.proposta.resultado.mensagem
          : MENSAGEM_SUCESSO_APLICAR;
      return {
        ok: true,
        propostaId: proposta.id,
        conversaId: proposta.conversaId,
        mensagem,
        podeDesfazer: Boolean(deNovo.proposta.resultado.podeDesfazer),
      };
    }
    return {
      ok: false,
      propostaId: proposta.id,
      mensagem: "A confirmação desta proposta já está em andamento.",
      erro: "em_andamento",
    };
  }

  const executado = await executarTipo(params.ctx, proposta, params.nomeGrupo);
  if (!executado.ok) {
    await params.ctx.supabase
      .from("ia_propostas_acoes")
      .update({
        status: "falhou",
        erro: executado.erro ?? MENSAGEM_FALHA_APLICAR,
        resultado: { mensagem: executado.mensagem, erro: executado.erro },
      })
      .eq("empresa_id", params.ctx.empresaId)
      .eq("id", proposta.id);
    await registrarAuditoriaAcao({
      supabase: params.ctx.supabase,
      empresaId: params.ctx.empresaId,
      usuarioId: params.ctx.usuarioId,
      conversaId: proposta.conversaId,
      propostaId: proposta.id,
      entidade:
        proposta.entidadeTipo === "grupo_fiscal"
          ? "grupo_fiscal"
          : proposta.entidadeTipo === "notificacao"
            ? "notificacao"
            : proposta.tipo === "atualizacao_basica_produto"
              ? "produto"
              : "produto_fiscal",
      entidadeId: proposta.entidadeId ?? proposta.id,
      tipoAcao: proposta.tipo,
      valoresAnteriores: proposta.payload.antes,
      valoresNovos: {},
      resultado: "erro",
      erro: executado.erro ?? MENSAGEM_FALHA_APLICAR,
    });
    return {
      ok: false,
      propostaId: proposta.id,
      conversaId: proposta.conversaId,
      mensagem: MENSAGEM_FALHA_APLICAR,
      erro: executado.erro,
    };
  }

  const estadoDepois = await hashDaEntidade({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    tipo: proposta.tipo,
    entidadeTipo: proposta.entidadeTipo,
    entidadeId: executado.entidadeId ?? proposta.entidadeId,
    ids,
  });

  await params.ctx.supabase
    .from("ia_propostas_acoes")
    .update({
      status: "executada",
      executed_at: new Date().toISOString(),
      resultado: {
        mensagem: executado.mensagem,
        depois: executado.depois ?? {},
        hashDepois: estadoDepois?.hash ?? null,
        podeDesfazer: Boolean(executado.podeDesfazer),
        entidadeId: executado.entidadeId ?? proposta.entidadeId,
      },
    })
    .eq("empresa_id", params.ctx.empresaId)
    .eq("id", proposta.id);

  return {
    ...executado,
    propostaId: proposta.id,
    conversaId: proposta.conversaId,
  };
}
