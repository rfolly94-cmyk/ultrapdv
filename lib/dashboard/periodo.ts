export const PERIODOS_DASHBOARD = [
  "hoje",
  "7d",
  "30d",
  "mes",
] as const;

export type PeriodoDashboard = (typeof PERIODOS_DASHBOARD)[number];

export function periodoValido(
  valor: string | undefined
): PeriodoDashboard {
  if (
    valor === "hoje" ||
    valor === "7d" ||
    valor === "30d" ||
    valor === "mes"
  ) {
    return valor;
  }

  return "hoje";
}

function dataSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);

  const ano = Number(partes.find((parte) => parte.type === "year")?.value);
  const mes = Number(partes.find((parte) => parte.type === "month")?.value);
  const dia = Number(partes.find((parte) => parte.type === "day")?.value);

  return { ano, mes, dia };
}

function inicioDiaSaoPaulo(ano: number, mes: number, dia: number) {
  const yyyy = String(ano).padStart(4, "0");
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`);
}

export function resolverPeriodo(periodo: PeriodoDashboard, agora = new Date()) {
  const { ano, mes, dia } = dataSaoPaulo(agora);
  const inicioHoje = inicioDiaSaoPaulo(ano, mes, dia);
  const fim = new Date(inicioHoje.getTime() + 24 * 60 * 60 * 1000);

  let inicio = inicioHoje;
  let diasGrafico = 7;

  if (periodo === "7d") {
    inicio = new Date(inicioHoje.getTime() - 6 * 24 * 60 * 60 * 1000);
    diasGrafico = 7;
  } else if (periodo === "30d") {
    inicio = new Date(inicioHoje.getTime() - 29 * 24 * 60 * 60 * 1000);
    diasGrafico = 30;
  } else if (periodo === "mes") {
    inicio = inicioDiaSaoPaulo(ano, mes, 1);
    diasGrafico = Math.max(
      1,
      Math.round((fim.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000))
    );
  }

  const inicioGrafico =
    periodo === "hoje"
      ? new Date(inicioHoje.getTime() - 6 * 24 * 60 * 60 * 1000)
      : inicio;

  return {
    inicio,
    fim,
    inicioHoje,
    inicioGrafico,
    diasGrafico: periodo === "hoje" ? 7 : diasGrafico,
    rotulo:
      periodo === "hoje"
        ? "Hoje"
        : periodo === "7d"
          ? "7 dias"
          : periodo === "30d"
            ? "30 dias"
            : "Mês atual",
  };
}

export function chaveDiaSaoPaulo(valor: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof valor === "string" ? new Date(valor) : valor);
}

export function rotuloDiaSaoPaulo(chave: string) {
  const [ano, mes, dia] = chave.split("-").map(Number);
  if (!ano || !mes || !dia) {
    return chave;
  }

  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}
