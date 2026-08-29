import { totalItemNfe } from "@/lib/fiscal/nfe55/item-comercial";
import type { PagamentoRascunhoNfe } from "@/lib/fiscal/nfe55/pagamentos-rascunho";
import {
  normalizarTotaisNota,
  totalLiquidoNota,
  totaisNotaDoSnapshot,
  type TotaisNotaNfe,
} from "@/lib/fiscal/nfe55/totais-nota";

export type ItemVendaParaPrecosComerciaisNfe = {
  produto_id: unknown;
  quantidade: unknown;
  valor_unitario: unknown;
};

export type ItemOperacaoParaPrecosComerciaisNfe = {
  produto_id: unknown;
  quantidade: unknown;
  valor_unitario: unknown;
};

/**
 * Totais fiscais da NF-e de venda.
 * Operação originada na tela NF-e: só snapshot (vOutro explícito).
 * Nunca usa vendas.acrescimo — esse campo pode ser compensação PDV
 * do preço cadastral vs preço editado na NF-e.
 * Venda originada no PDV: acréscimo/desconto/frete comerciais da venda.
 */
export function totaisFiscaisEmissaoNfeVenda(input: {
  origemOperacaoFiscal: boolean;
  snapshotOperacao?: unknown;
  venda?: {
    acrescimo?: unknown;
    desconto?: unknown;
    frete?: unknown;
  };
}): TotaisNotaNfe {
  if (input.origemOperacaoFiscal) {
    return totaisNotaDoSnapshot(input.snapshotOperacao);
  }
  return normalizarTotaisNota({
    frete: input.venda?.frete,
    seguro: 0,
    outro: input.venda?.acrescimo,
    desconto: input.venda?.desconto,
  });
}

export function precosComerciaisOperacaoCompativeis(
  itensVenda: ItemVendaParaPrecosComerciaisNfe[],
  itensOperacao: ItemOperacaoParaPrecosComerciaisNfe[]
) {
  if (
    itensVenda.length === 0 ||
    itensVenda.length !== itensOperacao.length
  ) {
    return false;
  }
  return itensVenda.every(
    (item, indice) =>
      String(itensOperacao[indice]?.produto_id) === String(item.produto_id)
  );
}

/**
 * Substitui quantidade/preço da venda materializada pelos valores
 * efetivamente editados na operação fiscal, na mesma ordem.
 */
export function aplicarPrecosComerciaisOperacaoNosItensVenda<
  T extends ItemVendaParaPrecosComerciaisNfe,
>(itensVenda: T[], itensOperacao: ItemOperacaoParaPrecosComerciaisNfe[]): T[] {
  if (!precosComerciaisOperacaoCompativeis(itensVenda, itensOperacao)) {
    return itensVenda;
  }
  return itensVenda.map((item, indice) => {
    const fiscal = itensOperacao[indice];
    if (!fiscal) {
      return item;
    }
    return {
      ...item,
      quantidade: fiscal.quantidade,
      valor_unitario: fiscal.valor_unitario,
    };
  });
}

export function totaisComerciaisNfeDosItens(input: {
  itens: Array<{ quantidade: number; valorUnitario: number }>;
  totais: TotaisNotaNfe;
}) {
  const vProd = input.itens.reduce(
    (soma, item) => soma + totalItemNfe(item.quantidade, item.valorUnitario),
    0
  );
  return {
    vProd,
    vDesc: input.totais.desconto,
    vFrete: input.totais.frete,
    vSeg: input.totais.seguro,
    vOutro: input.totais.outro,
    vNF: totalLiquidoNota(vProd, input.totais),
  };
}

/**
 * Conferência pré-reserva: operação NF-e usa o total fiscal real
 * (qCom × vUnCom ± totais explícitos), não vendas.valor_total
 * inflado pelo acréscimo de compensação do PDV.
 */
export function totalFiscalEsperadoEmissaoNfeVenda(input: {
  origemOperacaoFiscal: boolean;
  itens: Array<{ quantidade: number; valorUnitario: number }>;
  totais: TotaisNotaNfe;
  valorTotalVenda: number;
}) {
  if (input.origemOperacaoFiscal) {
    return totaisComerciaisNfeDosItens({
      itens: input.itens,
      totais: input.totais,
    }).vNF;
  }
  return input.valorTotalVenda;
}

export type PagamentoVendaParaOverlayNfe = {
  id?: string;
  forma_pagamento_codigo?: string | null;
  forma_pagamento_nome?: string | null;
  codigo_fiscal?: string | null;
  indicador_pagamento?: string | null;
  valor?: number | string | null;
  status?: string | null;
};

export type FormaPagamentoParaOverlayNfe = {
  id: string;
  codigo?: string | null;
  nome?: string | null;
  codigo_fiscal?: string | null;
  permite_parcelamento?: boolean | null;
  permite_fiado?: boolean | null;
};

/**
 * Substitui vendas_pagamentos pelos pagamentos corrigidos no snapshot
 * da operação NF-e. Não reescreve o livro de caixa.
 */
export function aplicarPagamentosRascunhoNaEmissaoNfeVenda<
  T extends PagamentoVendaParaOverlayNfe,
>(input: {
  origemOperacaoFiscal: boolean;
  pagamentosVenda: T[];
  pagamentosRascunho: PagamentoRascunhoNfe[];
  formas: FormaPagamentoParaOverlayNfe[];
}): { ok: true; pagamentos: T[]; overlay: boolean } | { ok: false; erro: string } {
  if (!input.origemOperacaoFiscal || input.pagamentosRascunho.length === 0) {
    return { ok: true, pagamentos: input.pagamentosVenda, overlay: false };
  }
  const formaPorId = new Map(
    input.formas.map((forma) => [String(forma.id), forma])
  );
  const montados: T[] = [];
  for (const rascunho of input.pagamentosRascunho) {
    const forma = formaPorId.get(rascunho.formaPagamentoId);
    if (!forma) {
      return {
        ok: false,
        erro: "Forma de pagamento corrigida na NF-e não foi encontrada.",
      };
    }
    const original = input.pagamentosVenda.find((pagamento) => {
      const codigoForma = String(forma.codigo ?? "").trim();
      const tPagForma = String(forma.codigo_fiscal ?? "").trim();
      if (
        codigoForma &&
        String(pagamento.forma_pagamento_codigo ?? "").trim() === codigoForma
      ) {
        return true;
      }
      if (
        tPagForma &&
        String(pagamento.codigo_fiscal ?? "").trim() === tPagForma
      ) {
        return true;
      }
      return false;
    });
    montados.push({
      id: rascunho.formaPagamentoId,
      forma_pagamento_codigo: forma.codigo ?? null,
      forma_pagamento_nome: forma.nome ?? null,
      codigo_fiscal: forma.codigo_fiscal ?? null,
      indicador_pagamento: forma.permite_fiado
        ? "1"
        : original?.indicador_pagamento === "0" || original?.indicador_pagamento === "1"
          ? original.indicador_pagamento
          : forma.permite_parcelamento
            ? "1"
            : "0",
      valor: rascunho.valorCentavos / 100,
      status: "confirmado",
    } as T);
  }
  return { ok: true, pagamentos: montados, overlay: true };
}

export function trocoEmissaoNfeVenda(input: {
  origemOperacaoFiscal: boolean;
  overlayPagamentos: boolean;
  somaPagamentos: number;
  totalFiscal: number;
  trocoVenda: number;
}) {
  if (input.origemOperacaoFiscal && input.overlayPagamentos) {
    return Math.max(
      0,
      Math.round((input.somaPagamentos - input.totalFiscal) * 100) / 100
    );
  }
  return input.trocoVenda;
}
