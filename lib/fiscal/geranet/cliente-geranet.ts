import { sanitizarConsultaGeranet } from "@/lib/fiscal/geranet/classificar-consulta";
import { cstatNormalizado } from "@/lib/fiscal/geranet/cstat";

export type RespostaGeranet = {
  situacao?: string;
  mensagem?: string;
  xml?: string;
  pdf?: string;
  cstat?: string;
  numero?: string;
  chave?: string;
  protocolo?: string;
  [key: string]: unknown;
};

export type ResumoRespostaGeranet = {
  situacao: string | null;
  mensagem: string | null;
  cstat: string | null;
  numero: string | null;
  chave: string | null;
  protocolo: string | null;
  xml_disponivel: boolean;
  pdf_disponivel: boolean;
};

export type ResultadoGeranet = {
  httpOk: boolean;
  httpStatus: number;
  dados: RespostaGeranet;
  resumo: ResumoRespostaGeranet;
  diagnostico: Record<string, unknown>;
};

export type TipoErroComunicacaoGeranet =
  | "timeout"
  | "comunicacao";

const CODIGOS_SEM_SAIDA = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

export class ErroComunicacaoGeranet extends Error {
  readonly tipo: TipoErroComunicacaoGeranet;
  readonly transmissaoPodeTerSaido: boolean;

  constructor(
    tipo: TipoErroComunicacaoGeranet,
    mensagem: string,
    transmissaoPodeTerSaido = tipo === "timeout"
  ) {
    super(mensagem);

    this.name =
      "ErroComunicacaoGeranet";

    this.tipo = tipo;
    this.transmissaoPodeTerSaido = transmissaoPodeTerSaido;
  }
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

async function lerJsonSeguro(
  resposta: Response
): Promise<RespostaGeranet> {
  const raw =
    await resposta.text();

  if (!raw) {
    return {};
  }

  try {
    const parsed =
      JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as RespostaGeranet;
    }
  } catch {
    // Não devolver HTML,
    // stack trace ou resposta bruta
    // da plataforma para o cliente.
  }

  return {
    situacao: "erro",
    mensagem:
      "A Geranet respondeu em formato não reconhecido.",
  };
}

export function normalizarRespostaGeranet(
  dados: RespostaGeranet
): RespostaGeranet {
  const bruto = dados as Record<string, unknown>;
  const cstat =
    cstatNormalizado(
      texto(dados.cstat) || texto(bruto.cStat) || texto(bruto.CStat),
      dados.mensagem
    ) || texto(dados.cstat) || texto(bruto.cStat);
  const chave =
    texto(dados.chave) ||
    texto(bruto.chNFe) ||
    texto(bruto.chNfe) ||
    texto(bruto.chaveAcesso);
  const protocolo =
    texto(dados.protocolo) || texto(bruto.nProt) || texto(bruto.nprot);

  return {
    ...dados,
    ...(cstat ? { cstat } : {}),
    ...(chave ? { chave } : {}),
    ...(protocolo ? { protocolo } : {}),
  };
}

function tamanhoDocumentoDiagnostico(valor: unknown) {
  if (valor == null) {
    return 0;
  }
  if (typeof valor === "string") {
    return valor.length;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(valor)) {
    return valor.length;
  }
  return String(valor).length;
}

function resumoDocumentoDiagnostico(valor: unknown) {
  const presente = Boolean(texto(valor));
  return {
    presente,
    tamanho: presente ? tamanhoDocumentoDiagnostico(valor) : 0,
  };
}

function jaEhResumoDocumentoDiagnostico(valor: unknown) {
  return Boolean(
    valor &&
      typeof valor === "object" &&
      !Array.isArray(valor) &&
      "presente" in (valor as Record<string, unknown>)
  );
}

export function montarDiagnosticoRespostaGeranet({
  dados,
  httpStatus,
  endpoint,
  timestamp,
  erroTransporte,
}: {
  dados?: unknown;
  httpStatus?: number | null;
  endpoint?: string | null;
  timestamp?: string | null;
  erroTransporte?: string | null;
}): Record<string, unknown> {
  const bruto =
    dados && typeof dados === "object" && !Array.isArray(dados)
      ? { ...(dados as Record<string, unknown>) }
      : {};

  const xml = bruto.xml;
  const pdf = bruto.pdf;
  delete bruto.xml;
  delete bruto.pdf;

  const sanitizado = sanitizarConsultaGeranet(bruto);
  const base =
    sanitizado && typeof sanitizado === "object" && !Array.isArray(sanitizado)
      ? (sanitizado as Record<string, unknown>)
      : { valor: sanitizado ?? null };

  return {
    ...base,
    situacao: texto(base.situacao ?? bruto.situacao) || null,
    mensagem: texto(base.mensagem ?? bruto.mensagem) || null,
    cstat: texto(base.cstat ?? bruto.cstat) || null,
    numero: texto(base.numero ?? bruto.numero) || null,
    chave: texto(base.chave ?? bruto.chave) || null,
    protocolo: texto(base.protocolo ?? bruto.protocolo) || null,
    xml: jaEhResumoDocumentoDiagnostico(xml)
      ? xml
      : resumoDocumentoDiagnostico(xml),
    pdf: jaEhResumoDocumentoDiagnostico(pdf)
      ? pdf
      : resumoDocumentoDiagnostico(pdf),
    httpStatus: httpStatus ?? null,
    endpoint: texto(endpoint) || null,
    timestamp: texto(timestamp) || new Date().toISOString(),
    ...(erroTransporte
      ? { erro_transporte: texto(erroTransporte) || null }
      : {}),
  };
}

const CHAVES_SECRETAS_LOG =
  /certificado|senha|api.?key|token|authorization|csc|csrt|password|secret|codigoSeguranca/i;

const CHAVES_LOG_PRINCIPAIS = new Set([
  "situacao",
  "mensagem",
  "cstat",
  "cStat",
  "numero",
  "chave",
  "protocolo",
  "xml",
  "pdf",
  "erro",
  "erros",
  "errors",
  "campo",
  "detalhes",
]);

function textoLog(valor: unknown, max = 2000) {
  const bruto = texto(valor);
  if (!bruto) {
    return null;
  }

  return bruto.length > max ? `${bruto.slice(0, max)}…` : bruto;
}

function campoLog(valor: unknown) {
  if (valor == null) {
    return null;
  }

  if (typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }

  if (typeof valor === "string") {
    return textoLog(valor);
  }

  return sanitizarConsultaGeranet(valor);
}

function extrasRespostaGeranet(dados: RespostaGeranet) {
  const sanitizado = sanitizarConsultaGeranet(dados);
  if (!sanitizado || typeof sanitizado !== "object" || Array.isArray(sanitizado)) {
    return null;
  }

  const extras: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(
    sanitizado as Record<string, unknown>
  )) {
    if (CHAVES_LOG_PRINCIPAIS.has(chave) || /^(xml|pdf)$/i.test(chave)) {
      continue;
    }

    if (CHAVES_SECRETAS_LOG.test(chave)) {
      continue;
    }

    extras[chave] = valor;
  }

  return Object.keys(extras).length > 0 ? extras : null;
}

export function montarLogRespostaGeranet({
  dados,
  httpStatus,
  httpOk,
  endpoint,
  contexto = {},
}: {
  dados: RespostaGeranet;
  httpStatus: number;
  httpOk: boolean;
  endpoint?: string | null;
  contexto?: Record<string, unknown>;
}): Record<string, unknown> {
  const bruto = dados as Record<string, unknown>;

  return {
    emissao_id: textoLog(contexto.emissao_id) ?? null,
    modelo: textoLog(contexto.modelo) ?? null,
    endpoint: textoLog(endpoint) ?? null,
    httpOk,
    httpStatus,
    situacao: textoLog(dados.situacao),
    mensagem: textoLog(dados.mensagem),
    cstat: textoLog(dados.cstat) ?? textoLog(bruto.cStat),
    numero: textoLog(dados.numero),
    chave: textoLog(dados.chave),
    protocolo: textoLog(dados.protocolo),
    xml_disponivel: Boolean(texto(dados.xml)),
    pdf_disponivel: Boolean(texto(dados.pdf)),
    erro: campoLog(bruto.erro),
    erros: campoLog(bruto.erros),
    errors: campoLog(bruto.errors),
    campo: campoLog(bruto.campo),
    detalhes: campoLog(bruto.detalhes),
    extras: extrasRespostaGeranet(dados),
    chaves_body: Object.keys(bruto).filter(
      (chave) => !CHAVES_SECRETAS_LOG.test(chave)
    ),
  };
}

export function registrarLogRespostaGeranet(input: {
  dados: RespostaGeranet;
  httpStatus: number;
  httpOk: boolean;
  endpoint?: string | null;
  contexto?: Record<string, unknown>;
}) {
  console.info("[fiscal] geranet-resposta", montarLogRespostaGeranet(input));
}

export function resumirRespostaGeranet(
  resposta: RespostaGeranet
): ResumoRespostaGeranet {
  return {
    situacao:
      texto(
        resposta.situacao
      ) || null,

    mensagem:
      texto(
        resposta.mensagem
      ) || null,

    cstat:
      cstatNormalizado(
        resposta.cstat ?? (resposta as Record<string, unknown>).cStat,
        resposta.mensagem
      ) || texto(resposta.cstat) || null,

    numero:
      texto(
        resposta.numero
      ) || null,

    chave:
      texto(
        resposta.chave
      ) || null,

    protocolo:
      texto(
        resposta.protocolo
      ) || null,

    xml_disponivel:
      Boolean(
        texto(
          resposta.xml
        )
      ),

    pdf_disponivel:
      Boolean(
        texto(
          resposta.pdf
        )
      ),
  };
}

type ChamarGeranetParams = {
  apiKey: string;
  endpoint: string;
  payload: unknown;
  timeoutMs?: number;
  contexto?: Record<string, unknown>;
};

function codigoErroRede(error: unknown) {
  const bruto = error as {
    code?: string;
    cause?: { code?: string };
  };

  return String(
    bruto?.cause?.code ?? bruto?.code ?? ""
  ).toUpperCase();
}

function tipoFalhaFetch(error: unknown): TipoErroComunicacaoGeranet {
  if (error instanceof Error && error.name === "AbortError") {
    return "timeout";
  }

  const codigo = codigoErroRede(error);

  if (
    codigo === "ECONNRESET" ||
    codigo === "EPIPE" ||
    codigo === "ETIMEDOUT" ||
    codigo === "UND_ERR_SOCKET" ||
    codigo === "UND_ERR_HEADERS_TIMEOUT" ||
    codigo === "UND_ERR_BODY_TIMEOUT"
  ) {
    return "timeout";
  }

  return "comunicacao";
}

export function transmissaoPodeTerSaidoDoErro(error: unknown) {
  if (error instanceof ErroComunicacaoGeranet) {
    return error.transmissaoPodeTerSaido;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  const codigo = codigoErroRede(error);

  if (!codigo) {
    return true;
  }

  return !CODIGOS_SEM_SAIDA.has(codigo);
}

export function classificarErroFetchGeranet(
  error: unknown
): ErroComunicacaoGeranet {
  if (error instanceof ErroComunicacaoGeranet) {
    return error;
  }

  const tipo = tipoFalhaFetch(error);
  const podeTerSaido = transmissaoPodeTerSaidoDoErro(error);

  if (tipo === "timeout") {
    return new ErroComunicacaoGeranet(
      "timeout",
      error instanceof Error && error.name === "AbortError"
        ? "Timeout após iniciar transmissão à Geranet."
        : "Conexão interrompida após iniciar transmissão à Geranet.",
      true
    );
  }

  return new ErroComunicacaoGeranet(
    "comunicacao",
    podeTerSaido
      ? "Falha de comunicação após iniciar transmissão à Geranet."
      : "Falha de comunicação antes de a requisição alcançar a Geranet.",
    podeTerSaido
  );
}

export function persistenciaFalhaComunicacaoEmitir(error: unknown): {
  status: "aguardando_reconciliacao" | "erro_comunicacao";
  classificacaoResumo: "erro_tecnico" | "erro_envio";
  motivo: string;
  retransmitir: boolean;
} {
  const falha = classificarErroFetchGeranet(error);

  if (falha.transmissaoPodeTerSaido) {
    return {
      status: "aguardando_reconciliacao",
      classificacaoResumo: "erro_tecnico",
      motivo: falha.message,
      retransmitir: false,
    };
  }

  return {
    status: "erro_comunicacao",
    classificacaoResumo: "erro_envio",
    motivo: falha.message,
    retransmitir: true,
  };
}

export function patchEmissaoFalhaComunicacao(
  persistencia: ReturnType<typeof persistenciaFalhaComunicacaoEmitir>
) {
  return {
    status: persistencia.status,
    erro_comunicacao: persistencia.motivo,
    motivo: persistencia.motivo,
    resposta_resumo: {
      classificacao: persistencia.classificacaoResumo,
    },
    respondida_at: new Date().toISOString(),
  };
}

function logFaseGeranet(
  fase: "PRE_ENVIO" | "REQUEST_INICIADA" | "RESPOSTA_RECEBIDA" | "RESULTADO_AMBIGUO",
  dados: Record<string, unknown>
) {
  console.info("[fiscal] geranet", { fase, ...dados });
}

export async function chamarGeranet({
  apiKey,
  endpoint,
  payload,
  timeoutMs = 45_000,
  contexto = {},
}: ChamarGeranetParams): Promise<ResultadoGeranet> {
  const chaveApi =
    texto(apiKey);

  if (!chaveApi) {
    throw new Error(
      "API Key da Geranet não informada."
    );
  }

  const rota =
    texto(endpoint);

  if (
    !rota.startsWith(
      "/api/v1/"
    )
  ) {
    throw new Error(
      "Endpoint Geranet inválido."
    );
  }

  const meta = {
    endpoint: rota,
    ...contexto,
  };

  logFaseGeranet("PRE_ENVIO", meta);

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  let resposta: Response;

  try {
    logFaseGeranet("REQUEST_INICIADA", meta);
    resposta =
      await fetch(
        `https://nfe.geranet.net${rota}`,
        {
          method: "POST",

          headers: {
            Accept:
              "application/json",

            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${chaveApi}`,
          },

          body:
            JSON.stringify(
              payload
            ),

          cache:
            "no-store",

          signal:
            controller.signal,
        }
      );
  } catch (error) {
    const falha = classificarErroFetchGeranet(error);
    logFaseGeranet(
      falha.transmissaoPodeTerSaido ? "RESULTADO_AMBIGUO" : "PRE_ENVIO",
      {
        ...meta,
        codigo: codigoErroRede(error) || null,
        transmissaoPodeTerSaido: falha.transmissaoPodeTerSaido,
      }
    );

    throw falha;
  } finally {
    clearTimeout(timeout);
  }

  logFaseGeranet("RESPOSTA_RECEBIDA", {
    ...meta,
    httpStatus: resposta.status,
  });

  const dados = normalizarRespostaGeranet(
    await lerJsonSeguro(
      resposta
    )
  );

  registrarLogRespostaGeranet({
    dados,
    httpStatus: resposta.status,
    httpOk: resposta.ok,
    endpoint: rota,
    contexto,
  });

  return {
    httpOk:
      resposta.ok,

    httpStatus:
      resposta.status,

    dados,

    resumo:
      resumirRespostaGeranet(
        dados
      ),

    diagnostico: montarDiagnosticoRespostaGeranet({
      dados,
      httpStatus: resposta.status,
      endpoint: rota,
    }),
  };
}

const ROTAS_GET_PERMITIDAS =
  /^\/api\/v1\/logs(?:\/|$)/;

export async function getGeranetJson({
  apiKey,
  path,
  timeoutMs = 30_000,
}: {
  apiKey: string;
  path: string;
  timeoutMs?: number;
}): Promise<{
  httpOk: boolean;
  httpStatus: number;
  dados: Record<string, unknown>;
}> {
  const chaveApi = texto(apiKey);
  const rota = texto(path);

  if (!chaveApi) {
    throw new Error("API Key da Geranet não informada.");
  }

  if (!ROTAS_GET_PERMITIDAS.test(rota.split("?")[0] ?? "")) {
    throw new Error("Consulta Geranet GET limitada a /api/v1/logs.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let resposta: Response;

  try {
    resposta = await fetch(`https://nfe.geranet.net${rota}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${chaveApi}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ErroComunicacaoGeranet(
        "timeout",
        "Timeout ao consultar logs da Geranet."
      );
    }

    throw new ErroComunicacaoGeranet(
      "comunicacao",
      "Falha de comunicação ao consultar logs da Geranet."
    );
  } finally {
    clearTimeout(timeout);
  }

  const dados = await lerJsonSeguro(resposta);

  return {
    httpOk: resposta.ok,
    httpStatus: resposta.status,
    dados: dados as Record<string, unknown>,
  };
}

export async function getGeranetBinario({
  apiKey,
  path,
  timeoutMs = 30_000,
}: {
  apiKey: string;
  path: string;
  timeoutMs?: number;
}): Promise<{
  httpOk: boolean;
  httpStatus: number;
  contentType: string;
  buffer: Buffer | null;
}> {
  const chaveApi = texto(apiKey);
  const rota = texto(path);

  if (!chaveApi) {
    throw new Error("API Key da Geranet não informada.");
  }

  if (!ROTAS_GET_PERMITIDAS.test(rota.split("?")[0] ?? "")) {
    throw new Error("Download Geranet GET limitado a /api/v1/logs.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let resposta: Response;

  try {
    resposta = await fetch(`https://nfe.geranet.net${rota}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${chaveApi}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ErroComunicacaoGeranet(
        "timeout",
        "Timeout ao baixar anexo da Geranet."
      );
    }

    throw new ErroComunicacaoGeranet(
      "comunicacao",
      "Falha de comunicação ao baixar anexo da Geranet."
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!resposta.ok) {
    return {
      httpOk: false,
      httpStatus: resposta.status,
      contentType: resposta.headers.get("content-type") ?? "",
      buffer: null,
    };
  }

  const bytes = Buffer.from(await resposta.arrayBuffer());

  return {
    httpOk: true,
    httpStatus: resposta.status,
    contentType: resposta.headers.get("content-type") ?? "",
    buffer: bytes,
  };
}