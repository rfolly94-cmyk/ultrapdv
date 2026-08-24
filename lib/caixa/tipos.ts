export const STATUS_CAIXA = ["aberto", "fechado", "cancelado"] as const;
export type StatusCaixa = (typeof STATUS_CAIXA)[number];

export const TIPOS_MOVIMENTO_CAIXA = [
  "abertura",
  "suprimento",
  "sangria",
  "ajuste",
] as const;
export type TipoMovimentoCaixa = (typeof TIPOS_MOVIMENTO_CAIXA)[number];

export const ABAS_CAIXA = ["atual", "anteriores"] as const;
export type AbaCaixa = (typeof ABAS_CAIXA)[number];

export type CaixaMovimento = {
  id: string;
  caixa_id: string;
  tipo: TipoMovimentoCaixa;
  origem_tipo: string | null;
  origem_id: string | null;
  forma_pagamento_id: string | null;
  entrada: number;
  saida: number;
  descricao: string | null;
  usuario_id: string;
  usuario_nome: string | null;
  estorno_de_id: string | null;
  created_at: string;
};

export type CaixaSessao = {
  id: string;
  empresa_id: string;
  filial_id: string | null;
  numero: number;
  usuario_abertura_id: string;
  usuario_abertura_nome: string | null;
  usuario_fechamento_id: string | null;
  usuario_fechamento_nome: string | null;
  saldo_inicial: number;
  dinheiro_contado: number | null;
  diferenca: number | null;
  aberto_em: string;
  fechado_em: string | null;
  status: StatusCaixa;
  observacao_abertura: string | null;
  observacao_fechamento: string | null;
};

export type CaixaTotais = {
  saldoInicial: number;
  suprimentos: number;
  sangrias: number;
  outrasEntradas: number;
  outrasSaidas: number;
  entradas: number;
  saidas: number;
  saldoAtual: number;
};

export type CaixaResumoAnterior = CaixaSessao &
  CaixaTotais & { movimentos: CaixaMovimento[] };

export type PainelCaixa = {
  atual: (CaixaSessao & CaixaTotais & { movimentos: CaixaMovimento[] }) | null;
  anteriores: CaixaResumoAnterior[];
};
