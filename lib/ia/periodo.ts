import {
  PERIODOS_RELATORIO,
  type PeriodoRelatorio,
} from "@/lib/relatorios/tipos";
import { resolverPeriodoRelatorio } from "@/lib/relatorios/periodo";

import { PERIODOS_ASSISTENTE, type PeriodoAssistente } from "./tipos";

export function periodoAssistenteValido(
  valor: string | null | undefined
): PeriodoAssistente {
  if ((PERIODOS_ASSISTENTE as readonly string[]).includes(String(valor ?? ""))) {
    return valor as PeriodoAssistente;
  }
  return "hoje";
}

export function janelaPeriodoAssistente(
  periodo: PeriodoAssistente,
  agora = new Date()
) {
  if (periodo === "anteontem") {
    const ontem = resolverPeriodoRelatorio("ontem", null, null, agora);
    const inicio = new Date(ontem.inicio.getTime() - 24 * 60 * 60 * 1000);
    return { inicio, fim: ontem.inicio, rotulo: "anteontem" };
  }
  if (periodo === "ano") {
    const hoje = resolverPeriodoRelatorio("hoje", null, null, agora);
    const ano = Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
      }).format(agora)
    );
    const inicio = new Date(`${String(ano).padStart(4, "0")}-01-01T00:00:00-03:00`);
    return { inicio, fim: hoje.fim, rotulo: "este ano" };
  }
  if (periodo === "semana") {
    const base = resolverPeriodoRelatorio("7d", null, null, agora);
    return { ...base, rotulo: "esta semana" };
  }
  if (periodo === "semana_anterior") {
    const esta = resolverPeriodoRelatorio("7d", null, null, agora);
    const inicio = new Date(esta.inicio.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fim = esta.inicio;
    return { inicio, fim, rotulo: "semana anterior" };
  }

  const mapa: Record<
    Exclude<PeriodoAssistente, "semana" | "semana_anterior" | "anteontem" | "ano">,
    PeriodoRelatorio
  > = {
    hoje: "hoje",
    ontem: "ontem",
    "7d": "7d",
    "30d": "30d",
    mes: "mes",
    mes_anterior: "mes_anterior",
  };
  const relatorio = mapa[periodo];
  if (!(PERIODOS_RELATORIO as readonly string[]).includes(relatorio)) {
    return { ...resolverPeriodoRelatorio("hoje", null, null, agora), rotulo: "hoje" };
  }
  const janela = resolverPeriodoRelatorio(relatorio, null, null, agora);
  const rotulos: Record<PeriodoAssistente, string> = {
    hoje: "hoje",
    ontem: "ontem",
    anteontem: "anteontem",
    "7d": "últimos 7 dias",
    "30d": "últimos 30 dias",
    mes: "este mês",
    mes_anterior: "mês anterior",
    semana: "esta semana",
    semana_anterior: "semana anterior",
    ano: "este ano",
  };
  return { ...janela, rotulo: rotulos[periodo] };
}

export function arredondarMoeda(valor: number) {
  return Math.round(valor * 100) / 100;
}
