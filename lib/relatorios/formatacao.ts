const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const quantidade = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

export function numeroSeguro(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatarMoeda(valor: number | string | null | undefined) {
  return moeda.format(numeroSeguro(valor));
}

export function formatarQuantidade(valor: number | string | null | undefined) {
  return quantidade.format(numeroSeguro(valor));
}

export function formatarData(valor: string | Date | null | undefined) {
  if (!valor) {
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(typeof valor === "string" ? new Date(valor) : valor);
}

export function formatarDataHora(valor: string | Date | null | undefined) {
  if (!valor) {
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof valor === "string" ? new Date(valor) : valor);
}

export function formatarPercentual(parte: number, total: number) {
  if (total <= 0) {
    return "0%";
  }
  return `${((parte / total) * 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}%`;
}
