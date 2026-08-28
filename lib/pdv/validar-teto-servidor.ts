import {
  MENSAGEM_PAGAMENTOS_ULTRAPASSAM,
  avaliarPagamentosPdv,
  formatarCentavosBr,
  recalcularTotalLiquidoVenda,
} from "./pagamentos-teto";

type ClienteConsulta = {
  // O client real do Supabase tem genéricos profundos demais para
  // descrever select/eq/in sem TS2589. O contrato usado aqui é só
  // .from().select().eq().in().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tabela: string) => any;
};

export async function avaliarTetoPagamentosNoServidor(params: {
  supabase: ClienteConsulta;
  empresaId: string;
  itens: Array<{
    produtoId: string;
    quantidade: number;
    precoUnitarioCentavos?: number;
  }>;
  descontoCentavos: number;
  freteCentavos?: number;
  acrescimoCentavos?: number;
  pagamentos: Array<{
    formaPagamentoId: string;
    valorCentavos: number;
  }>;
  rejeitarPagamentoIncompleto?: boolean;
}): Promise<
  | {
      ok: true;
      trocoCentavos: number;
      totalVendaCentavos: number;
      restanteCentavos: number;
    }
  | {
      ok: false;
      erro: string;
    }
> {
  const produtoIds = [
    ...new Set(params.itens.map((item) => item.produtoId)),
  ];
  const { data: produtos, error: erroProdutos } = await params.supabase
    .from("produtos")
    .select("id, preco_venda")
    .eq("empresa_id", params.empresaId)
    .in("id", produtoIds);

  if (erroProdutos || !produtos) {
    return {
      ok: false,
      erro: "Não foi possível validar os produtos da venda.",
    };
  }

  const precoPorId = new Map<string, number>(
    produtos.map((produto: { id: string; preco_venda: number | string }) => [
      produto.id,
      Math.round(Number(produto.preco_venda) * 100),
    ])
  );

  if (produtoIds.some((id) => !precoPorId.has(id))) {
    return {
      ok: false,
      erro: "Produto não encontrado.",
    };
  }

  const totalVendaCentavos = recalcularTotalLiquidoVenda({
    itens: params.itens.map((item) => ({
      quantidade: item.quantidade,
      precoUnitarioCentavos:
        item.precoUnitarioCentavos != null &&
        Number.isFinite(item.precoUnitarioCentavos)
          ? Math.round(item.precoUnitarioCentavos)
          : precoPorId.get(item.produtoId) ?? 0,
    })),
    descontoCentavos: params.descontoCentavos,
    freteCentavos: params.freteCentavos,
    acrescimoCentavos: params.acrescimoCentavos,
  });

  const formaIds = [
    ...new Set(params.pagamentos.map((pagamento) => pagamento.formaPagamentoId)),
  ];
  const { data: formas, error: erroFormas } = await params.supabase
    .from("formas_pagamento")
    .select("id, permite_troco")
    .eq("empresa_id", params.empresaId)
    .in("id", formaIds);

  if (erroFormas || !formas) {
    return {
      ok: false,
      erro: "Não foi possível validar as formas de pagamento.",
    };
  }

  const permiteTrocoPorId = new Map<string, boolean>(
    formas.map((forma: { id: string; permite_troco: boolean | null }) => [
      forma.id,
      forma.permite_troco === true,
    ])
  );

  if (formaIds.some((id) => !permiteTrocoPorId.has(id))) {
    return {
      ok: false,
      erro: "Forma de pagamento inválida.",
    };
  }

  const avaliacao = avaliarPagamentosPdv({
    totalVendaCentavos,
    pagamentos: params.pagamentos.map((pagamento) => ({
      valorCentavos: pagamento.valorCentavos,
      permiteTroco:
        permiteTrocoPorId.get(pagamento.formaPagamentoId) === true,
    })),
  });

  if (avaliacao.bloqueado) {
    return {
      ok: false,
      erro: avaliacao.mensagem ?? MENSAGEM_PAGAMENTOS_ULTRAPASSAM,
    };
  }

  if (params.rejeitarPagamentoIncompleto && avaliacao.restanteCentavos > 0) {
    return {
      ok: false,
      erro: `Pagamentos não conferem com o total da venda. Faltam ${formatarCentavosBr(avaliacao.restanteCentavos)}.`,
    };
  }

  return {
    ok: true,
    trocoCentavos: avaliacao.trocoCentavos,
    totalVendaCentavos,
    restanteCentavos: avaliacao.restanteCentavos,
  };
}
