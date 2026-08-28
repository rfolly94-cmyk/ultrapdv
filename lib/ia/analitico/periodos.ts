import { resolverPeriodoRelatorio } from "@/lib/relatorios/periodo";

import { janelaPeriodoAssistente, periodoAssistenteValido } from "../periodo";
import type { PeriodoAssistente } from "../tipos";

export function janelaConsultaAnalitica(params: {
  periodo: PeriodoAssistente;
  de?: string | null;
  ate?: string | null;
  agora?: Date;
}) {
  const agora = params.agora ?? new Date();
  const de = String(params.de ?? "").trim();
  const ate = String(params.ate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    const janela = resolverPeriodoRelatorio("personalizado", de, ate, agora);
    return {
      ...janela,
      dias: Math.max(1, Math.round((janela.fim.getTime() - janela.inicio.getTime()) / 86400000)),
    };
  }
  const janela = janelaPeriodoAssistente(periodoAssistenteValido(params.periodo), agora);
  return {
    ...janela,
    dias: Math.max(1, Math.round((janela.fim.getTime() - janela.inicio.getTime()) / 86400000)),
  };
}

export function janelaComparacaoAnalitica(params: {
  periodo: PeriodoAssistente;
  de?: string | null;
  ate?: string | null;
  agora?: Date;
}) {
  const atual = janelaConsultaAnalitica(params);
  const mapa: Partial<Record<PeriodoAssistente, PeriodoAssistente>> = {
    hoje: "ontem",
    ontem: "anteontem",
    semana: "semana_anterior",
    mes: "mes_anterior",
    "7d": "semana_anterior",
  };
  const nome = mapa[params.periodo];
  if (nome && !params.de && !params.ate) {
    const anterior = janelaPeriodoAssistente(nome, params.agora);
    return {
      ...anterior,
      dias: Math.max(1, Math.round((anterior.fim.getTime() - anterior.inicio.getTime()) / 86400000)),
    };
  }
  const duracao = atual.fim.getTime() - atual.inicio.getTime();
  const inicio = new Date(atual.inicio.getTime() - duracao);
  return {
    inicio,
    fim: atual.inicio,
    rotulo: "período anterior",
    dias: atual.dias,
  };
}
