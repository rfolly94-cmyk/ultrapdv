export const TXID_TESTE_CONEXAO_PIX = "ULTRAPDVTESTECONEXAOPIX00000001";

export const METODO_TESTE_PIX_GERANET = "pix_consultar_txid_sintetico";

export type ResultadoTestePix = "sucesso" | "inconclusivo" | "erro";

export const LIMITACAO_TESTE_PIX_GERANET =
  "A Geranet não publica endpoint de teste PIX. A conexão foi tentada com /api/v1/pix/consultar e um TXID sintético, sem emitir cobrança. Credenciais só são consideradas válidas quando a resposta comprova autenticação aceita e erro exclusivo de cobrança/TXID inexistente.";

export const MENSAGEM_TESTE_MERCADOPAGO_INCONCLUSIVO =
  "A Geranet respondeu, mas não foi possível validar as credenciais do Mercado Pago sem uma cobrança existente. Faça uma cobrança PIX de teste para validar a integração.";

const AUTH_RE =
  /unauthoriz|invalid_client|invalid_token|certificado inv[aá]lid|senha (do certificado )?inv[aá]lid|token inv[aá]lid|credencia(l|is) inv[aá]lid|falha de autentica|n[aã]o autentic|acesso negad|forbidden|authentication failed|(oauth|mTLS).{0,40}(erro|inv[aá]lid|recus)/i;

const NOT_FOUND_RE =
  /(cobran[cç]a|txid|pix).{0,80}(n[aã]o encontrad|not found|inexistent|n[aã]o exist)|(n[aã]o encontrad|not found|inexistent).{0,80}(cobran[cç]a|txid|pix)/i;

export type ClassificacaoTestePix = {
  resultado: ResultadoTestePix;
  ok: boolean;
  provedorAutenticado: boolean;
  mensagem: string;
  limitacao: string;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function classificacao(
  resultado: ResultadoTestePix,
  mensagem: string
): ClassificacaoTestePix {
  return {
    resultado,
    ok: resultado === "sucesso",
    provedorAutenticado: resultado === "sucesso",
    mensagem,
    limitacao: LIMITACAO_TESTE_PIX_GERANET,
  };
}

function mensagemGenerica(mensagem: string) {
  return mensagem === "" || /^[:.\-–—\s]+$/.test(mensagem);
}

function statusHttpOuInterno500(params: {
  httpStatus: number;
  dadosStatus?: number | null;
}) {
  const interno =
    typeof params.dadosStatus === "number" ? params.dadosStatus : 0;
  return params.httpStatus >= 500 || interno >= 500;
}

export function classificarRespostaTestePix(params: {
  httpStatus: number;
  situacao?: string | null;
  mensagem?: string | null;
  dadosStatus?: number | null;
  provedor?: string | null;
}): ClassificacaoTestePix {
  const mensagem = texto(params.mensagem);
  const situacao = texto(params.situacao).toLowerCase();
  const combinado = `${situacao} ${mensagem}`;
  const autenticacaoRecusada =
    params.httpStatus === 401 ||
    params.httpStatus === 403 ||
    AUTH_RE.test(combinado);
  const somenteCobrancaInexistente = NOT_FOUND_RE.test(combinado);
  const http500OuGenerico =
    statusHttpOuInterno500(params) || mensagemGenerica(mensagem);

  if (autenticacaoRecusada) {
    return classificacao(
      "erro",
      mensagem ||
        "O provedor recusou autenticação, certificado, token ou credencial. Nenhuma cobrança foi emitida."
    );
  }

  if (somenteCobrancaInexistente) {
    return classificacao(
      "sucesso",
      "Autenticação aceita. O erro foi somente de TXID/cobrança inexistente. Nenhuma cobrança foi emitida."
    );
  }

  if (params.provedor === "mercadopago" && http500OuGenerico) {
    return classificacao("inconclusivo", MENSAGEM_TESTE_MERCADOPAGO_INCONCLUSIVO);
  }

  return classificacao(
    "inconclusivo",
    mensagem && !mensagemGenerica(mensagem)
      ? `Resultado inconclusivo: ${mensagem} A Geranet/PSP respondeu, mas não dá para distinguir cobrança inexistente de erro de credencial. Nenhuma cobrança foi emitida.`
      : "Resultado inconclusivo. A Geranet/PSP respondeu, mas não dá para distinguir cobrança inexistente de erro de credencial. Nenhuma cobrança foi emitida."
  );
}
