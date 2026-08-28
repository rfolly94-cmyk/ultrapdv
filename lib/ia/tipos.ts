import type { CardPropostaAcao } from "./acoes/tipos";

export const PAPEIS_MENSAGEM_IA = ["usuario", "assistente", "sistema"] as const;
export type PapelMensagemIa = (typeof PAPEIS_MENSAGEM_IA)[number];

export const PERIODOS_ASSISTENTE = [
  "hoje",
  "ontem",
  "anteontem",
  "7d",
  "30d",
  "mes",
  "mes_anterior",
  "semana",
  "semana_anterior",
  "ano",
] as const;
export type PeriodoAssistente = (typeof PERIODOS_ASSISTENTE)[number];

export const NOMES_FERRAMENTAS_IA = [
  "consultar_dados",
  "buscar_produtos",
  "consultar_produto",
  "consultar_estoque",
  "consultar_estoque_baixo",
  "consultar_estoque_negativo",
  "buscar_clientes",
  "consultar_cliente",
  "consultar_carteira",
  "consultar_carteira_cliente",
  "consultar_clientes_em_aberto",
  "consultar_recebimentos",
  "consultar_creditos_cliente",
  "consultar_vendas",
  "consultar_venda",
  "consultar_total_vendido",
  "consultar_formas_pagamento",
  "consultar_produtos_mais_vendidos",
  "resumir_vendas_periodo",
  "ranking_produtos",
  "consultar_caixa",
  "consultar_status_caixa",
  "consultar_caixa_atual",
  "consultar_movimentos_caixa",
  "consultar_resumo_caixa",
  "consultar_configuracao_fiscal",
  "consultar_documento_fiscal",
  "consultar_notas_fiscais",
  "consultar_status_nfe",
  "consultar_status_nfce",
  "consultar_emissao_fiscal",
  "diagnosticar_nota",
  "consultar_notificacoes",
  "pesquisar_ncm",
  "consultar_ncm",
  "validar_ncm",
  "sugerir_cest",
  "consultar_cest",
  "consultar_origem_mercadoria",
  "consultar_classificacao_ibs_cbs",
  "classificar_produto_fiscal",
  "validar_fiscal_produto",
  "analisar_operacao_fiscal",
  "recomendar_grupo_fiscal",
  "analisar_grupos_fiscais_produtos",
  "consultar_analitico",
  "abrir_pdv",
  "abrir_produtos",
  "novo_produto",
  "abrir_clientes",
  "novo_cliente",
  "abrir_vendas",
  "abrir_venda",
  "abrir_caixa",
  "abrir_carteira",
  "abrir_fiscal",
  "iniciar_nfe",
  "iniciar_nfce",
  "abrir_configuracoes",
] as const;
export type NomeFerramentaIa = (typeof NOMES_FERRAMENTAS_IA)[number];

export const NOMES_FERRAMENTAS_PROPOSTA_IA = [
  "propor_atualizacao_fiscal",
  "propor_atualizacao_fiscal_produto",
  "propor_atribuicao_grupo_fiscal",
  "propor_criacao_grupo_fiscal",
  "propor_atualizacao_produto",
  "propor_acao_notificacao",
] as const;
export type NomeFerramentaPropostaIa =
  (typeof NOMES_FERRAMENTAS_PROPOSTA_IA)[number];

export type NomeFerramentaResultadoIa =
  | NomeFerramentaIa
  | NomeFerramentaPropostaIa;

export const CONFIANCAS_FISCAL_IA = [
  "nenhuma",
  "baixa",
  "media",
  "alta",
] as const;
export type ConfiancaFiscalIa = (typeof CONFIANCAS_FISCAL_IA)[number];

export const TIPOS_ACAO_FRONTEND_ASSISTENTE = [
  "navigate",
  "show_results",
  "select_entity",
  "open_details",
] as const;
export type TipoAcaoFrontendAssistente =
  (typeof TIPOS_ACAO_FRONTEND_ASSISTENTE)[number];

export type AcaoAssistente = {
  type?: TipoAcaoFrontendAssistente;
  label: string;
  href?: string | null;
  entityId?: string;
  entityTipo?: string;
  aplicarFiscal?: {
    propostaId: string;
  };
  confirmarAcao?: {
    propostaId: string;
  };
  cancelarAcao?: {
    propostaId: string;
  };
  desfazerAcao?: {
    propostaId: string;
  };
};

export type ContextoTelaAssistente = {
  pathname: string;
  search?: string;
  produtoId?: string | null;
  vendaId?: string | null;
  clienteId?: string | null;
  emissaoId?: string | null;
  grupoFiscalId?: string | null;
  notificacaoIds?: string[] | null;
};

export type ContextoTelaResolvido = {
  pathname: string;
  produtoId: string | null;
  vendaId: string | null;
  clienteId: string | null;
  emissaoId: string | null;
  grupoFiscalId: string | null;
  notificacaoIds: string[];
  rotulo: string | null;
};

export type ModoRespostaAssistente = "direto" | "ia";

export type ContextoDeterministicoAssistente = {
  empresaId: string;
  intencao: string;
  clienteId?: string | null;
  clienteNome?: string | null;
  produtoId?: string | null;
  produtoNome?: string | null;
  periodo?: PeriodoAssistente | null;
};

export type MensagemAssistente = {
  id: string;
  papel: PapelMensagemIa;
  conteudo: string;
  acoes: AcaoAssistente[];
  propostaFiscal?: PropostaFiscalProduto | null;
  propostaAcao?: CardPropostaAcao | null;
  modo?: ModoRespostaAssistente | null;
  contextoDeterministico?: ContextoDeterministicoAssistente | null;
  contextoAnalitico?: import("./analitico/tipos").ContextoAnaliticoAssistente | null;
  createdAt: string;
};

export type PropostaFiscalProduto = {
  propostaId: string;
  produtoId: string;
  produtoNome: string;
  confianca: ConfiancaFiscalIa;
  perguntas: string[];
  justificativa: string;
  fontes: string[];
  versaoTabelas: string;
  atual: Record<string, string | number | boolean | null>;
  sugerido: Record<string, string | number | boolean | null>;
  diferencas: Array<{
    campo: string;
    rotulo: string;
    atual: string | number | boolean | null;
    sugerido: string | number | boolean | null;
  }>;
};

export type ResultadoFerramentaIa = {
  ok: boolean;
  ferramenta: NomeFerramentaResultadoIa;
  erro?: string;
  codigo?:
    | "sem_permissao"
    | "nao_encontrado"
    | "falha"
    | "sem_base"
    | "informacao_insuficiente"
    | "aguardando_legislacao"
    | "ferramenta_inexistente"
    | "argumentos_invalidos";
  dados?: Record<string, unknown>;
  acoes?: AcaoAssistente[];
  propostaFiscal?: PropostaFiscalProduto | null;
  propostaAcao?: CardPropostaAcao | null;
};

export type DefinicaoFerramentaIa = {
  nome: NomeFerramentaIa;
  descricao: string;
  parametros: Record<string, unknown>;
};

export const SUGESTOES_ASSISTENTE = [
  "Quanto vendi hoje?",
  "Produto mais vendido hoje",
  "Quem está devendo mais?",
  "Clientes com contas vencidas",
  "Produtos com estoque baixo",
  "Produtos zerados",
  "Como está meu caixa?",
  "O que precisa da minha atenção?",
  "Notas rejeitadas",
] as const;

export const SUGESTOES_ASSISTENTE_IA = [
  "Confira o fiscal deste produto",
  "Quais produtos precisam de revisão fiscal?",
  "Estou vendendo mais e ganhando menos?",
  "Quais produtos vendem bem e estão acabando?",
] as const;

export const MENSAGEM_IA_SEM_PERMISSAO =
  "Você não possui permissão para consultar essa informação.";

export const MENSAGEM_IA_FALHA_CONSULTA =
  "Não consegui consultar essa informação agora.";

export const MENSAGEM_IA_PRECISA_MAIS =
  "Preciso de mais informações.";

export const MENSAGEM_IA_NAO_CONFIGURADO =
  "O Assistente UltraPDV ainda não está configurado neste ambiente. A chave do provedor fica só no servidor.";

export const MENSAGEM_IA_PRECISA_MODO =
  "Essa pergunta precisa do modo IA. As consultas de vendas, estoque, clientes, carteira, caixa, fiscal cadastrado e notificações continuam disponíveis gratuitamente.";

export const MENSAGEM_IA_PROVEDOR_SEM_CREDITO =
  "O provedor de IA está sem crédito ou atingiu a cota. Tente novamente mais tarde.";

export const MENSAGEM_IA_MIGRATION =
  "Aplique a migration do Assistente IA neste ambiente antes de usar o copiloto.";
