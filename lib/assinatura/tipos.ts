export const STATUS_ASSINATURA = [
  "trial",
  "ativa",
  "carencia",
  "suspensa",
  "cancelada",
] as const;

export type StatusAssinatura = (typeof STATUS_ASSINATURA)[number];

export const TRIAL_DIAS = 7;

export const MENSAGEM_ASSINATURA_RESTRITA =
  "A assinatura desta empresa está suspensa. Regularize para voltar a operar.";

export type AssinaturaEmpresa = {
  id?: string | null;
  empresa_id: string;
  plano_id?: string | null;
  status: StatusAssinatura | string;
  inicio_em?: string | null;
  vencimento_em?: string | null;
  carencia_ate?: string | null;
  liberado_ate?: string | null;
  suspenso_em?: string | null;
  cancelado_em?: string | null;
  observacao?: string | null;
  plano_nome?: string | null;
  plano_valor_mensal?: number | string | null;
};

export type AcaoAssinatura =
  | "ativar"
  | "carencia"
  | "suspender"
  | "liberar"
  | "cancelar"
  | "alterar_plano"
  | "alterar_vencimento";

export const EVENTOS_MASTER = [
  "empresa_ativada",
  "empresa_suspensa",
  "empresa_carencia",
  "empresa_liberada_temporariamente",
  "plano_alterado",
  "assinatura_cancelada",
  "vencimento_alterado",
] as const;

export type EventoMaster = (typeof EVENTOS_MASTER)[number];
