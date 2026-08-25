export const STATUS_CAIXA = ["aberto", "fechado", "cancelado"] as const;
export type StatusCaixa = (typeof STATUS_CAIXA)[number];

export const TIPOS_MOVIMENTO_CAIXA = [
  "abertura",
  "suprimento",
  "sangria",
  "ajuste",
  "venda",
  "recebimento_carteira",
  "estorno_recebimento",
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
  forma_nome: string | null;
  forma_tipo: string | null;
  forma_codigo: string | null;
  permite_troco_snapshot: boolean;
  afeta_caixa_fisico_snapshot: boolean;
  venda_id: string | null;
  venda_numero: number | null;
  cliente_nome: string | null;
  entrada: number;
  saida: number;
  valor_liquido: number;
  descricao: string | null;
  usuario_id: string;
  usuario_nome: string | null;
  estorno_de_id: string | null;
  created_at: string;
  valores_ocultos?: boolean;
};

export type CaixaReabertura = {
  id: string;
  fechamento_id: string;
  reaberto_em: string;
  reaberto_por_id: string;
  reaberto_por_nome: string | null;
  motivo: string;
};

export type CaixaCicloFechamento = {
  id: string;
  versao: number;
  fechado_em: string;
  fechado_por_id: string;
  fechado_por_nome: string | null;
  dinheiro_contado: number;
  dinheiro_fisico_esperado: number;
  diferenca: number;
  observacao: string | null;
  fechamento_cego: boolean;
  meios: CaixaFechamentoMeio[];
};

export type CaixaAvisoReaberto = {
  reaberto_em: string;
  reaberto_por_nome: string | null;
  motivo: string;
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
  reaberto: boolean;
  reaberturas: CaixaReabertura[];
  ciclos_fechamento: CaixaCicloFechamento[];
};

export type CaixaTotais = {
  saldoInicial: number;
  suprimentos: number;
  sangrias: number;
  outrasEntradas: number;
  outrasSaidas: number;
  entradas: number;
  saidas: number;
  saldoAtual: number | null;
  vendasTotal: number;
  vendasDinheiro: number | null;
  vendasPix: number;
  vendasCredito: number;
  vendasDebito: number;
  vendasOutros: number;
  recebimentosCarteira: number;
  estornos: number;
  meiosPix: number;
  meiosCredito: number;
  meiosDebito: number;
  meiosOutros: number;
};

export type StatusDiferencaCaixa = "conferido" | "falta" | "sobra";

export type CaixaFechamentoMeio = {
  chave: string;
  forma_pagamento_id: string | null;
  forma_nome_snapshot: string;
  forma_tipo_snapshot: string | null;
  forma_codigo_snapshot: string | null;
  afeta_caixa_fisico_snapshot: boolean;
  valor_esperado: number;
  valor_informado: number;
  diferenca: number;
};

export type MeioConferenciaCaixa = {
  chave: string;
  forma_pagamento_id: string | null;
  forma_nome: string;
  forma_tipo: string | null;
  forma_codigo: string | null;
  afeta_caixa_fisico: boolean;
  valor_esperado?: number;
  valor_informado?: number;
  diferenca?: number;
  status?: StatusDiferencaCaixa;
};

export type ConferenciaCaixa = {
  caixa_id: string;
  numero: number;
  aberto_em: string;
  usuario_abertura_id: string;
  versao_livro: string;
  movimentos_qtd: number;
  fechamento_cego: boolean;
  saldo_inicial: number;
  vendas_liquidas: number;
  recebimentos_carteira: number;
  suprimentos: number;
  sangrias: number;
  estornos: number;
  dinheiro_fisico_esperado?: number;
  meios: MeioConferenciaCaixa[];
};

export type CaixaResumoAnterior = CaixaSessao &
  CaixaTotais & {
    movimentos: CaixaMovimento[];
    conferencia: CaixaFechamentoMeio[];
  };

export type PainelCaixa = {
  atual: (CaixaSessao & CaixaTotais & { movimentos: CaixaMovimento[] }) | null;
  anteriores: CaixaResumoAnterior[];
  fechamentoCego: boolean;
  controleAtivo: boolean;
  caixaReabrirElegivelId: string | null;
};
