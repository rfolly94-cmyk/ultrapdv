export const PERIODOS_CARTEIRA = [
  "hoje",
  "ontem",
  "7dias",
  "30dias",
  "este_mes",
  "mes_anterior",
  "personalizado",
  "todos",
] as const;

export type PeriodoCarteira = (typeof PERIODOS_CARTEIRA)[number];

export type JanelaPeriodoCarteira = {
  rotulo: string;
  inicio: Date | null;
  fim: Date | null;
};

const ISO_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export const ROTULOS_PERIODO_CARTEIRA: Record<PeriodoCarteira, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7dias": "Últimos 7 dias",
  "30dias": "Últimos 30 dias",
  este_mes: "Este mês",
  mes_anterior: "Mês anterior",
  personalizado: "Personalizado",
  todos: "Todos",
};

export function periodoCarteiraValido(
  valor: string | null | undefined
): PeriodoCarteira {
  if (PERIODOS_CARTEIRA.includes(valor as PeriodoCarteira)) {
    return valor as PeriodoCarteira;
  }
  return "todos";
}

export function dataIsoCivilValida(valor: string | null | undefined) {
  const iso = String(valor ?? "").trim();
  if (!ISO_CIVIL.test(iso)) {
    return null;
  }

  const [ano, mes, dia] = iso.split("-").map(Number);
  if (!ano || !mes || !dia) {
    return null;
  }

  const utc = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    utc.getUTCFullYear() !== ano ||
    utc.getUTCMonth() + 1 !== mes ||
    utc.getUTCDate() !== dia
  ) {
    return null;
  }

  return iso;
}

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

function parseDataIso(valor?: string | null) {
  const iso = dataIsoCivilValida(valor);
  if (!iso) {
    return null;
  }
  return new Date(`${iso}T00:00:00-03:00`);
}

export function resolverPeriodoCarteira(
  periodo: PeriodoCarteira,
  de?: string | null,
  ate?: string | null,
  agora = new Date()
): JanelaPeriodoCarteira {
  const { ano, mes, dia } = dataSaoPaulo(agora);
  const inicioHoje = inicioDiaSaoPaulo(ano, mes, dia);
  const fimHoje = adicionarDias(inicioHoje, 1);

  if (periodo === "todos") {
    return { rotulo: "Todos", inicio: null, fim: null };
  }

  if (periodo === "hoje") {
    return { rotulo: "Hoje", inicio: inicioHoje, fim: fimHoje };
  }

  if (periodo === "ontem") {
    return {
      rotulo: "Ontem",
      inicio: adicionarDias(inicioHoje, -1),
      fim: inicioHoje,
    };
  }

  if (periodo === "7dias") {
    return {
      rotulo: "Últimos 7 dias",
      inicio: adicionarDias(inicioHoje, -6),
      fim: fimHoje,
    };
  }

  if (periodo === "30dias") {
    return {
      rotulo: "Últimos 30 dias",
      inicio: adicionarDias(inicioHoje, -29),
      fim: fimHoje,
    };
  }

  if (periodo === "mes_anterior") {
    const mesAnterior = mes === 1 ? 12 : mes - 1;
    const anoAnterior = mes === 1 ? ano - 1 : ano;
    return {
      rotulo: "Mês anterior",
      inicio: inicioDiaSaoPaulo(anoAnterior, mesAnterior, 1),
      fim: inicioDiaSaoPaulo(ano, mes, 1),
    };
  }

  if (periodo === "personalizado") {
    const inicio = parseDataIso(de) ?? inicioHoje;
    const fimBase = parseDataIso(ate) ?? inicioHoje;
    const inicioOk = inicio <= fimBase ? inicio : fimBase;
    const fimOk = inicio <= fimBase ? fimBase : inicio;
    return {
      rotulo: "Personalizado",
      inicio: inicioOk,
      fim: adicionarDias(fimOk, 1),
    };
  }

  return {
    rotulo: "Este mês",
    inicio: inicioDiaSaoPaulo(ano, mes, 1),
    fim: fimHoje,
  };
}

export function dataDentroDoPeriodo(
  valor: string | null | undefined,
  janela: JanelaPeriodoCarteira
) {
  if (!janela.inicio || !janela.fim) {
    return true;
  }
  if (!valor) {
    return false;
  }
  const data = new Date(valor);
  return data >= janela.inicio && data < janela.fim;
}

export function dataDaVendaCarteira(input: {
  finalizada_at?: string | null;
  created_at?: string | null;
  titulo_created_at?: string | null;
}) {
  return (
    input.finalizada_at ||
    input.created_at ||
    input.titulo_created_at ||
    null
  );
}
