import type { PeriodoAssistente } from "../tipos";
import type { RecursoFerramentaIa } from "../permissoes";

export const OPERADORES_FILTRO_CONSULTA = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "contains",
  "startsWith",
  "endsWith",
  "isNull",
  "isNotNull",
  "between",
] as const;
export type OperadorFiltroConsulta = (typeof OPERADORES_FILTRO_CONSULTA)[number];

export const AGREGACOES_CONSULTA = [
  "count",
  "countDistinct",
  "sum",
  "avg",
  "min",
  "max",
] as const;
export type AgregacaoConsulta = (typeof AGREGACOES_CONSULTA)[number];

export const TIPOS_CAMPO_CONSULTA = [
  "id",
  "string",
  "number",
  "moeda",
  "boolean",
  "date",
] as const;
export type TipoCampoConsulta = (typeof TIPOS_CAMPO_CONSULTA)[number];

export const NOMES_FONTE_CONSULTA = [
  "produtos",
  "estoque",
  "categorias",
  "clientes",
  "vendas",
  "vendas_itens",
  "pagamentos",
  "carteira",
  "recebimentos",
  "creditos",
  "caixas",
  "caixa_movimentacoes",
  "documentos_fiscais",
  "notificacoes",
] as const;
export type NomeFonteConsulta = (typeof NOMES_FONTE_CONSULTA)[number];

export const FONTES_PROIBIDAS_CONSULTA = [
  "auth",
  "auth.users",
  "storage",
  "vault",
  "supabase_migrations",
  "cron",
  "realtime",
  "extensions",
  "pg_catalog",
  "information_schema",
  "secrets",
  "tokens",
  "credenciais",
  "fiscal_credenciais",
  "fiscal_certificados",
] as const;

export const CAMPOS_PROIBIDOS_CONSULTA = [
  "empresa_id",
  "empresaid",
  "senha",
  "password",
  "senha_certificado",
  "certificado",
  "csc",
  "token",
  "refresh_token",
  "api_key",
  "apikey",
  "service_role",
  "secret",
  "vault",
] as const;

export const LIMITE_PADRAO_CONSULTA = 20;
export const LIMITE_MAX_CONSULTA = 100;
export const LIMITE_REJEITAR_CONSULTA = 500;
export const MAX_JOINS_CONSULTA = 4;
export const MAX_CAMPOS_SELECT_CONSULTA = 20;
export const MAX_AGREGACOES_CONSULTA = 10;
export const MAX_FILTROS_CONSULTA = 20;
export const MAX_ITENS_OR_CONSULTA = 8;
export const MAX_FETCH_CONSULTA = 2000;
export const TIMEOUT_CONSULTA_MS = 8000;
export const MAX_CONSULTAR_DADOS_POR_MENSAGEM = 3;

export type SelectCampoConsulta = {
  field: string;
  aggregate?: never;
  as?: string;
};

export type SelectAgregadoConsulta = {
  field: string;
  aggregate: AgregacaoConsulta;
  as: string;
};

export type SelectConsulta = SelectCampoConsulta | SelectAgregadoConsulta;

export type FiltroSimplesConsulta = {
  field: string;
  op: OperadorFiltroConsulta;
  value?: unknown;
};

export type FiltroGrupoOuConsulta = {
  or: FiltroSimplesConsulta[];
};

export type FiltroConsulta = FiltroSimplesConsulta | FiltroGrupoOuConsulta;

export type OrdenacaoConsulta = {
  field: string;
  direction: "asc" | "desc";
};

export type ConsultaDados = {
  source: NomeFonteConsulta;
  select: SelectConsulta[];
  filters: FiltroConsulta[];
  relations: string[];
  groupBy: string[];
  orderBy: OrdenacaoConsulta[];
  distinct: boolean;
  limit: number;
  offset: number;
  periodo: PeriodoAssistente | null;
};

export type ResultadoConsultaDados =
  | {
      ok: true;
      columns: string[];
      rows: Array<Record<string, unknown>>;
      rowCount: number;
      truncated: boolean;
      querySummary: string;
      avisos: string[];
      fontes: string[];
      duracaoMs: number;
    }
  | {
      ok: false;
      error: string;
      details: string;
    };

export type CampoCatalogoConsulta = {
  nome: string;
  coluna: string;
  tipo: TipoCampoConsulta;
  descricao: string;
  pesquisavel: boolean;
  agregavel: boolean;
  interno?: boolean;
};

export type RelacaoCatalogoConsulta = {
  nome: string;
  fonteAlvo: NomeFonteConsulta;
  local: string;
  remoto: string;
  prefixo: string;
  descricao: string;
  requer?: string[];
};

export type FonteCatalogoConsulta = {
  nome: NomeFonteConsulta;
  descricao: string;
  tabela: string;
  visao: string;
  campoData: string | null;
  recurso: RecursoFerramentaIa | null;
  acao: "acessar" | "acessar_carteira";
  campos: readonly CampoCatalogoConsulta[];
  relacoes: readonly RelacaoCatalogoConsulta[];
};

export type LinhaConsulta = Record<string, unknown>;
