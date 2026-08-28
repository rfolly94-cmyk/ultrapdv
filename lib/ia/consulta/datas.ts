import { janelaPeriodoAssistente, periodoAssistenteValido } from "../periodo";
import { PERIODOS_ASSISTENTE, type PeriodoAssistente } from "../tipos";
import type { FonteCatalogoConsulta, LinhaConsulta } from "./tipos";

const ALIAS_PERIODO: Record<string, PeriodoAssistente | "ano_passado"> = {
  hoje: "hoje",
  ontem: "ontem",
  anteontem: "anteontem",
  "esta semana": "semana",
  esta_semana: "semana",
  "semana passada": "semana_anterior",
  semana_passada: "semana_anterior",
  "ultimos 7 dias": "7d",
  "últimos 7 dias": "7d",
  ultimos_7_dias: "7d",
  "7d": "7d",
  "ultimos 30 dias": "30d",
  "últimos 30 dias": "30d",
  ultimos_30_dias: "30d",
  "30d": "30d",
  "este mes": "mes",
  "este mês": "mes",
  este_mes: "mes",
  mes: "mes",
  "mes passado": "mes_anterior",
  "mês passado": "mes_anterior",
  mes_passado: "mes_anterior",
  mes_anterior: "mes_anterior",
  "este ano": "ano",
  este_ano: "ano",
  ano: "ano",
  "ano passado": "ano_passado",
  ano_passado: "ano_passado",
  semana: "semana",
  semana_anterior: "semana_anterior",
};

export type JanelaConsulta = { inicio: Date; fim: Date; rotulo: string };

function anoPassado(agora: Date): JanelaConsulta {
  const ano = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }).format(agora)
  );
  const inicio = new Date(`${String(ano - 1).padStart(4, "0")}-01-01T00:00:00-03:00`);
  const fim = new Date(`${String(ano).padStart(4, "0")}-01-01T00:00:00-03:00`);
  return { inicio, fim, rotulo: "ano passado" };
}

export function ehPeriodoRelativoConsulta(valor: unknown): boolean {
  if (typeof valor !== "string") {
    return false;
  }
  const chave = valor.trim().toLowerCase();
  return Boolean(ALIAS_PERIODO[chave]) || (PERIODOS_ASSISTENTE as readonly string[]).includes(chave);
}

export function resolverJanelaRelativaConsulta(
  valor: string,
  agora = new Date()
): JanelaConsulta | null {
  const chave = valor.trim().toLowerCase();
  const alias = ALIAS_PERIODO[chave];
  if (!alias) {
    if ((PERIODOS_ASSISTENTE as readonly string[]).includes(chave)) {
      const janela = janelaPeriodoAssistente(periodoAssistenteValido(chave), agora);
      return { inicio: janela.inicio, fim: janela.fim, rotulo: janela.rotulo };
    }
    return null;
  }
  if (alias === "ano_passado") {
    return anoPassado(agora);
  }
  const janela = janelaPeriodoAssistente(alias, agora);
  return { inicio: janela.inicio, fim: janela.fim, rotulo: janela.rotulo };
}

export function instanteDaLinha(
  linha: LinhaConsulta,
  fonte: FonteCatalogoConsulta
): Date | null {
  if (!fonte.campoData) {
    return null;
  }
  const bruto = linha[fonte.campoData];
  if (bruto == null || bruto === "") {
    return null;
  }
  const data = bruto instanceof Date ? bruto : new Date(String(bruto));
  return Number.isNaN(data.getTime()) ? null : data;
}

export function linhaNoPeriodo(
  linha: LinhaConsulta,
  fonte: FonteCatalogoConsulta,
  janela: JanelaConsulta
) {
  const data = instanteDaLinha(linha, fonte);
  if (!data) {
    return false;
  }
  return data >= janela.inicio && data < janela.fim;
}
