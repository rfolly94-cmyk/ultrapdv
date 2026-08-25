export const CEDULAS_REAIS = [200, 100, 50, 20, 10, 5, 2] as const;
export const MOEDAS_REAIS = [1, 0.5, 0.25, 0.1, 0.05] as const;

export type DenominacaoDinheiro =
  | (typeof CEDULAS_REAIS)[number]
  | (typeof MOEDAS_REAIS)[number];

export type QuantidadesDinheiro = Partial<Record<string, number>>;

function quantidadeValida(valor: unknown) {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

export function totalContadoDinheiro(quantidades: QuantidadesDinheiro) {
  let total = 0;
  for (const denominacao of [...CEDULAS_REAIS, ...MOEDAS_REAIS]) {
    const qtd = quantidadeValida(quantidades[String(denominacao)]);
    total += qtd * denominacao;
  }
  return Math.round(total * 100) / 100;
}

export function chaveDenominacao(valor: number) {
  return String(valor);
}
