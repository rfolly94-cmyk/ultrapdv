import { resolverOffsetFiscal } from "../fiscal/geranet/data-hora";

export const PERIODOS_LISTA_VENDAS = [
  "hoje",
  "ontem",
  "7dias",
  "30dias",
  "personalizado",
] as const;

export type PeriodoListaVendas = (typeof PERIODOS_LISTA_VENDAS)[number];

export type FiltrosListaVendas = {
  periodo: PeriodoListaVendas;
  inicio: string | null;
  fim: string | null;
  status: string;
  modelo: string;
  q: string;
};

export type JanelaListaVendas = {
  rotulo: string;
  inicio: Date;
  fim: Date;
  hojeIso: string;
};

type DataCivil = {
  ano: number;
  mes: number;
  dia: number;
};

const ISO_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

function texto(valor: unknown) {
  if (Array.isArray(valor)) {
    return String(valor[0] ?? "").trim();
  }
  return String(valor ?? "").trim();
}

export function periodoListaVendasValido(
  valor: string | null | undefined
): PeriodoListaVendas {
  if (PERIODOS_LISTA_VENDAS.includes(valor as PeriodoListaVendas)) {
    return valor as PeriodoListaVendas;
  }
  return "hoje";
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

export function parseFiltrosListaVendas(
  params: Record<string, string | string[] | undefined> | {
    periodo?: string;
    inicio?: string;
    fim?: string;
    status?: string;
    modelo?: string;
    q?: string;
  }
): FiltrosListaVendas {
  let periodo = periodoListaVendasValido(texto(params.periodo));
  let inicio = dataIsoCivilValida(texto(params.inicio));
  let fim = dataIsoCivilValida(texto(params.fim));

  if (periodo === "personalizado" && (!inicio || !fim)) {
    periodo = "hoje";
    inicio = null;
    fim = null;
  }

  if (periodo !== "personalizado") {
    inicio = null;
    fim = null;
  }

  const status = texto(params.status) || "todos";
  const modelo = texto(params.modelo) || "todos";

  return {
    periodo,
    inicio,
    fim,
    status,
    modelo,
    q: texto(params.q),
  };
}

export function montarHrefListaVendas(filtros: FiltrosListaVendas) {
  const params = new URLSearchParams();
  params.set("periodo", filtros.periodo);

  if (filtros.periodo === "personalizado") {
    if (filtros.inicio) {
      params.set("inicio", filtros.inicio);
    }
    if (filtros.fim) {
      params.set("fim", filtros.fim);
    }
  }

  if (filtros.status && filtros.status !== "todos") {
    params.set("status", filtros.status);
  }

  if (filtros.modelo && filtros.modelo !== "todos") {
    params.set("modelo", filtros.modelo);
  }

  if (filtros.q) {
    params.set("q", filtros.q);
  }

  const query = params.toString();
  return query ? `/vendas?${query}` : "/vendas";
}

export function formatarDataIsoPtBr(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) {
    return iso;
  }
  return `${dia}/${mes}/${ano}`;
}

export function formatarPeriodoPersonalizadoExibicao(
  inicio: string | null,
  fim: string | null
) {
  if (!inicio || !fim) {
    return "Escolher período";
  }
  return `${formatarDataIsoPtBr(inicio)} - ${formatarDataIsoPtBr(fim)}`;
}

export function dataColunaListaVenda(venda: {
  finalizada_at?: string | null;
  created_at: string | null;
}) {
  return venda.finalizada_at ?? venda.created_at;
}

export function vendaNoPeriodoLista(
  dataVenda: string | null | undefined,
  inicio: Date,
  fim: Date
) {
  if (!dataVenda) {
    return false;
  }

  const data = new Date(dataVenda);
  if (Number.isNaN(data.getTime())) {
    return false;
  }

  return data >= inicio && data < fim;
}

export function filtroCoalesceDataVenda(inicio: Date, fim: Date) {
  const inicioIso = inicio.toISOString();
  const fimIso = fim.toISOString();
  return [
    `and(finalizada_at.gte.${inicioIso},finalizada_at.lt.${fimIso})`,
    `and(finalizada_at.is.null,created_at.gte.${inicioIso},created_at.lt.${fimIso})`,
  ].join(",");
}

export function dataCivilNoFuso(agora: Date, timeZone: string): DataCivil {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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

function isoCivil(data: DataCivil) {
  return [
    String(data.ano).padStart(4, "0"),
    String(data.mes).padStart(2, "0"),
    String(data.dia).padStart(2, "0"),
  ].join("-");
}

function parseDataCivil(iso: string): DataCivil | null {
  const valido = dataIsoCivilValida(iso);
  if (!valido) {
    return null;
  }

  const [ano, mes, dia] = valido.split("-").map(Number);
  return { ano, mes, dia };
}

function adicionarDiasCivis(data: DataCivil, dias: number): DataCivil {
  const utc = new Date(Date.UTC(data.ano, data.mes - 1, data.dia + dias));
  return {
    ano: utc.getUTCFullYear(),
    mes: utc.getUTCMonth() + 1,
    dia: utc.getUTCDate(),
  };
}

export function inicioDoDiaNoFuso(
  data: DataCivil,
  timeZone: string
) {
  const ancora = new Date(Date.UTC(data.ano, data.mes - 1, data.dia, 12, 0, 0));
  const offset = resolverOffsetFiscal(timeZone, ancora);
  return new Date(`${isoCivil(data)}T00:00:00${offset}`);
}

export function resolverPeriodoListaVendas(
  periodo: PeriodoListaVendas,
  inicioIso: string | null,
  fimIso: string | null,
  timeZone: string,
  agora = new Date()
): JanelaListaVendas {
  const hoje = dataCivilNoFuso(agora, timeZone);
  const inicioHoje = inicioDoDiaNoFuso(hoje, timeZone);
  const fimHoje = inicioDoDiaNoFuso(adicionarDiasCivis(hoje, 1), timeZone);
  const hojeIso = isoCivil(hoje);

  if (periodo === "ontem") {
    const ontem = adicionarDiasCivis(hoje, -1);
    return {
      rotulo: "Ontem",
      inicio: inicioDoDiaNoFuso(ontem, timeZone),
      fim: inicioHoje,
      hojeIso,
    };
  }

  if (periodo === "7dias") {
    return {
      rotulo: "Últimos 7 dias",
      inicio: inicioDoDiaNoFuso(adicionarDiasCivis(hoje, -6), timeZone),
      fim: fimHoje,
      hojeIso,
    };
  }

  if (periodo === "30dias") {
    return {
      rotulo: "Últimos 30 dias",
      inicio: inicioDoDiaNoFuso(adicionarDiasCivis(hoje, -29), timeZone),
      fim: fimHoje,
      hojeIso,
    };
  }

  if (periodo === "personalizado") {
    const de = parseDataCivil(inicioIso ?? "") ?? hoje;
    const ate = parseDataCivil(fimIso ?? "") ?? hoje;
    const inicioCivil =
      compararCivil(de, ate) <= 0 ? de : ate;
    const fimCivil =
      compararCivil(de, ate) <= 0 ? ate : de;

    return {
      rotulo: formatarPeriodoPersonalizadoExibicao(
        isoCivil(inicioCivil),
        isoCivil(fimCivil)
      ),
      inicio: inicioDoDiaNoFuso(inicioCivil, timeZone),
      fim: inicioDoDiaNoFuso(adicionarDiasCivis(fimCivil, 1), timeZone),
      hojeIso,
    };
  }

  return {
    rotulo: "Hoje",
    inicio: inicioHoje,
    fim: fimHoje,
    hojeIso,
  };
}

function compararCivil(a: DataCivil, b: DataCivil) {
  return isoCivil(a).localeCompare(isoCivil(b));
}
