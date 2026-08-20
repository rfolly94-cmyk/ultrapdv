export const GERANET_BASE_URL = "https://nfe.geranet.net";

export type RespostaGeranetBanking = {
  situacao?: string;
  mensagem?: string;
  dados?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ResultadoGeranetBanking = {
  httpOk: boolean;
  httpStatus: number;
  dados: RespostaGeranetBanking;
};

export class ErroComunicacaoGeranetBanking extends Error {
  readonly tipo: "timeout" | "comunicacao";

  constructor(tipo: "timeout" | "comunicacao", mensagem: string) {
    super(mensagem);
    this.name = "ErroComunicacaoGeranetBanking";
    this.tipo = tipo;
  }
}

const ROTAS_PERMITIDAS = new Set([
  "/api/v1/pix/emitir",
  "/api/v1/pix/consultar",
  "/api/v1/pix/cancelar",
  "/api/v1/user",
]);

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

async function lerJsonSeguro(resposta: Response): Promise<RespostaGeranetBanking> {
  const raw = await resposta.text();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RespostaGeranetBanking;
    }
  } catch {
    // Não devolver HTML nem corpo bruto.
  }

  return {
    situacao: "erro",
    mensagem: "A Geranet respondeu em formato não reconhecido.",
  };
}

function codigoErroRede(error: unknown) {
  const bruto = error as { code?: string; cause?: { code?: string } };
  return String(bruto?.cause?.code ?? bruto?.code ?? "").toUpperCase();
}

export async function chamarGeranetBanking({
  apiKey,
  endpoint,
  payload,
  method = "POST",
  timeoutMs = 45_000,
}: {
  apiKey: string;
  endpoint: string;
  payload?: unknown;
  method?: "GET" | "POST";
  timeoutMs?: number;
}): Promise<ResultadoGeranetBanking> {
  const chaveApi = texto(apiKey);
  const rota = texto(endpoint);

  if (!chaveApi) {
    throw new Error("API Key da Geranet não informada.");
  }

  if (!ROTAS_PERMITIDAS.has(rota)) {
    throw new Error("Endpoint Geranet Banking inválido.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let resposta: Response;

  try {
    resposta = await fetch(`${GERANET_BASE_URL}${rota}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(method === "POST"
          ? { "Content-Type": "application/json" }
          : {}),
        Authorization: `Bearer ${chaveApi}`,
      },
      body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const abortado =
      error instanceof Error && error.name === "AbortError";
    const codigo = codigoErroRede(error);

    if (
      abortado ||
      codigo === "ETIMEDOUT" ||
      codigo === "UND_ERR_HEADERS_TIMEOUT"
    ) {
      throw new ErroComunicacaoGeranetBanking(
        "timeout",
        "Timeout ao comunicar com a Geranet (PIX)."
      );
    }

    throw new ErroComunicacaoGeranetBanking(
      "comunicacao",
      "Falha de comunicação com a Geranet (PIX)."
    );
  } finally {
    clearTimeout(timeout);
  }

  return {
    httpOk: resposta.ok,
    httpStatus: resposta.status,
    dados: await lerJsonSeguro(resposta),
  };
}
