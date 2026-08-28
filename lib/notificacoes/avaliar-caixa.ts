import { chaveDiaSaoPaulo } from "@/lib/dashboard/periodo";

import { chaveNotificacao, hrefCaixaNotificacao } from "./rotas";
import type { CandidatoNotificacao, ConfiguracaoNotificacoes } from "./tipos";

export type CaixaNotificacao = {
  id: string;
  status: string;
  abertoEm: string | null;
};

export function avaliarCaixaNotificacoes(params: {
  caixa: CaixaNotificacao | null;
  config: ConfiguracaoNotificacoes;
  agora?: Date;
}): CandidatoNotificacao[] {
  if (!params.config.caixaAbertoAnterior || !params.caixa) {
    return [];
  }

  if (String(params.caixa.status) !== "aberto" || !params.caixa.abertoEm) {
    return [];
  }

  const hoje = chaveDiaSaoPaulo(params.agora ?? new Date());
  const abertura = chaveDiaSaoPaulo(params.caixa.abertoEm);
  if (!abertura || abertura >= hoje) {
    return [];
  }

  return [
    {
      tipo: "caixa_aberto_anterior",
      categoria: "caixa",
      nivel: "critico",
      titulo: "Caixa aberto do dia anterior",
      mensagem: "Há um caixa aberto em um dia anterior. Feche ou confira a sessão.",
      entidadeTipo: "caixa",
      entidadeId: params.caixa.id,
      actionUrl: hrefCaixaNotificacao(),
      chaveDeduplicacao: chaveNotificacao(
        "caixa_aberto_anterior",
        params.caixa.id
      ),
      metadata: { abertoEm: params.caixa.abertoEm, diaAbertura: abertura },
    },
  ];
}
