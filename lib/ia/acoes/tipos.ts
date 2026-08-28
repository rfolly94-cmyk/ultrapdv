export const TIPOS_ACAO_IA = [
  "atualizacao_fiscal_produto",
  "atribuicao_grupo_fiscal",
  "criacao_grupo_fiscal",
  "atualizacao_basica_produto",
  "notificacao_lida",
  "notificacao_dispensar",
  "notificacao_adiar",
  "desfazer",
] as const;
export type TipoAcaoIa = (typeof TIPOS_ACAO_IA)[number];

export const ENTIDADES_ACAO_IA = [
  "produto",
  "grupo_fiscal",
  "notificacao",
  "desfazer",
] as const;
export type EntidadeAcaoIa = (typeof ENTIDADES_ACAO_IA)[number];

export const STATUS_PROPOSTA_IA = [
  "pendente",
  "confirmada",
  "executada",
  "cancelada",
  "expirada",
  "falhou",
] as const;
export type StatusPropostaIa = (typeof STATUS_PROPOSTA_IA)[number];

export const FERRAMENTAS_ESCRITA_IA = [
  "propor_atualizacao_fiscal",
  "propor_atualizacao_fiscal_produto",
  "propor_atribuicao_grupo_fiscal",
  "propor_criacao_grupo_fiscal",
  "propor_atualizacao_produto",
  "propor_acao_notificacao",
  "aplicar_atualizacao_fiscal_produto",
  "aplicar_atribuicao_grupo_fiscal",
  "criar_grupo_fiscal_confirmado",
  "aplicar_atualizacao_basica_produto",
  "aplicar_acao_notificacao",
  "executar_sql",
  "alterar_tabela",
  "executar_action",
  "chamar_rpc",
] as const;

export const TTL_PROPOSTA_MS = 30 * 60 * 1000;
export const MAX_PROPOSTAS_PENDENTES = 8;
export const MAX_NOTIFICACOES_POR_PROPOSTA = 10;

export const MENSAGEM_IA_SEM_PERMISSAO_ALTERAR =
  "Você não possui permissão para aplicar esta alteração.";
export const MENSAGEM_IA_SEM_PERMISSAO_FISCAL =
  "Você não possui permissão para alterar o fiscal deste produto.";
export const MENSAGEM_STALE_PRODUTO =
  "Este produto foi alterado depois da proposta. Faça uma nova análise antes de aplicar.";
export const MENSAGEM_STALE_ENTIDADE =
  "Este registro foi alterado depois da proposta. Faça uma nova análise antes de aplicar.";
export const MENSAGEM_PROPOSTA_EXPIRADA =
  "A proposta expirou. Faça uma nova análise antes de aplicar.";
export const MENSAGEM_EMPRESA_TROCADA =
  "A empresa ativa mudou depois desta proposta. Faça uma nova análise.";
export const MENSAGEM_FALHA_APLICAR =
  "Não consegui aplicar a alteração.";
export const MENSAGEM_SUCESSO_APLICAR = "Alteração realizada.";
export const MENSAGEM_LOTE_NAO_IMPLEMENTADO =
  "Encontrei os itens, mas a escrita em lote ainda não está disponível nesta fase. Revise e aplique um a um.";

export type DiferencaAcaoIa = {
  campo: string;
  rotulo: string;
  atual: string | number | boolean | null;
  novo: string | number | boolean | null;
};

export type CardPropostaAcao = {
  id: string;
  tipo: TipoAcaoIa;
  entidadeTipo: EntidadeAcaoIa;
  entidadeId: string | null;
  titulo: string;
  descricao: string;
  diferencas: DiferencaAcaoIa[];
  impacto: string[];
  avisos: string[];
  nomeEditavel?: boolean;
  nomeSugerido?: string;
  podeDesfazer?: boolean;
  card: "proposta" | "resultado" | "aviso" | "erro";
};

export type PayloadAcaoIa = {
  preview: CardPropostaAcao;
  campos: Record<string, unknown>;
  antes: Record<string, unknown>;
  depois: Record<string, unknown>;
  fontes?: string[];
  versaoFiscal?: string | null;
  confianca?: "nenhuma" | "baixa" | "media" | "alta" | null;
  desfazerDe?: string | null;
};

export type PropostaAcaoPersistida = {
  id: string;
  empresaId: string;
  usuarioId: string;
  conversaId: string;
  tipo: TipoAcaoIa;
  entidadeTipo: EntidadeAcaoIa;
  entidadeId: string | null;
  descricao: string;
  payload: PayloadAcaoIa;
  hashEstado: string;
  status: StatusPropostaIa;
  idempotencyKey: string;
  expiresAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
  resultado: Record<string, unknown>;
  erro: string | null;
  createdAt: string;
};

export type ResultadoExecucaoAcao = {
  ok: boolean;
  mensagem: string;
  entidadeId?: string | null;
  depois?: Record<string, unknown>;
  erro?: string;
  podeDesfazer?: boolean;
};
