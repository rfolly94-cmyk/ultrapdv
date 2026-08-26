import { MENSAGEM_CONECTOR_AUSENTE } from "./mensagens";
import {
  PRINT_AGENT_APP,
  PRINT_AGENT_HOST,
  PRINT_AGENT_PORT,
  PRINT_AGENT_PORTA_MAX_AUTO,
  PRINT_AGENT_SERVICO,
  type StatusAgenteImpressao,
} from "./tipos";
import { ehUuid } from "./regras";

export { MENSAGEM_CONECTOR_AUSENTE };

export const CAMINHOS_DESCOBERTA_CONECTOR = ["/status", "/health"] as const;
const STORAGE_ORIGEM = "ultrapdv_conector_origem";
const TIMEOUT_DESCOBERTA_MS = 900;

export type MotivoFalhaDescoberta =
  | "ausente"
  | "timeout"
  | "bloqueado"
  | "invalido";

let origemCache: string | null = null;

export function portasDescobertaConector() {
  const lista: number[] = [];
  for (let p = PRINT_AGENT_PORT; p <= PRINT_AGENT_PORTA_MAX_AUTO; p += 1) {
    lista.push(p);
  }
  return lista;
}

export function origemConectorNaPorta(porta: number) {
  return `http://${PRINT_AGENT_HOST}:${porta}`;
}

export function ehSaudeConector(data: unknown): data is StatusAgenteImpressao {
  if (!data || typeof data !== "object") {
    return false;
  }
  const corpo = data as StatusAgenteImpressao;
  if (corpo.ok !== true) {
    return false;
  }
  return (
    corpo.app === PRINT_AGENT_APP || corpo.servico === PRINT_AGENT_SERVICO
  );
}

export function invalidarOrigemConector() {
  origemCache = null;
  try {
    window.sessionStorage.removeItem(STORAGE_ORIGEM);
  } catch {
    // sem storage
  }
}

function mapearSaude(data: StatusAgenteImpressao): StatusAgenteImpressao {
  const porta =
    typeof data.port === "number"
      ? data.port
      : typeof data.porta === "number"
        ? data.porta
        : undefined;
  return {
    ok: data.ok === true,
    app: data.app,
    servico: data.servico,
    nome: data.nome,
    versao: data.versao ?? data.version,
    version: data.version ?? data.versao,
    port: porta,
    porta,
    dispositivoId: ehUuid(data.dispositivoId) ? data.dispositivoId : undefined,
    lastPrinter: data.lastPrinter ?? null,
    lastPaper: data.lastPaper ?? null,
    motorImpressao: data.motorImpressao
      ? {
          encontrado: data.motorImpressao.encontrado === true,
          tipo: data.motorImpressao.tipo ?? null,
          caminho: data.motorImpressao.caminho ?? null,
        }
      : undefined,
  };
}

function motivoDeFalhaHttp(status: number, corpo: unknown): MotivoFalhaDescoberta {
  if (status === 403) {
    return "bloqueado";
  }
  if (status === 404) {
    return "invalido";
  }
  if (
    corpo &&
    typeof corpo === "object" &&
    "erro" in corpo &&
    String((corpo as { erro?: unknown }).erro).includes("Origem")
  ) {
    return "bloqueado";
  }
  return "invalido";
}

async function pingCaminho(
  origem: string,
  caminho: (typeof CAMINHOS_DESCOBERTA_CONECTOR)[number],
  timeoutMs: number
): Promise<
  | { ok: true; saude: StatusAgenteImpressao }
  | { ok: false; motivo: MotivoFalhaDescoberta; tentarOutroCaminho: boolean }
> {
  const controlador = new AbortController();
  const timer = window.setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const resposta = await fetch(`${origem}${caminho}`, {
      signal: controlador.signal,
      cache: "no-store",
    });
    const data = await resposta.json().catch(() => null);
    if (resposta.status === 404) {
      return { ok: false, motivo: "invalido", tentarOutroCaminho: true };
    }
    if (!resposta.ok) {
      const motivo = motivoDeFalhaHttp(resposta.status, data);
      return {
        ok: false,
        motivo,
        tentarOutroCaminho: false,
      };
    }
    if (!ehSaudeConector(data)) {
      return { ok: false, motivo: "invalido", tentarOutroCaminho: true };
    }
    return { ok: true, saude: mapearSaude(data) };
  } catch (erro) {
    const nome =
      erro && typeof erro === "object" && "name" in erro
        ? String((erro as { name?: unknown }).name)
        : "";
    if (nome === "AbortError") {
      return { ok: false, motivo: "timeout", tentarOutroCaminho: false };
    }
    return { ok: false, motivo: "ausente", tentarOutroCaminho: false };
  } finally {
    window.clearTimeout(timer);
  }
}

async function pingOrigem(
  origem: string,
  timeoutMs = TIMEOUT_DESCOBERTA_MS
): Promise<
  | { ok: true; saude: StatusAgenteImpressao }
  | { ok: false; motivo: MotivoFalhaDescoberta }
> {
  let ultimo: MotivoFalhaDescoberta = "ausente";
  let identidade: StatusAgenteImpressao | null = null;

  for (const caminho of CAMINHOS_DESCOBERTA_CONECTOR) {
    const resultado = await pingCaminho(origem, caminho, timeoutMs);
    if (resultado.ok) {
      identidade = resultado.saude;
      if (identidade.motorImpressao) {
        return { ok: true, saude: identidade };
      }
      continue;
    }
    ultimo = resultado.motivo;
    if (!resultado.tentarOutroCaminho) {
      if (identidade) {
        return { ok: true, saude: identidade };
      }
      return { ok: false, motivo: resultado.motivo };
    }
  }

  if (identidade) {
    return { ok: true, saude: identidade };
  }
  return { ok: false, motivo: ultimo };
}

function erroPorMotivo(motivo: MotivoFalhaDescoberta) {
  if (motivo === "timeout") {
    return "O UltraPDV Connector não respondeu a tempo neste computador.";
  }
  if (motivo === "bloqueado") {
    return "O navegador bloqueou o acesso ao UltraPDV Connector (CORS ou rede privada). Atualize o Connector para 1.3.2.";
  }
  if (motivo === "invalido") {
    return "Há um serviço em 127.0.0.1, mas a resposta não identificou o UltraPDV Connector.";
  }
  return MENSAGEM_CONECTOR_AUSENTE;
}

export async function descobrirUltraPdvConector(): Promise<
  | { ok: true; origem: string; saude: StatusAgenteImpressao }
  | { ok: false; erro: string; motivo: MotivoFalhaDescoberta }
> {
  if (origemCache) {
    const atual = await pingOrigem(origemCache, 1200);
    if (atual.ok) {
      return { ok: true, origem: origemCache, saude: atual.saude };
    }
    origemCache = null;
  }

  try {
    const gravada = window.sessionStorage.getItem(STORAGE_ORIGEM);
    if (gravada) {
      const atual = await pingOrigem(gravada, 1200);
      if (atual.ok) {
        origemCache = gravada;
        return { ok: true, origem: gravada, saude: atual.saude };
      }
    }
  } catch {
    // sem sessionStorage
  }

  const encontrados = await Promise.all(
    portasDescobertaConector().map(async (porta) => {
      const origem = origemConectorNaPorta(porta);
      const ping = await pingOrigem(origem);
      return ping.ok
        ? { origem, saude: ping.saude, motivo: null }
        : { origem: null, saude: null, motivo: ping.motivo };
    })
  );
  const hit = encontrados.find((item) => item.origem && item.saude);
  if (hit && hit.origem && hit.saude) {
    origemCache = hit.origem;
    try {
      window.sessionStorage.setItem(STORAGE_ORIGEM, hit.origem);
    } catch {
      // ignore
    }
    return { ok: true, origem: hit.origem, saude: hit.saude };
  }

  const motivos = encontrados
    .map((item) => item.motivo)
    .filter((motivo): motivo is MotivoFalhaDescoberta => Boolean(motivo));
  const motivo =
    motivos.find((item) => item === "bloqueado") ??
    motivos.find((item) => item === "timeout") ??
    motivos.find((item) => item === "invalido") ??
    "ausente";
  return { ok: false, erro: erroPorMotivo(motivo), motivo };
}
