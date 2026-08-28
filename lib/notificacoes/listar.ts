import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aplicarFiltroCentral,
  notificacaoAdiada,
  notificacaoContaNoSino,
  notificacaoVisivelNaCentral,
} from "./estado-usuario";
import { actionUrlSegura } from "./rotas";
import { tabelaNotificacoesIndisponivel } from "./schema";
import { mapearNotificacao } from "./sincronizar";
import type {
  EstadoNotificacaoUsuario,
  FiltroCentralNotificacoes,
  NotificacaoCentral,
} from "./tipos";

function mapearEstado(row: Record<string, unknown> | undefined): EstadoNotificacaoUsuario {
  return {
    lidaEm: row?.lida_em ? String(row.lida_em) : null,
    dispensadaEm: row?.dispensada_em ? String(row.dispensada_em) : null,
    adiadaAte: row?.adiada_ate ? String(row.adiada_ate) : null,
  };
}

export async function listarNotificacoesDaEmpresa(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  filtro?: FiltroCentralNotificacoes;
  agora?: Date;
}): Promise<
  | {
      ok: true;
      itens: NotificacaoCentral[];
      contador: number;
    }
  | { ok: false; erro: string; indisponivel?: boolean }
> {
  const agora = params.agora ?? new Date();
  const filtro = params.filtro ?? "todas";

  const [{ data, error }, { data: estados, error: erroEstados }] =
    await Promise.all([
      params.supabase
        .from("notificacoes")
        .select(
          "id, empresa_id, tipo, categoria, nivel, titulo, mensagem, entidade_tipo, entidade_id, action_url, chave_deduplicacao, metadata, status, created_at, updated_at, resolved_at"
        )
        .eq("empresa_id", params.empresaId)
        .eq("status", "ativa")
        .order("updated_at", { ascending: false }),
      params.supabase
        .from("notificacoes_usuarios")
        .select(
          "notificacao_id, lida_em, dispensada_em, adiada_ate"
        )
        .eq("empresa_id", params.empresaId)
        .eq("usuario_id", params.usuarioId),
    ]);

  if (error) {
    if (tabelaNotificacoesIndisponivel(error)) {
      return { ok: false, erro: error.message, indisponivel: true };
    }
    return { ok: false, erro: error.message };
  }
  if (erroEstados && !tabelaNotificacoesIndisponivel(erroEstados)) {
    return { ok: false, erro: erroEstados.message };
  }

  const estadoPorId = new Map(
    (estados ?? []).map((item) => [
      String(item.notificacao_id),
      mapearEstado(item as Record<string, unknown>),
    ])
  );

  const itens: NotificacaoCentral[] = [];
  let contador = 0;

  for (const row of data ?? []) {
    const notificacao = mapearNotificacao(row as Record<string, unknown>);
    if (notificacao.empresaId !== params.empresaId) {
      continue;
    }
    const estado = estadoPorId.get(notificacao.id) ?? mapearEstado(undefined);
    if (notificacaoContaNoSino(notificacao, estado, agora)) {
      contador += 1;
    }
    if (!notificacaoVisivelNaCentral(notificacao, estado, agora, filtro)) {
      continue;
    }
    const item: NotificacaoCentral = {
      ...notificacao,
      actionUrl: actionUrlSegura(notificacao.actionUrl),
      lida: Boolean(estado.lidaEm),
      dispensada: Boolean(estado.dispensadaEm),
      adiada: notificacaoAdiada(estado, agora),
      adiadaAte: estado.adiadaAte,
    };
    if (!aplicarFiltroCentral(item, filtro)) {
      continue;
    }
    itens.push(item);
  }

  return { ok: true, itens, contador };
}
