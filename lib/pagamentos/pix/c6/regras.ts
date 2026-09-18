export const CODIGO_PROVEDOR_C6 = "c6bank";

export const AMBIENTE_C6_SANDBOX = "2";
export const AMBIENTE_C6_PRODUCAO = "1";

export const URL_C6_SANDBOX = "https://baas-api-sandbox.c6bank.info";
export const URL_C6_PRODUCAO = "https://baas-api.c6bank.info";

export const PATH_C6_AUTH = "/v1/auth/";
export const PATH_C6_COB = "/v2/pix/cob/";
export const PATH_C6_WEBHOOK = "/v2/pix/webhook/";

export const EXPIRACAO_COBRANCA_C6_SEGUNDOS = 3600;
export const TOKEN_C6_MARGEM_SEGUNDOS = 30;
export const TIMEOUT_C6_MS = 20_000;

export const MENSAGEM_C6_CONEXAO_OK =
  "Conexão com C6 Sandbox realizada com sucesso.";

export const MENSAGEM_C6_CONEXAO_OK_PRODUCAO =
  "Conexão com C6 Produção realizada com sucesso.";

export const MENSAGEM_C6_INDISPONIVEL =
  "C6 Bank temporariamente indisponível. Tente novamente em instantes.";

export const MENSAGEM_C6_MTLS =
  "Falha no certificado mTLS do C6 Bank. Verifique o certificado e a chave privada.";

export const MENSAGEM_C6_PRODUCAO_BLOQUEADA =
  "Produção do C6 Bank ainda não está liberada nesta fase. Use o ambiente Sandbox.";

export const MENSAGEM_C6_AMBIENTE_INVALIDO =
  "Selecione Sandbox ou Produção do C6 Bank.";

export const MENSAGEM_C6_NAO_CONFIGURADO =
  "Configure o PIX C6 Bank antes de emitir uma cobrança.";

export const MENSAGEM_C6_WEBHOOK_HTTPS =
  "Configure NEXT_PUBLIC_SITE_URL com o domínio HTTPS público do UltraPDV para registrar o webhook C6.";

export const MENSAGEM_C6_AGUARDANDO = "Aguardando pagamento";

export function rotuloAmbienteC6(ambiente: string) {
  return ambiente === AMBIENTE_C6_PRODUCAO ? "producao" : "sandbox";
}

export function mensagemTesteConexaoC6(ambiente: string) {
  return ambiente === AMBIENTE_C6_PRODUCAO
    ? MENSAGEM_C6_CONEXAO_OK_PRODUCAO
    : MENSAGEM_C6_CONEXAO_OK;
}

export function respostaPublicaTesteC6(ambiente: string = AMBIENTE_C6_SANDBOX) {
  return {
    ok: true,
    resultado: "sucesso" as const,
    mensagem: mensagemTesteConexaoC6(ambiente),
    provedor: CODIGO_PROVEDOR_C6,
    ambiente,
    cobranca_emitida: false,
    provedor_autenticado: true,
    metodo_teste: "c6_oauth_client_credentials",
  };
}

export function ehProvedorPixC6Direto(provedor?: string | null) {
  return String(provedor ?? "").trim().toLowerCase() === CODIGO_PROVEDOR_C6;
}

export function baseUrlC6(ambiente: string) {
  if (ambiente === AMBIENTE_C6_PRODUCAO) {
    return URL_C6_PRODUCAO;
  }

  if (ambiente === AMBIENTE_C6_SANDBOX) {
    return URL_C6_SANDBOX;
  }

  throw new Error(MENSAGEM_C6_AMBIENTE_INVALIDO);
}

export function urlAuthC6(ambiente: string) {
  return `${baseUrlC6(ambiente)}${PATH_C6_AUTH}`;
}

export function urlCobC6(ambiente: string, txid: string) {
  return `${baseUrlC6(ambiente)}${PATH_C6_COB}${encodeURIComponent(txid)}`;
}

export function urlWebhookC6(ambiente: string, chavePix: string) {
  return `${baseUrlC6(ambiente)}${PATH_C6_WEBHOOK}${encodeURIComponent(chavePix)}`;
}

export function valorPixC6(valor: number) {
  return (Math.round(valor * 100) / 100).toFixed(2);
}

export function mensagemErroHttpC6(status: number) {
  if (status === 401 || status === 403) {
    return "O C6 Bank recusou as credenciais ou o certificado. Nenhuma venda foi perdida.";
  }

  if (status === 404) {
    return "Cobrança PIX C6 não encontrada. Consulte o TXID já gerado antes de criar outra.";
  }

  if (status === 409) {
    return "Já existe uma cobrança C6 com este TXID. A cobrança existente será consultada.";
  }

  if (status === 422 || status === 400) {
    return "O C6 Bank recusou os dados da cobrança PIX. Nenhuma venda foi perdida.";
  }

  if (status === 429 || status === 502 || status >= 500) {
    return MENSAGEM_C6_INDISPONIVEL;
  }

  return MENSAGEM_C6_INDISPONIVEL;
}

export function deveConsultarTxidExistenteAposFalha(params: {
  httpStatus?: number | null;
  timeout?: boolean;
  rede?: boolean;
  txid?: string | null;
}) {
  const txid = String(params.txid ?? "").trim();
  if (!txid) {
    return false;
  }

  if (params.timeout || params.rede) {
    return true;
  }

  const status = Number(params.httpStatus ?? 0);
  return status === 409 || status === 429 || status >= 500;
}

export function payloadCobrancaImediataC6(params: {
  valor: number;
  chavePix: string;
  solicitacaoPagador: string;
  devedor?: { nome?: string; cpfCnpj?: string };
}) {
  const documento = String(params.devedor?.cpfCnpj ?? "").replace(/\D/g, "");
  const nome = String(params.devedor?.nome ?? "").trim();
  const cobranca: Record<string, unknown> = {
    calendario: {
      expiracao: EXPIRACAO_COBRANCA_C6_SEGUNDOS,
    },
    valor: {
      original: valorPixC6(params.valor),
      modalidadeAlteracao: 0,
    },
    chave: params.chavePix,
    solicitacaoPagador: params.solicitacaoPagador.slice(0, 140),
  };

  if (nome && (documento.length === 11 || documento.length === 14)) {
    cobranca.devedor =
      documento.length === 14
        ? { cnpj: documento, nome }
        : { cpf: documento, nome };
  }

  return cobranca;
}
