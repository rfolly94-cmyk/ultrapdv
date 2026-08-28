import type {
  CandidatoNotificacao,
  NotificacaoPersistida,
  TipoNotificacao,
} from "./tipos";

export type PlanoSincronizacaoNotificacoes = {
  upsert: CandidatoNotificacao[];
  resolverIds: string[];
};

export function planejarSincronizacaoNotificacoes(params: {
  existentes: NotificacaoPersistida[];
  candidatos: CandidatoNotificacao[];
  tiposAvaliados: readonly TipoNotificacao[];
}): PlanoSincronizacaoNotificacoes {
  const avaliados = new Set(params.tiposAvaliados);
  const porChave = new Map(
    params.existentes.map((item) => [item.chaveDeduplicacao, item])
  );
  const chavesCandidatas = new Set(
    params.candidatos.map((item) => item.chaveDeduplicacao)
  );

  const upsert = params.candidatos.filter((candidato) =>
    notificacaoDeveAtualizar(porChave.get(candidato.chaveDeduplicacao), candidato)
  );

  const resolverIds: string[] = [];
  for (const existente of params.existentes) {
    if (existente.status !== "ativa") {
      continue;
    }
    if (!avaliados.has(existente.tipo)) {
      continue;
    }
    if (!chavesCandidatas.has(existente.chaveDeduplicacao)) {
      resolverIds.push(existente.id);
    }
  }

  return {
    upsert,
    resolverIds,
  };
}

export function notificacaoDeveAtualizar(
  existente: NotificacaoPersistida | undefined,
  candidato: CandidatoNotificacao
) {
  if (!existente) {
    return true;
  }
  if (existente.status === "resolvida") {
    return true;
  }
  return (
    existente.titulo !== candidato.titulo ||
    existente.mensagem !== candidato.mensagem ||
    existente.nivel !== candidato.nivel ||
    existente.actionUrl !== candidato.actionUrl
  );
}
