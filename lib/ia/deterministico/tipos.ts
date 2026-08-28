import type {
  ContextoDeterministicoAssistente,
  NomeFerramentaIa,
  PeriodoAssistente,
} from "../tipos";

export const NOMES_INTENCAO_DETERMINISTICA = [
  "vendas.resumo",
  "vendas.comparativo",
  "vendas.ranking_produtos",
  "vendas.formas",
  "vendas.maior",
  "vendas.ticket",
  "carteira.maior_devedor",
  "carteira.vencidos",
  "carteira.totais",
  "carteira.cliente",
  "estoque.zerados",
  "estoque.negativos",
  "estoque.baixo",
  "produto.consulta",
  "clientes.ranking",
  "clientes.compras",
  "caixa.status",
  "notificacoes.resumo",
  "fiscal.notas_rejeitadas",
  "fiscal.reconciliacao",
  "fiscal.diagnostico",
  "fiscal.ncm_cadastrado",
  "fiscal.ncm_vigente",
  "fiscal.cest",
  "fiscal.ibs_cbs",
  "fiscal.grupo",
] as const;

export type NomeIntencaoDeterministica =
  (typeof NOMES_INTENCAO_DETERMINISTICA)[number];

export type ContextoInterpretacaoDeterministica = {
  empresaId: string;
  produtoIdTela?: string | null;
  clienteIdTela?: string | null;
  emissaoIdTela?: string | null;
  vendaIdTela?: string | null;
  anterior?: ContextoDeterministicoAssistente | null;
};

export type IntencaoResolvida = {
  nome: NomeIntencaoDeterministica;
  confianca: number;
  periodo: PeriodoAssistente;
  busca: string | null;
  clienteId: string | null;
  produtoId: string | null;
  foco: string | null;
  ferramenta: NomeFerramentaIa;
  encadear: NomeFerramentaIa[];
  args: Record<string, unknown>;
};

export type DefinicaoIntencao = {
  nome: NomeIntencaoDeterministica;
  padroes: Array<{ re: RegExp; pontos: number }>;
  requerContexto?: "cliente" | "produto" | "nota";
  ferramenta: NomeFerramentaIa;
  encadear?: NomeFerramentaIa[];
  args: (ctx: {
    periodo: PeriodoAssistente;
    busca: string | null;
    clienteId: string | null;
    produtoId: string | null;
  }) => Record<string, unknown>;
};
