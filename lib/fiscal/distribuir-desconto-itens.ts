export class DistribuicaoDescontoFiscalError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "DistribuicaoDescontoFiscalError";
  }
}

export type ItemParaDescontoFiscal = {
  id: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
};

export type ItemDescontoFiscal = {
  id: string;
  valorBruto: number;
  descontoItem: number;
  descontoGeralRateado: number;
  descontoFiscal: number;
};

export type ResultadoDistribuicaoDesconto = {
  descontoItensExistente: number;
  descontoGeral: number;
  itens: ItemDescontoFiscal[];
};

export function paraCentavos(
  valor: number | string | null | undefined
) {
  const numero = Number(valor ?? 0);

  if (!Number.isFinite(numero)) {
    return 0;
  }

  return Math.round(numero * 100);
}

export function deCentavos(centavos: number) {
  return centavos / 100;
}

export function valorBrutoItemEmCentavos(input: {
  quantidade: number;
  valorUnitario: number;
}) {
  return paraCentavos(input.quantidade * input.valorUnitario);
}

/**
 * Líquido para conferir vendas.valor_total.
 * Não usar item.valorTotal da Geranet — esse campo é o bruto.
 */
export function valorLiquidoFiscalEmCentavos(input: {
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  frete?: number;
  seguro?: number;
  outro?: number;
}) {
  return paraCentavos(
    input.quantidade * input.valorUnitario -
      input.desconto +
      (input.frete ?? 0) +
      (input.seguro ?? 0) +
      (input.outro ?? 0)
  );
}

export const valorTotalItemGeranetEmCentavos =
  valorLiquidoFiscalEmCentavos;

export function distribuirDescontoItens(input: {
  descontoVenda: number;
  itens: ItemParaDescontoFiscal[];
}): ResultadoDistribuicaoDesconto {
  if (!input.itens.length) {
    throw new DistribuicaoDescontoFiscalError(
      "A venda não possui itens para distribuir o desconto fiscal."
    );
  }

  const preparados = input.itens.map((item) => {
    const valorBrutoCentavos = paraCentavos(
      item.quantidade * item.valorUnitario
    );
    const descontoItemCentavos = paraCentavos(item.desconto);

    if (descontoItemCentavos < 0) {
      throw new DistribuicaoDescontoFiscalError(
        "Desconto do item não pode ser negativo."
      );
    }

    if (descontoItemCentavos > valorBrutoCentavos) {
      throw new DistribuicaoDescontoFiscalError(
        "O desconto do item é maior que o valor do próprio item. Nenhum número foi reservado."
      );
    }

    return {
      id: item.id,
      valorBrutoCentavos,
      descontoItemCentavos,
      liquidoCentavos: valorBrutoCentavos - descontoItemCentavos,
      descontoGeralCentavos: 0,
    };
  });

  const descontoItensExistenteCentavos = preparados.reduce(
    (total, item) => total + item.descontoItemCentavos,
    0
  );
  const descontoVendaCentavos = paraCentavos(input.descontoVenda);
  const descontoGeralCentavos =
    descontoVendaCentavos - descontoItensExistenteCentavos;

  if (descontoGeralCentavos > 0) {
    const elegiveis = preparados
      .map((item, indice) => ({ item, indice }))
      .filter(({ item }) => item.liquidoCentavos > 0);

    const baseTotal = elegiveis.reduce(
      (total, atual) => total + atual.item.liquidoCentavos,
      0
    );

    if (baseTotal <= 0) {
      throw new DistribuicaoDescontoFiscalError(
        "Não há valor restante nos itens para ratear o desconto geral. Nenhum número foi reservado."
      );
    }

    let restante = descontoGeralCentavos;

    for (let i = 0; i < elegiveis.length - 1; i += 1) {
      const atual = elegiveis[i];
      const parcela = Math.min(
        atual.item.liquidoCentavos,
        Math.floor(
          (descontoGeralCentavos * atual.item.liquidoCentavos) /
            baseTotal
        )
      );

      atual.item.descontoGeralCentavos = parcela;
      restante -= parcela;
    }

    const ultimo = elegiveis[elegiveis.length - 1];
    const noUltimo = Math.min(ultimo.item.liquidoCentavos, restante);
    ultimo.item.descontoGeralCentavos = noUltimo;
    restante -= noUltimo;

    if (restante > 0) {
      for (let i = elegiveis.length - 2; i >= 0; i -= 1) {
        const atual = elegiveis[i];
        const folga =
          atual.item.liquidoCentavos - atual.item.descontoGeralCentavos;
        const usar = Math.min(folga, restante);

        atual.item.descontoGeralCentavos += usar;
        restante -= usar;

        if (restante === 0) {
          break;
        }
      }
    }

    if (restante > 0) {
      throw new DistribuicaoDescontoFiscalError(
        "O desconto geral deixaria um item fiscal negativo. Nenhum número foi reservado."
      );
    }
  }

  const itens = preparados.map((item) => {
    const descontoFiscalCentavos =
      item.descontoItemCentavos + item.descontoGeralCentavos;

    if (descontoFiscalCentavos > item.valorBrutoCentavos) {
      throw new DistribuicaoDescontoFiscalError(
        "O desconto fiscal do item ficou maior que o valor do próprio item. Nenhum número foi reservado."
      );
    }

    return {
      id: item.id,
      valorBruto: deCentavos(item.valorBrutoCentavos),
      descontoItem: deCentavos(item.descontoItemCentavos),
      descontoGeralRateado: deCentavos(item.descontoGeralCentavos),
      descontoFiscal: deCentavos(descontoFiscalCentavos),
    };
  });

  if (descontoGeralCentavos > 0) {
    const somaDescontos = itens.reduce(
      (total, item) => total + paraCentavos(item.descontoFiscal),
      0
    );

    if (somaDescontos !== descontoVendaCentavos) {
      throw new DistribuicaoDescontoFiscalError(
        "A soma dos descontos fiscais não fecha com o desconto da venda. Nenhum número foi reservado."
      );
    }
  }

  return {
    descontoItensExistente: deCentavos(descontoItensExistenteCentavos),
    descontoGeral: deCentavos(Math.max(descontoGeralCentavos, 0)),
    itens,
  };
}

export function mapaDescontoFiscalPorItem(
  resultado: ResultadoDistribuicaoDesconto
) {
  return new Map(
    resultado.itens.map((item) => [item.id, item.descontoFiscal])
  );
}

export type ItemFiscalParaTotalNota = {
  valorTotal?: unknown;
  desconto?: unknown;
  quantidade?: unknown;
  valorUnitario?: unknown;
  frete?: unknown;
  seguro?: unknown;
  outro?: unknown;
};

export function somaLiquidoFiscalItensEmCentavos(
  itensFiscais: ItemFiscalParaTotalNota[]
) {
  let somaLiquidoCentavos = 0;

  for (const [indice, item] of itensFiscais.entries()) {
    const liquidoItemCentavos = valorLiquidoFiscalEmCentavos({
      quantidade: Number(item.quantidade ?? 0),
      valorUnitario: Number(item.valorUnitario ?? 0),
      desconto: Number(item.desconto ?? 0),
      frete: Number(item.frete ?? 0),
      seguro: Number(item.seguro ?? 0),
      outro: Number(item.outro ?? 0),
    });

    if (liquidoItemCentavos < 0) {
      return {
        ok: false as const,
        erro: `O item fiscal ${indice + 1} ficou negativo. Nenhum número foi reservado.`,
      };
    }

    somaLiquidoCentavos += liquidoItemCentavos;
  }

  return {
    ok: true as const,
    centavos: somaLiquidoCentavos,
  };
}

/**
 * Total líquido da nota (vNF / nfe.valorTotal).
 * Mesma soma da conferência pré-reserva. Não é item.valorTotal (bruto).
 */
export function valorTotalNotaGeranet(
  itensFiscais: ItemFiscalParaTotalNota[]
) {
  const soma = somaLiquidoFiscalItensEmCentavos(itensFiscais);

  if (!soma.ok) {
    throw new Error(soma.erro);
  }

  return deCentavos(soma.centavos).toFixed(2);
}

export function conferirSomaItensFiscaisComVenda(input: {
  itensFiscais: ItemFiscalParaTotalNota[];
  valorTotalVenda: number;
}) {
  const soma = somaLiquidoFiscalItensEmCentavos(input.itensFiscais);

  if (!soma.ok) {
    return soma.erro;
  }

  if (soma.centavos !== paraCentavos(input.valorTotalVenda)) {
    return "Soma dos itens fiscais diverge do total da venda. Nenhum número foi reservado.";
  }

  return null;
}
