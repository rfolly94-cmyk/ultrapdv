import type { PeriodoAssistente } from "../tipos";
import { normalizarTextoDeterministico } from "./normalizar";

const PADROES_PERIODO: Array<{ re: RegExp; periodo: PeriodoAssistente }> = [
  { re: /\b(ultimos|ultimo|ultimas|ultima)\s+30\s+dias\b/, periodo: "30d" },
  { re: /\b(ultimos|ultimo|ultimas|ultima)\s+7\s+dias\b/, periodo: "7d" },
  { re: /\b(semana\s+passada|semana\s+anterior)\b/, periodo: "semana_anterior" },
  { re: /\b(esta\s+semana|essa\s+semana|nesta\s+semana)\b/, periodo: "semana" },
  { re: /\b(mes\s+passado|mes\s+anterior)\b/, periodo: "mes_anterior" },
  { re: /\b(este\s+mes|esse\s+mes|neste\s+mes|do\s+mes|no\s+mes|vendas\s+do\s+mes)\b/, periodo: "mes" },
  { re: /\b(este\s+ano|esse\s+ano|neste\s+ano|do\s+ano)\b/, periodo: "ano" },
  { re: /\banteontem\b/, periodo: "anteontem" },
  { re: /\bontem\b/, periodo: "ontem" },
  { re: /\bhoje\b/, periodo: "hoje" },
];

export function extrairPeriodoDeterministico(texto: string): {
  periodo: PeriodoAssistente;
  trecho: string | null;
} {
  const normalizado = normalizarTextoDeterministico(texto);
  for (const item of PADROES_PERIODO) {
    const match = normalizado.match(item.re);
    if (match?.[0]) {
      return { periodo: item.periodo, trecho: match[0] };
    }
  }
  return { periodo: "hoje", trecho: null };
}
