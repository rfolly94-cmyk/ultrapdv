import { compensarDiferencaSubtotalCatalogo } from "@/lib/fiscal/nfe55/sincronizar-pagamentos";

/**
 * Apresentação do recibo quando a venda nasceu de uma NF-e.
 *
 * Não há venda_item_id em fiscal_operacoes_itens. A correspondência usa
 * produto_id, consumindo cada linha fiscal uma vez, na ordem de created_at
 * dentro do mesmo produto. Dois lançamentos do mesmo produto não se cruzam
 * com outro produto, e uma contagem diferente impede o overlay.
 *
 * A compensação de preço reutiliza compensarDiferencaSubtotalCatalogo.
 * vendas.acrescimo e vendas.desconto podem misturar essa compensação com
 * seguro, outras despesas e desconto comercial. Só a parcela artificial sai
 * da linha impressa.
 */

export type ItemReciboComercial = {
  produtoId: string | null;
  codigo: string;
  nome: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  total: number;
};

export type ItemReciboFiscal = {
  produtoId: string;
  quantidade: number;
  valorUnitario: number;
  total: number;
};

export type ItemReciboExibicao = {
  codigo: string;
  nome: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  total: number;
};

export type ApresentacaoReciboVenda = {
  itens: ItemReciboExibicao[];
  valorProdutos: number;
  desconto: number;
  acrescimo: number;
  frete: number;
  total: number;
  diagnosticoComposicao: string | null;
};

function centavos(valor: number) {
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.round(n * 100);
}

function reais(centavosValor: number) {
  return centavosValor / 100;
}

function subtotalCentavos(totais: number[]) {
  return totais.reduce((soma, total) => soma + centavos(total), 0);
}

function itemComercialExibicao(item: ItemReciboComercial): ItemReciboExibicao {
  return {
    codigo: item.codigo,
    nome: item.nome,
    quantidade: item.quantidade,
    valorUnitario: item.valorUnitario,
    desconto: item.desconto,
    total: item.total,
  };
}

/**
 * Emparelha cada item comercial com uma linha fiscal ainda não usada
 * do mesmo produto_id. A fila de cada produto segue created_at.
 */
export function relacionarItensReciboOperacaoFiscal(
  comerciais: ItemReciboComercial[],
  fiscais: ItemReciboFiscal[]
):
  | { ok: true; pares: Array<{ comercial: ItemReciboComercial; fiscal: ItemReciboFiscal }> }
  | { ok: false; motivo: string } {
  const filaPorProduto = new Map<string, ItemReciboFiscal[]>();
  for (const fiscal of fiscais) {
    const produtoId = fiscal.produtoId.trim();
    if (!produtoId) {
      return { ok: false, motivo: "Item da operação fiscal sem produto_id." };
    }
    const fila = filaPorProduto.get(produtoId) ?? [];
    fila.push(fiscal);
    filaPorProduto.set(produtoId, fila);
  }

  const pares: Array<{ comercial: ItemReciboComercial; fiscal: ItemReciboFiscal }> = [];
  for (const comercial of comerciais) {
    const produtoId = comercial.produtoId?.trim() ?? "";
    if (!produtoId) {
      return {
        ok: false,
        motivo: "Item comercial sem produto_id não pode ser ligado à operação fiscal.",
      };
    }
    const fiscal = filaPorProduto.get(produtoId)?.shift();
    if (!fiscal) {
      return {
        ok: false,
        motivo: `Produto ${produtoId} da venda não tem correspondente na operação fiscal.`,
      };
    }
    pares.push({ comercial, fiscal });
  }

  for (const [produtoId, restantes] of filaPorProduto) {
    if (restantes.length > 0) {
      return {
        ok: false,
        motivo: `Produto ${produtoId} tem item fiscal sem correspondente na venda.`,
      };
    }
  }

  return { ok: true, pares };
}

export function apresentarReciboVenda(input: {
  itensComerciais: ItemReciboComercial[];
  itensFiscais: ItemReciboFiscal[] | null;
  valorProdutos: number;
  desconto: number;
  acrescimo: number;
  frete: number;
  total: number;
}): ApresentacaoReciboVenda {
  const frete = reais(centavos(input.frete));
  const total = reais(centavos(input.total));
  const comercial: ApresentacaoReciboVenda = {
    itens: input.itensComerciais.map(itemComercialExibicao),
    valorProdutos: reais(centavos(input.valorProdutos)),
    desconto: reais(centavos(input.desconto)),
    acrescimo: reais(centavos(input.acrescimo)),
    frete,
    total,
    diagnosticoComposicao: null,
  };

  if (!input.itensFiscais) {
    return comercial;
  }

  const relacao = relacionarItensReciboOperacaoFiscal(
    input.itensComerciais,
    input.itensFiscais
  );
  if (!relacao.ok) {
    return {
      ...comercial,
      diagnosticoComposicao: `${relacao.motivo} O recibo manteve os valores comerciais da venda.`,
    };
  }

  const subtotalCatalogoCentavos = subtotalCentavos(
    relacao.pares.map((par) => par.comercial.total)
  );
  const subtotalOperacaoCentavos = subtotalCentavos(
    relacao.pares.map((par) => par.fiscal.total)
  );
  const compensacao = compensarDiferencaSubtotalCatalogo({
    subtotalCatalogoCentavos,
    subtotalAlvoCentavos: subtotalOperacaoCentavos,
    descontoCentavos: 0,
    acrescimoCentavos: 0,
  });
  const descontoVisivel = Math.max(
    0,
    centavos(input.desconto) - compensacao.descontoCentavos
  );
  const acrescimoVisivel = Math.max(
    0,
    centavos(input.acrescimo) - compensacao.acrescimoCentavos
  );
  const itens = relacao.pares.map(({ comercial: item, fiscal }) => ({
    codigo: item.codigo,
    nome: item.nome,
    quantidade: fiscal.quantidade,
    valorUnitario: fiscal.valorUnitario,
    desconto: item.desconto,
    total: fiscal.total,
  }));
  const subtotalExibido = subtotalCentavos(itens.map((item) => item.total));
  const composto =
    subtotalExibido - descontoVisivel + acrescimoVisivel + centavos(input.frete);
  const totalCentavos = centavos(input.total);
  const diverge = composto !== totalCentavos;

  return {
    itens,
    valorProdutos: reais(subtotalExibido),
    desconto: reais(descontoVisivel),
    acrescimo: reais(acrescimoVisivel),
    frete,
    total,
    diagnosticoComposicao: diverge
      ? `Composição exibida (${reais(subtotalExibido)} - ${reais(descontoVisivel)} + ${reais(acrescimoVisivel)} + frete ${frete} = ${reais(composto)}) difere de vendas.valor_total ${total}. O total impresso permanece o da venda.`
      : null,
  };
}
