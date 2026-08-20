import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { pagamentoFinanceiramenteValido } from "@/lib/vendas/pagamentos-financeiros";
import { dataVenda, noIntervalo } from "./periodo";
import { numeroSeguro } from "./formatacao";
import {
  STATUS_VENDA_CANCELADA,
  STATUS_VENDA_VALIDA,
} from "./tipos";

export type VendaRelatorio = {
  id: string;
  empresa_id?: string | null;
  status: string;
  valor_total?: number | string | null;
  desconto?: number | string | null;
  finalizada_at?: string | null;
  created_at: string;
};

export type PagamentoRelatorio = {
  empresa_id?: string | null;
  venda_id: string;
  forma_pagamento_id?: string | null;
  forma_pagamento_nome?: string | null;
  forma_pagamento_codigo?: string | null;
  valor?: number | string | null;
  status?: string | null;
};

export type ItemVendaRelatorio = {
  empresa_id?: string | null;
  venda_id: string;
  produto_id?: string | null;
  produto_codigo?: string | null;
  produto_nome?: string | null;
  quantidade?: number | string | null;
  valor_unitario?: number | string | null;
  valor_total?: number | string | null;
};

export function vendasDaEmpresaAtiva<T extends { empresa_id?: string | null }>(
  registros: T[] | null | undefined,
  empresaId: string
) {
  return filtrarRegistrosDaEmpresaAtiva(registros, empresaId);
}

export function vendaValidaParaFaturamento(status: string | null | undefined) {
  return status === STATUS_VENDA_VALIDA;
}

export function vendaCancelada(status: string | null | undefined) {
  return status === STATUS_VENDA_CANCELADA;
}

export function vendasNoPeriodo<T extends VendaRelatorio>(
  vendas: T[],
  inicio: Date,
  fim: Date
) {
  return vendas.filter((venda) =>
    noIntervalo(dataVenda(venda), inicio, fim)
  );
}

export function vendasParaFaturamento<T extends VendaRelatorio>(vendas: T[]) {
  return vendas.filter((venda) => vendaValidaParaFaturamento(venda.status));
}

export function faturamentoVendas(vendas: VendaRelatorio[]) {
  return vendasParaFaturamento(vendas).reduce(
    (total, venda) => total + numeroSeguro(venda.valor_total),
    0
  );
}

export function quantidadeVendasValidas(vendas: VendaRelatorio[]) {
  return vendasParaFaturamento(vendas).length;
}

export function ticketMedio(faturamento: number, quantidade: number) {
  if (quantidade <= 0) {
    return 0;
  }
  return faturamento / quantidade;
}

export function totalDescontos(vendas: VendaRelatorio[]) {
  return vendasParaFaturamento(vendas).reduce(
    (total, venda) => total + numeroSeguro(venda.desconto),
    0
  );
}

export function quantidadeItensVendidos(
  itens: ItemVendaRelatorio[],
  idsVendasValidas: Set<string>
) {
  return itens
    .filter((item) => idsVendasValidas.has(item.venda_id))
    .reduce((total, item) => total + numeroSeguro(item.quantidade), 0);
}

export function somarPagamentosPorForma(
  pagamentos: PagamentoRelatorio[],
  idsVendasValidas: Set<string>
) {
  const mapa = new Map<string, { nome: string; operacoes: number; valor: number }>();

  for (const pagamento of pagamentos) {
    if (
      !idsVendasValidas.has(pagamento.venda_id) ||
      !pagamentoFinanceiramenteValido(pagamento.status)
    ) {
      continue;
    }

    const nome =
      String(pagamento.forma_pagamento_nome ?? "").trim() ||
      String(pagamento.forma_pagamento_codigo ?? "").trim() ||
      "Pagamento";
    const atual = mapa.get(nome) ?? { nome, operacoes: 0, valor: 0 };
    atual.operacoes += 1;
    atual.valor += numeroSeguro(pagamento.valor);
    mapa.set(nome, atual);
  }

  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}

export function paginarSemAlterarTotais<T>(
  registros: T[],
  pagina: number,
  porPagina: number
) {
  const tamanho = porPagina > 0 ? porPagina : 50;
  const atual = Math.max(1, pagina);
  const inicio = (atual - 1) * tamanho;
  return {
    total: registros.length,
    pagina: atual,
    porPagina: tamanho,
    registros: registros.slice(inicio, inicio + tamanho),
  };
}

export function ultimaCompraPorCliente(
  vendas: Array<{
    cliente_id?: string | null;
    status: string;
    finalizada_at?: string | null;
    created_at: string;
  }>
) {
  const mapa = new Map<string, string>();
  for (const venda of vendas) {
    if (!venda.cliente_id || !vendaValidaParaFaturamento(venda.status)) {
      continue;
    }
    const data = dataVenda(venda);
    const atual = mapa.get(venda.cliente_id);
    if (!atual || data > atual) {
      mapa.set(venda.cliente_id, data);
    }
  }
  return mapa;
}

export function clienteSemComprarHa(
  ultimaIso: string | null | undefined,
  dias: number,
  agora = Date.now()
) {
  if (dias <= 0) {
    return true;
  }
  if (!ultimaIso) {
    return true;
  }
  return new Date(ultimaIso).getTime() < agora - dias * 24 * 60 * 60 * 1000;
}

export function situacaoEstoque(params: {
  quantidade: number;
  estoqueMinimo: number;
}) {
  if (params.quantidade < 0) {
    return "negativo";
  }
  if (params.quantidade <= 0) {
    return "sem";
  }
  if (params.estoqueMinimo > 0 && params.quantidade <= params.estoqueMinimo) {
    return "baixo";
  }
  return "com";
}
