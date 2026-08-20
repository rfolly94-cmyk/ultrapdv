export const ABAS_RELATORIO = [
  "vendas",
  "produtos",
  "estoque",
  "clientes",
  "carteira",
  "pagamentos",
  "fiscal",
] as const;

export type AbaRelatorio = (typeof ABAS_RELATORIO)[number];

export const PERIODOS_RELATORIO = [
  "hoje",
  "ontem",
  "7d",
  "30d",
  "mes",
  "mes_anterior",
  "personalizado",
] as const;

export type PeriodoRelatorio = (typeof PERIODOS_RELATORIO)[number];

export const TAMANHOS_PAGINA = [25, 50, 100] as const;

export type FiltrosRelatorio = {
  aba: AbaRelatorio;
  periodo: PeriodoRelatorio;
  de: string | null;
  ate: string | null;
  q: string;
  status: string;
  clienteId: string;
  vendedorId: string;
  formaId: string;
  categoriaId: string;
  marcaId: string;
  situacao: string;
  subaba: string;
  ordenacao: string;
  modelo: string;
  semComprar: string;
  pagina: number;
  porPagina: number;
};

export type IndicadorRelatorio = {
  label: string;
  valor: string;
  hint?: string;
};

export type LinhaRelatorio = {
  id: string;
  href?: string | null;
  celulas: Array<string | number>;
};

export type RelatorioMontado = {
  titulo: string;
  vazio: string;
  indicadores: IndicadorRelatorio[];
  colunas: string[];
  linhas: LinhaRelatorio[];
  totalFiltrado: number;
  grafico?: Array<{ rotulo: string; valor: number }>;
  extra?: {
    titulo: string;
    colunas: string[];
    linhas: LinhaRelatorio[];
  } | null;
};

export const STATUS_VENDA_VALIDA = "finalizada";
export const STATUS_VENDA_CANCELADA = "cancelada";
export const STATUS_PAGAMENTO_CONFIRMADO = "confirmado";
