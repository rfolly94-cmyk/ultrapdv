export const NIVEIS_NOTIFICACAO = [
  "info",
  "atencao",
  "importante",
  "critico",
] as const;

export type NivelNotificacao = (typeof NIVEIS_NOTIFICACAO)[number];

export const CATEGORIAS_NOTIFICACAO = [
  "estoque",
  "validade",
  "financeiro",
  "fiscal",
  "caixa",
  "sistema",
] as const;

export type CategoriaNotificacao = (typeof CATEGORIAS_NOTIFICACAO)[number];

export const STATUS_NOTIFICACAO = ["ativa", "resolvida"] as const;
export type StatusNotificacao = (typeof STATUS_NOTIFICACAO)[number];

export const TIPOS_NOTIFICACAO = [
  "estoque_baixo",
  "estoque_zerado",
  "estoque_negativo",
  "lote_vencendo",
  "lote_vencido",
  "carteira_vencida",
  "fiscal_rejeitada",
  "fiscal_aguardando_reconciliacao",
  "fiscal_certificado_vencendo",
  "fiscal_revisao_base",
  "caixa_aberto_anterior",
] as const;

export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number];

export const FILTROS_CENTRAL_NOTIFICACOES = [
  "todas",
  "importantes",
  "estoque",
  "financeiro",
  "fiscal",
  "sistema",
] as const;

export type FiltroCentralNotificacoes =
  (typeof FILTROS_CENTRAL_NOTIFICACOES)[number];

export const ADIAR_NOTIFICACAO = ["1h", "amanha", "7d"] as const;
export type OpcaoAdiarNotificacao = (typeof ADIAR_NOTIFICACAO)[number];

export const ROTULO_NIVEL_NOTIFICACAO: Record<NivelNotificacao, string> = {
  info: "Info",
  atencao: "Atenção",
  importante: "Importante",
  critico: "Crítico",
};

export const ROTULO_CATEGORIA_NOTIFICACAO: Record<
  CategoriaNotificacao,
  string
> = {
  estoque: "Estoque",
  validade: "Validade",
  financeiro: "Financeiro",
  fiscal: "Fiscal",
  caixa: "Caixa",
  sistema: "Sistema",
};

export const ROTULO_TIPO_NOTIFICACAO: Record<TipoNotificacao, string> = {
  estoque_baixo: "Estoque baixo",
  estoque_zerado: "Estoque zerado",
  estoque_negativo: "Estoque negativo",
  lote_vencendo: "Lote próximo do vencimento",
  lote_vencido: "Lote vencido",
  carteira_vencida: "Carteira vencida",
  fiscal_rejeitada: "Nota rejeitada",
  fiscal_aguardando_reconciliacao: "Aguardando reconciliação",
  fiscal_certificado_vencendo: "Certificado próximo do vencimento",
  fiscal_revisao_base: "Revisão fiscal da base",
  caixa_aberto_anterior: "Caixa aberto do dia anterior",
};

export const ROTULO_ACAO_NOTIFICACAO: Record<TipoNotificacao, string> = {
  estoque_baixo: "Ver produto",
  estoque_zerado: "Ver produto",
  estoque_negativo: "Ver produto",
  lote_vencendo: "Ver validade",
  lote_vencido: "Ver validade",
  carteira_vencida: "Ver carteira",
  fiscal_rejeitada: "Ver documento",
  fiscal_aguardando_reconciliacao: "Ver documento",
  fiscal_certificado_vencendo: "Ver fiscal",
  fiscal_revisao_base: "Ver produtos",
  caixa_aberto_anterior: "Abrir Caixa",
};

export type ConfiguracaoNotificacoes = {
  estoqueBaixo: boolean;
  estoqueZerado: boolean;
  estoqueNegativo: boolean;
  estoqueMinimoPadrao: number;
  loteVencendo: boolean;
  loteVencido: boolean;
  antecedenciaValidadeDias: number;
  carteiraVencida: boolean;
  fiscalRejeitada: boolean;
  fiscalAguardandoReconciliacao: boolean;
  fiscalCertificadoVencendo: boolean;
  fiscalRevisaoBase: boolean;
  antecedenciaCertificadoDias: number;
  caixaAbertoAnterior: boolean;
};

export const CONFIGURACAO_NOTIFICACOES_PADRAO: ConfiguracaoNotificacoes = {
  estoqueBaixo: true,
  estoqueZerado: true,
  estoqueNegativo: true,
  estoqueMinimoPadrao: 0,
  loteVencendo: true,
  loteVencido: true,
  antecedenciaValidadeDias: 30,
  carteiraVencida: true,
  fiscalRejeitada: true,
  fiscalAguardandoReconciliacao: true,
  fiscalCertificadoVencendo: true,
  fiscalRevisaoBase: true,
  antecedenciaCertificadoDias: 30,
  caixaAbertoAnterior: true,
};

export type CandidatoNotificacao = {
  tipo: TipoNotificacao;
  categoria: CategoriaNotificacao;
  nivel: NivelNotificacao;
  titulo: string;
  mensagem: string;
  entidadeTipo: string | null;
  entidadeId: string | null;
  actionUrl: string | null;
  chaveDeduplicacao: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type NotificacaoPersistida = {
  id: string;
  empresaId: string;
  tipo: TipoNotificacao;
  categoria: CategoriaNotificacao;
  nivel: NivelNotificacao;
  titulo: string;
  mensagem: string;
  entidadeTipo: string | null;
  entidadeId: string | null;
  actionUrl: string | null;
  chaveDeduplicacao: string;
  metadata: Record<string, unknown>;
  status: StatusNotificacao;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type EstadoNotificacaoUsuario = {
  lidaEm: string | null;
  dispensadaEm: string | null;
  adiadaAte: string | null;
};

export type NotificacaoCentral = NotificacaoPersistida & {
  lida: boolean;
  dispensada: boolean;
  adiada: boolean;
  adiadaAte: string | null;
};

export function nivelNotificacaoValido(
  valor: string
): valor is NivelNotificacao {
  return (NIVEIS_NOTIFICACAO as readonly string[]).includes(valor);
}

export function categoriaNotificacaoValida(
  valor: string
): valor is CategoriaNotificacao {
  return (CATEGORIAS_NOTIFICACAO as readonly string[]).includes(valor);
}

export function tipoNotificacaoValido(valor: string): valor is TipoNotificacao {
  return (TIPOS_NOTIFICACAO as readonly string[]).includes(valor);
}
