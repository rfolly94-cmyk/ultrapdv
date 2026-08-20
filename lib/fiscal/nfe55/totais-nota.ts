import {
  deCentavos,
  paraCentavos,
} from "@/lib/fiscal/distribuir-desconto-itens";

export type TotaisNotaNfe = {
  frete: number;
  seguro: number;
  outro: number;
  desconto: number;
};

const VAZIO: TotaisNotaNfe = {
  frete: 0,
  seguro: 0,
  outro: 0,
  desconto: 0,
};

function dinheiroNaoNegativo(valor: unknown) {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero) || numero < 0) {
    return 0;
  }
  return deCentavos(paraCentavos(numero));
}

export function totaisNotaVazios(): TotaisNotaNfe {
  return { ...VAZIO };
}

export function normalizarTotaisNota(input: unknown): TotaisNotaNfe {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return totaisNotaVazios();
  }
  const bruto = input as Record<string, unknown>;
  return {
    frete: dinheiroNaoNegativo(bruto.frete),
    seguro: dinheiroNaoNegativo(bruto.seguro),
    outro: dinheiroNaoNegativo(bruto.outro),
    desconto: dinheiroNaoNegativo(bruto.desconto),
  };
}

export function totaisNotaDoSnapshot(snapshot: unknown): TotaisNotaNfe {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return totaisNotaVazios();
  }
  return normalizarTotaisNota(
    (snapshot as { totais_nota?: unknown }).totais_nota
  );
}

export function totaisNotaCentavos(totais: TotaisNotaNfe) {
  return {
    frete: paraCentavos(totais.frete),
    seguro: paraCentavos(totais.seguro),
    outro: paraCentavos(totais.outro),
    desconto: paraCentavos(totais.desconto),
  };
}

export function totalLiquidoNota(produtos: number, totais: TotaisNotaNfe) {
  return deCentavos(
    paraCentavos(produtos) -
      paraCentavos(totais.desconto) +
      paraCentavos(totais.frete) +
      paraCentavos(totais.seguro) +
      paraCentavos(totais.outro)
  );
}

export function validarTotaisNota(input: {
  totalProdutos: number;
  totais: TotaisNotaNfe;
}): string | null {
  const totais = normalizarTotaisNota(input.totais);
  const produtosCentavos = paraCentavos(input.totalProdutos);
  if (paraCentavos(totais.desconto) > produtosCentavos) {
    return "O desconto da NF-e não pode ser maior que o total dos produtos.";
  }
  if (totalLiquidoNota(input.totalProdutos, totais) < 0) {
    return "O total da NF-e ficou negativo.";
  }
  return null;
}

export function distribuirValorProporcional(input: {
  valor: number;
  itens: Array<{ id: string; baseCentavos: number }>;
}): Map<string, number> {
  const mapa = new Map<string, number>();
  const valorCentavos = paraCentavos(input.valor);

  for (const item of input.itens) {
    mapa.set(item.id, 0);
  }

  if (valorCentavos <= 0 || input.itens.length === 0) {
    return mapa;
  }

  const elegiveis = input.itens.filter((item) => item.baseCentavos > 0);
  const baseTotal = elegiveis.reduce((soma, item) => soma + item.baseCentavos, 0);

  if (baseTotal <= 0) {
    throw new Error(
      "Não há valor nos itens para ratear frete, seguro ou outras despesas."
    );
  }

  let restante = valorCentavos;
  for (let i = 0; i < elegiveis.length - 1; i += 1) {
    const atual = elegiveis[i];
    const parcela = Math.floor((valorCentavos * atual.baseCentavos) / baseTotal);
    mapa.set(atual.id, deCentavos(parcela));
    restante -= parcela;
  }

  const ultimo = elegiveis[elegiveis.length - 1];
  mapa.set(ultimo.id, deCentavos(restante));
  return mapa;
}
