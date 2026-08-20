const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const FUSO_FISCAL_PADRAO = "America/Sao_Paulo";

export type Competencia = {
  ano: number;
  mes: number;
};

export function competenciaAtual(agora = new Date()): Competencia {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_FISCAL_PADRAO,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(agora);

  return {
    ano: Number(partes.find((parte) => parte.type === "year")?.value),
    mes: Number(partes.find((parte) => parte.type === "month")?.value),
  };
}

export function parseCompetencia(valor: string | undefined | null): Competencia {
  const atual = competenciaAtual();
  const texto = String(valor ?? "").trim();
  const match = texto.match(/^(\d{4})-(\d{1,2})$/);

  if (!match) {
    return atual;
  }

  const ano = Number(match[1]);
  const mes = Number(match[2]);

  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12) {
    return atual;
  }

  return { ano, mes };
}

export function chaveCompetencia(competencia: Competencia) {
  return `${competencia.ano}-${String(competencia.mes).padStart(2, "0")}`;
}

export function rotuloCompetencia(competencia: Competencia) {
  return `${MESES[competencia.mes - 1]}/${competencia.ano}`;
}

export function intervaloCompetencia(
  competencia: Competencia,
  fuso = FUSO_FISCAL_PADRAO
) {
  const yyyy = String(competencia.ano).padStart(4, "0");
  const mm = String(competencia.mes).padStart(2, "0");
  const offset = fuso === "America/Sao_Paulo" ? "-03:00" : "-03:00";
  const inicio = new Date(`${yyyy}-${mm}-01T00:00:00${offset}`);
  const proximoMes =
    competencia.mes === 12
      ? { ano: competencia.ano + 1, mes: 1 }
      : { ano: competencia.ano, mes: competencia.mes + 1 };
  const proximo = `${String(proximoMes.ano).padStart(4, "0")}-${String(proximoMes.mes).padStart(2, "0")}-01T00:00:00${offset}`;
  const fim = new Date(proximo);

  return { inicio, fim };
}

export function slugArquivo(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "empresa";
}
