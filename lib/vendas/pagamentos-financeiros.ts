/**
 * Regra única de pagamentos líquidos da venda.
 *
 * Tabela: public.vendas_pagamentos
 * Status reais persistidos pelo PDV / rpc_editar_venda_pdv /
 * cancelamento comercial:
 *   - confirmado → vigente, entra no financeiro
 *   - cancelado  → auditoria da edição/cancelamento, não entra no financeiro
 *
 * pagamentos_liquidos = soma(valor dos confirmados) − troco da venda
 */
export const STATUS_PAGAMENTO_VENDA = {
  confirmado: "confirmado",
  cancelado: "cancelado",
} as const;

export type StatusPagamentoVenda =
  (typeof STATUS_PAGAMENTO_VENDA)[keyof typeof STATUS_PAGAMENTO_VENDA];

export type PagamentoFinanceiro = {
  status?: string | null;
  valor?: number | string | null;
};

export function pagamentoFinanceiramenteValido(
  status: string | null | undefined
) {
  return status === STATUS_PAGAMENTO_VENDA.confirmado;
}

export function filtrarPagamentosFinanceiros<T extends PagamentoFinanceiro>(
  pagamentos: T[]
) {
  return pagamentos.filter((pagamento) =>
    pagamentoFinanceiramenteValido(pagamento.status)
  );
}

export function filtrarPagamentosHistorico<T extends PagamentoFinanceiro>(
  pagamentos: T[]
) {
  return pagamentos.filter(
    (pagamento) => !pagamentoFinanceiramenteValido(pagamento.status)
  );
}

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function somarValoresPagamento(pagamentos: PagamentoFinanceiro[]) {
  return pagamentos.reduce(
    (total, pagamento) => total + numero(pagamento.valor),
    0
  );
}

export function somarPagamentosLiquidos(params: {
  pagamentos: PagamentoFinanceiro[];
  troco?: number | string | null;
}) {
  return (
    somarValoresPagamento(filtrarPagamentosFinanceiros(params.pagamentos)) -
    numero(params.troco)
  );
}

export function conferenciaFinanceiraVenda(params: {
  valorTotal: number | string | null;
  pagamentos: PagamentoFinanceiro[];
  troco?: number | string | null;
  tolerancia?: number;
}) {
  const valorVenda = numero(params.valorTotal);
  const pagamentosLiquidos = somarPagamentosLiquidos({
    pagamentos: params.pagamentos,
    troco: params.troco,
  });
  const diferenca = Math.abs(pagamentosLiquidos - valorVenda);

  return {
    valorVenda,
    pagamentosLiquidos,
    diferenca,
    ok: diferenca <= (params.tolerancia ?? 0.01),
  };
}
