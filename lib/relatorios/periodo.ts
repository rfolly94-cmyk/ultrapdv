import {
  PERIODOS_RELATORIO,
  type PeriodoRelatorio,
} from "./tipos";

function dataSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);

  return {
    ano: Number(partes.find((parte) => parte.type === "year")?.value),
    mes: Number(partes.find((parte) => parte.type === "month")?.value),
    dia: Number(partes.find((parte) => parte.type === "day")?.value),
  };
}

function inicioDiaSaoPaulo(ano: number, mes: number, dia: number) {
  const yyyy = String(ano).padStart(4, "0");
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`);
}

function adicionarDias(data: Date, dias: number) {
  return new Date(data.getTime() + dias * 24 * 60 * 60 * 1000);
}

export function periodoRelatorioValido(
  valor: string | null | undefined
): PeriodoRelatorio {
  if (PERIODOS_RELATORIO.includes(valor as PeriodoRelatorio)) {
    return valor as PeriodoRelatorio;
  }
  return "mes";
}

export function resolverPeriodoRelatorio(
  periodo: PeriodoRelatorio,
  de?: string | null,
  ate?: string | null,
  agora = new Date()
) {
  const { ano, mes, dia } = dataSaoPaulo(agora);
  const inicioHoje = inicioDiaSaoPaulo(ano, mes, dia);
  const fimHoje = adicionarDias(inicioHoje, 1);

  if (periodo === "hoje") {
    return janela("Hoje", inicioHoje, fimHoje);
  }

  if (periodo === "ontem") {
    const inicio = adicionarDias(inicioHoje, -1);
    return janela("Ontem", inicio, inicioHoje);
  }

  if (periodo === "7d") {
    return janela(
      "Últimos 7 dias",
      adicionarDias(inicioHoje, -6),
      fimHoje
    );
  }

  if (periodo === "30d") {
    return janela(
      "Últimos 30 dias",
      adicionarDias(inicioHoje, -29),
      fimHoje
    );
  }

  if (periodo === "mes_anterior") {
    const mesAnterior = mes === 1 ? 12 : mes - 1;
    const anoAnterior = mes === 1 ? ano - 1 : ano;
    const inicio = inicioDiaSaoPaulo(anoAnterior, mesAnterior, 1);
    const fim = inicioDiaSaoPaulo(ano, mes, 1);
    return janela("Mês anterior", inicio, fim);
  }

  if (periodo === "personalizado") {
    const inicio = parseDataIso(de) ?? inicioDiaSaoPaulo(ano, mes, 1);
    const fimBase = parseDataIso(ate) ?? inicioHoje;
    const fim = adicionarDias(fimBase, 1);
    return janela(
      `${formatarDataCurta(inicio)} a ${formatarDataCurta(fimBase)}`,
      inicio,
      fim > inicio ? fim : adicionarDias(inicio, 1)
    );
  }

  return janela("Este mês", inicioDiaSaoPaulo(ano, mes, 1), fimHoje);
}

function janela(rotulo: string, inicio: Date, fim: Date) {
  return { rotulo, inicio, fim };
}

function parseDataIso(valor?: string | null) {
  const texto = String(valor ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return null;
  }
  return new Date(`${texto}T00:00:00-03:00`);
}

function formatarDataCurta(data: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);
}

export function noIntervalo(
  valor: string | null | undefined,
  inicio: Date,
  fim: Date
) {
  if (!valor) {
    return false;
  }
  const data = new Date(valor);
  return data >= inicio && data < fim;
}

export function dataVenda(venda: {
  finalizada_at?: string | null;
  created_at: string;
}) {
  return venda.finalizada_at || venda.created_at;
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
  const [, mes, dia] = chave.split("-");
  if (!mes || !dia) {
    return chave;
  }
  return `${dia}/${mes}`;
}
