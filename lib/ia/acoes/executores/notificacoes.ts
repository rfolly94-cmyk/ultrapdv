import { aplicarEstadoNotificacaoUsuario } from "@/lib/notificacoes/aplicar-usuario";
import type { OpcaoAdiarNotificacao } from "@/lib/notificacoes/tipos";

import type { ContextoFerramentaIa } from "../../ferramentas/contexto";
import { registrarAuditoriaAcao } from "../auditoria";
import {
  MENSAGEM_FALHA_APLICAR,
  MENSAGEM_SUCESSO_APLICAR,
  type PropostaAcaoPersistida,
  type ResultadoExecucaoAcao,
} from "../tipos";

function acaoDaProposta(tipo: PropostaAcaoPersistida["tipo"]): "lida" | "dispensar" | "adiar" {
  if (tipo === "notificacao_dispensar") return "dispensar";
  if (tipo === "notificacao_adiar") return "adiar";
  return "lida";
}

export async function aplicarAcaoNotificacaoConfirmada(params: {
  ctx: ContextoFerramentaIa;
  proposta: PropostaAcaoPersistida;
}): Promise<ResultadoExecucaoAcao> {
  const ids = Array.isArray(params.proposta.payload.campos.notificacaoIds)
    ? (params.proposta.payload.campos.notificacaoIds as unknown[]).map((id) => String(id))
    : params.proposta.entidadeId
      ? [params.proposta.entidadeId]
      : [];
  if (!ids.length) {
    return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: "Nenhuma notificação na proposta." };
  }
  const acao = acaoDaProposta(params.proposta.tipo);
  const adiar = String(params.proposta.payload.campos.adiar ?? "amanha") as OpcaoAdiarNotificacao;
  for (const id of ids) {
    const saida = await aplicarEstadoNotificacaoUsuario({
      supabase: params.ctx.supabase,
      empresaId: params.ctx.empresaId,
      usuarioId: params.ctx.usuarioId,
      notificacaoId: id,
      acao,
      adiar,
    });
    if (!saida.ok) {
      await registrarAuditoriaAcao({
        supabase: params.ctx.supabase,
        empresaId: params.ctx.empresaId,
        usuarioId: params.ctx.usuarioId,
        conversaId: params.proposta.conversaId,
        propostaId: params.proposta.id,
        entidade: "notificacao",
        entidadeId: id,
        tipoAcao: params.proposta.tipo,
        valoresAnteriores: params.proposta.payload.antes,
        valoresNovos: {},
        resultado: "erro",
        erro: saida.erro,
      });
      return { ok: false, mensagem: MENSAGEM_FALHA_APLICAR, erro: saida.erro };
    }
  }
  await registrarAuditoriaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    conversaId: params.proposta.conversaId,
    propostaId: params.proposta.id,
    entidade: "notificacao",
    entidadeId: ids[0],
    tipoAcao: params.proposta.tipo,
    valoresAnteriores: params.proposta.payload.antes,
    valoresNovos: { ids, acao, adiar },
    resultado: "ok",
  });
  return {
    ok: true,
    mensagem: MENSAGEM_SUCESSO_APLICAR,
    entidadeId: ids[0],
    depois: { ids, acao },
    podeDesfazer: false,
  };
}
