import type { RecursoFerramentaIa } from "../permissoes";
import type { PeriodoAssistente } from "../tipos";

export const NOMES_METRICA_ANALITICA = [
  "faturamento",
  "quantidade_vendas",
  "quantidade_vendida",
  "ticket_medio",
  "desconto",
  "custo_vendido",
  "margem_bruta",
  "margem_percentual",
  "estoque_atual",
  "estoque_minimo",
  "valor_estoque_custo",
  "valor_estoque_venda",
  "quantidade_produtos",
  "produtos_zerados",
  "produtos_negativos",
  "produtos_abaixo_minimo",
  "saldo_aberto",
  "saldo_vencido",
  "recebimentos",
  "quantidade_devedores",
  "quantidade_compras",
  "valor_comprado",
  "ticket_cliente",
  "ultima_compra",
  "entradas",
  "saidas",
  "saldo_esperado",
  "giro_estoque",
  "cobertura_estoque_dias",
  "valor_imobilizado",
  "participacao_no_faturamento",
  "crescimento_periodo",
  "inadimplencia_cliente",
  "produtos_revisao_fiscal",
  "grupos_fiscais_incompativeis",
  "notas_rejeitadas",
] as const;

export type NomeMetricaAnalitica = (typeof NOMES_METRICA_ANALITICA)[number];

export const NOMES_DIMENSAO_ANALITICA = [
  "produto",
  "categoria",
  "marca",
  "cliente",
  "vendedor",
  "forma_pagamento",
  "dia",
  "semana",
  "mes",
  "ano",
] as const;

export type NomeDimensaoAnalitica = (typeof NOMES_DIMENSAO_ANALITICA)[number];

export const OPERADORES_FILTRO_ANALITICO = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
] as const;

export type OperadorFiltroAnalitico = (typeof OPERADORES_FILTRO_ANALITICO)[number];

export const CAMPOS_FILTRO_ANALITICO = [
  "produto_id",
  "categoria_id",
  "marca_id",
  "cliente_id",
  "forma_pagamento",
  "estoque_atual",
  "estoque_minimo",
  "saldo_vencido",
  "ativo",
  "situacao_estoque",
  "ids",
] as const;

export type CampoFiltroAnalitico = (typeof CAMPOS_FILTRO_ANALITICO)[number];

export const DOMINIOS_ANALITICOS = [
  "vendas",
  "estoque",
  "carteira",
  "clientes",
  "caixa",
  "fiscal",
] as const;

export type DominioAnalitico = (typeof DOMINIOS_ANALITICOS)[number];

export const GRAOS_JOIN_ANALITICO = [
  "empresa",
  "produto",
  "categoria",
  "marca",
  "cliente",
  "vendedor",
  "forma_pagamento",
  "tempo",
] as const;

export type GraoJoinAnalitico = (typeof GRAOS_JOIN_ANALITICO)[number];

export type FiltroAnalitico = {
  campo: CampoFiltroAnalitico;
  operador: OperadorFiltroAnalitico;
  valor: string | number | boolean | Array<string | number>;
};

export type OrdenacaoAnalitica = {
  metrica: NomeMetricaAnalitica;
  direcao: "asc" | "desc";
};

export type ConsultaAnalitica = {
  metricas: NomeMetricaAnalitica[];
  dimensoes: NomeDimensaoAnalitica[];
  filtros: FiltroAnalitico[];
  periodo: PeriodoAssistente;
  de: string | null;
  ate: string | null;
  comparacao: boolean;
  ordenacao: OrdenacaoAnalitica | null;
  limite: number;
  reutilizarContexto: boolean;
};

export type DefinicaoMetricaAnalitica = {
  nome: NomeMetricaAnalitica;
  dominio: DominioAnalitico;
  tipo: "moeda" | "quantidade" | "percentual" | "dias" | "data" | "contagem";
  fonte: string;
  formula: string;
  recurso: RecursoFerramentaIa;
  acao: "acessar" | "acessar_carteira";
  graos: GraoJoinAnalitico[];
  derivada?: boolean;
  aviso?: string;
};

export type DefinicaoDimensaoAnalitica = {
  nome: NomeDimensaoAnalitica;
  grao: GraoJoinAnalitico;
  fonte: string;
};

export type ContextoAnaliticoAssistente = {
  empresaId: string;
  periodo: PeriodoAssistente;
  dimensoes: NomeDimensaoAnalitica[];
  metricas: NomeMetricaAnalitica[];
  entidadeTipo: GraoJoinAnalitico;
  entidadeIds: string[];
};

export type LinhaAnalitica = {
  id: string;
  nome: string;
  valores: Record<string, number | string | null>;
  comparacao?: Record<
    string,
    { atual: number | null; anterior: number | null; delta: number | null; deltaPercentual: number | null }
  >;
};

export type ComparacaoMetricaAnalitica = {
  atual: number | null;
  anterior: number | null;
  delta: number | null;
  deltaPercentual: number | null;
};

export type ResultadoAnalitico = {
  periodo: { rotulo: string; inicio: string; fim: string };
  comparacao: { rotulo: string; metricas: Record<string, ComparacaoMetricaAnalitica> } | null;
  resumo: Record<string, number | string | null>;
  linhas: LinhaAnalitica[];
  avisos: string[];
  dadosIncompletos: string[];
  contexto: ContextoAnaliticoAssistente;
};

export const LIMITE_PADRAO_ANALITICO = 8;
export const LIMITE_MAX_ANALITICO = 20;
export const MAX_CONSULTAS_ANALITICAS_POR_MENSAGEM = 4;
