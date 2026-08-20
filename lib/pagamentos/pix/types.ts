import type { CodigoProvedorPix } from "./provedores";

export type AmbientePixGeranet = "1" | "2";

export type ModoPix = "local_manual" | "geranet";

export type StatusPixLocal =
  | "aguardando_confirmacao"
  | "confirmado_manual"
  | "vinculado_venda"
  | "descartado";

export type StatusCobrancaPix =
  | "pendente"
  | "paga"
  | "cancelada"
  | "erro"
  | "expirada"
  | "divergencia_valor"
  | StatusPixLocal;

export type EstadoPagamentoPixGeranet =
  | "pendente"
  | "pago"
  | "cancelado"
  | "expirado"
  | "indeterminado"
  | "falha_temporaria"
  | "falha_cliente";

export type EvidenciaPagamentoPixGeranet = {
  estado: EstadoPagamentoPixGeranet;
  evidencia: string;
  valorPago?: number | null;
  valorCobranca?: number | null;
  pagoEm?: string | null;
  statusExterno?: string | null;
};

export type ContratoPixGeranet = {
  txid: string | null;
  statusExterno: string | null;
  pago: boolean;
  valor: number | null;
  valorPago: number | null;
  pixCopiaECola: string | null;
  qrCode: string | null;
  expiracao: string | null;
  identificador: string | null;
  dadosPublicosSanitizados: Record<string, unknown>;
};

export type RecebedorPix = {
  nome: string;
  cep: string;
  cidade: string;
  uf: string;
};

export type DevedorPix = {
  nome?: string;
  cpfCnpj?: string;
};

export type CredenciaisBancariasPix = {
  chavePix?: string;
  clienteId?: string;
  clienteSegredo?: string;
  chaveUsuario?: string;
  escopo?: string;
  token?: string;
  tokenAcesso?: string;
  certificadoPemHexadecimal?: string;
  chavePrivadaPemHexadecimal?: string;
  certificadoPfxHexadecimal?: string;
  senhaCertificadoPfx?: string;
  chaveAplicacaoDesenvolvedor?: string;
  chaveConsumidor?: string;
  segredoConsumidor?: string;
  tokenPagamento?: string;
  tokenHomologacao?: string;
  autenticacaoApi?: string;
  chaveAutenticacao?: string;
};

export type PayloadCobrancaPix = {
  ambiente: AmbientePixGeranet;
  provedor: CodigoProvedorPix;
  cnpjcpf: string;
  txid?: string;
  credenciais: CredenciaisBancariasPix;
  recebedor: RecebedorPix;
  devedor?: DevedorPix;
  cobranca?: {
    valor: number;
    expiracaoSegundos?: number;
    solicitacaoPagador?: string;
    permitirAlterarValor?: boolean;
  };
};

export type ConfirmacaoPixLocal = {
  modo_pix: "local_manual";
  valor: number;
  txid: string;
  confirmado_manualmente: true;
  confirmado_por: string;
  confirmado_em: string;
};

export type IntegracaoPixPublica = {
  id: string;
  empresa_id: string;
  gateway: string;
  modo?: ModoPix;
  provedor: string | null;
  ambiente: AmbientePixGeranet;
  ativo: boolean;
  chave_pix: string | null;
  recebedor_nome: string | null;
  recebedor_cep: string | null;
  recebedor_cidade: string | null;
  recebedor_uf: string | null;
  credenciais_configuradas: boolean;
  certificado_configurado: boolean;
  configuracao_publica?: Record<string, unknown> | null;
};

export type CobrancaPixPublica = {
  id: string;
  empresa_id: string;
  txid: string | null;
  valor: number;
  status: StatusCobrancaPix;
  provedor: string | null;
  ambiente: string | null;
  dados_publicos: Record<string, unknown>;
  geranet_http_status: number | null;
  geranet_situacao: string | null;
  geranet_mensagem: string | null;
  expira_em: string | null;
  pago_em: string | null;
  cancelado_em: string | null;
  modo_pix?: string | null;
  valor_pago?: number | null;
  checkout_key?: string | null;
};

export type RespostaPixNormalizada = {
  txid: string | null;
  statusProvedor: string | null;
  copiaECola: string | null;
  qrCode: string | null;
  identificador: string | null;
  pago: boolean;
  cancelado: boolean;
};
