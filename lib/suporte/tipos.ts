export const STATUS_CONVERSA_SUPORTE = [
  "aberta",
  "aguardando_suporte",
  "aguardando_cliente",
  "encerrada",
] as const;

export type StatusConversaSuporte = (typeof STATUS_CONVERSA_SUPORTE)[number];

export const REMETENTES_SUPORTE = ["cliente", "master"] as const;
export type RemetenteSuporte = (typeof REMETENTES_SUPORTE)[number];

export const TIPOS_MENSAGEM_SUPORTE = ["texto", "imagem"] as const;
export type TipoMensagemSuporte = (typeof TIPOS_MENSAGEM_SUPORTE)[number];

export const LADOS_ASSISTENTE = ["left", "right"] as const;
export type LadoAssistente = (typeof LADOS_ASSISTENTE)[number];

export const LIMITE_IMAGEM_SUPORTE_BYTES = 5 * 1024 * 1024;
export const MENSAGENS_POR_PAGINA = 50;
export const BUCKET_SUPORTE_CHAT = "suporte-chat";

export const MIME_IMAGEM_SUPORTE = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PosicaoAssistente = {
  lado: LadoAssistente;
  offsetY: number;
};

export const POSICAO_ASSISTENTE_PADRAO: PosicaoAssistente = {
  lado: "right",
  offsetY: 82,
};

export type ConversaSuporte = {
  id: string;
  empresa_id: string;
  aberto_por_usuario_id: string;
  atendente_master_usuario_id: string | null;
  status: StatusConversaSuporte | string;
  assunto: string | null;
  ultima_mensagem_em: string;
  created_at: string;
  empresa_nome?: string | null;
  usuario_nome?: string | null;
  ultima_mensagem?: string | null;
  nao_lida?: boolean;
};

export type MensagemSuporte = {
  id: string;
  conversa_id: string;
  empresa_id: string;
  remetente_usuario_id: string;
  remetente_tipo: RemetenteSuporte | string;
  tipo: TipoMensagemSuporte | string;
  texto: string | null;
  arquivo_path: string | null;
  created_at: string;
  url_imagem?: string | null;
};

export function conversaEstaAtiva(status: string | null | undefined) {
  return (
    status === "aberta" ||
    status === "aguardando_suporte" ||
    status === "aguardando_cliente"
  );
}
