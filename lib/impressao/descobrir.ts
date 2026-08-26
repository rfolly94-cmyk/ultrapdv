import {
  MENSAGEM_CONECTOR_AUSENTE,
  MENSAGEM_CONECTOR_BLOQUEADO,
  MENSAGEM_CONECTOR_SEM_PORTA,
} from "./mensagens";
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

export const CAMINHO_SAUDE_CONECTOR = "/health";
const STORAGE_PORTA = "ultrapdv_conector_porta";
const TIMEOUT_CACHE_MS = 1500;
const TIMEOUT_PRIMEIRA_PORTA_MS = 2200;
const TIMEOUT_DEMAIS_PORTAS_MS = 450;

export type MotivoFalhaDescoberta =
  | "ausente"
  | "timeout"
  | "bloqueado"
  | "invalido"
  | "sem_porta";

type ResultadoDescoberta =
  | { ok: true; origem: string; saude: StatusAgenteImpressao }
  | { ok: false; erro: string; motivo: MotivoFalhaDescoberta };

type PingOk = { ok: true; saude: StatusAgenteImpressao };
type PingErro = { ok: false; motivo: MotivoFalhaDescoberta };

let origemCache: string | null = null;
let descobertaEmAndamento: Promise<ResultadoDescoberta> | null = null;

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
  escreverPortaMemorizada(null);
}

export function resetarDescobertaConectorParaTestes() {
  origemCache = null;
  descobertaEmAndamento = null;
  escreverPortaMemorizada(null);
}

function storageDisponivel() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function lerPortaMemorizada(): number | null {
  if (!storageDisponivel()) {
    return null;
  }
  try {
    const bruto = window.localStorage.getItem(STORAGE_PORTA);
    const porta = Number(bruto);
    if (
      Number.isInteger(porta) &&
      porta >= PRINT_AGENT_PORT &&
      porta <= PRINT_AGENT_PORTA_MAX_AUTO
    ) {
      return porta;
    }
  } catch {
    // sem storage
  }
  return null;
}

function escreverPortaMemorizada(porta: number | null) {
  if (!storageDisponivel()) {
    return;
  }
  try {
    if (porta == null) {
      window.localStorage.removeItem(STORAGE_PORTA);
      return;
    }
    window.localStorage.setItem(STORAGE_PORTA, String(porta));
  } catch {
    // ignore
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

function motivoDeFalhaHttp(
  status: number,
  corpo: unknown
): MotivoFalhaDescoberta {
  if (status === 403) {
    return "bloqueado";
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

type InitFetchConector = RequestInit & {
  targetAddressSpace?: "loopback" | "local";
};

export function initFetchConector(init: RequestInit = {}): RequestInit {
  const base: InitFetchConector = {
    ...init,
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
  };
  for (const space of ["loopback", "local"] as const) {
    const candidato = { ...base, targetAddressSpace: space };
    try {
      void new Request("http://127.0.0.1", candidato);
      return candidato;
    } catch {
      continue;
    }
  }
  return base;
}

export async function fetchLocalConector(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(url, initFetchConector(init));
}

async function pingHealth(
  origem: string,
  timeoutMs: number
): Promise<PingOk | PingErro> {
  const controlador = new AbortController();
  const timer = window.setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const resposta = await fetchLocalConector(
      `${origem}${CAMINHO_SAUDE_CONECTOR}`,
      { signal: controlador.signal }
    );
    const data = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      return { ok: false, motivo: motivoDeFalhaHttp(resposta.status, data) };
    }
    if (!ehSaudeConector(data)) {
      return { ok: false, motivo: "invalido" };
    }
    return { ok: true, saude: mapearSaude(data) };
  } catch (erro) {
    const nome =
      erro && typeof erro === "object" && "name" in erro
        ? String((erro as { name?: unknown }).name)
        : "";
    if (nome === "AbortError") {
      return { ok: false, motivo: "timeout" };
    }
    return { ok: false, motivo: "ausente" };
  } finally {
    window.clearTimeout(timer);
  }
}

function memorizar(origem: string, saude: StatusAgenteImpressao) {
  origemCache = origem;
  const porta =
    typeof saude.port === "number"
      ? saude.port
      : typeof saude.porta === "number"
        ? saude.porta
        : Number(new URL(origem).port);
  if (Number.isInteger(porta)) {
    escreverPortaMemorizada(porta);
  }
}

function erroPorMotivo(motivo: MotivoFalhaDescoberta) {
  if (motivo === "timeout" || motivo === "sem_porta") {
    return MENSAGEM_CONECTOR_SEM_PORTA;
  }
  if (motivo === "bloqueado") {
    return MENSAGEM_CONECTOR_BLOQUEADO;
  }
  if (motivo === "invalido") {
    return "Há um serviço neste computador, mas a resposta não identificou o UltraPDV Connector.";
  }
  return MENSAGEM_CONECTOR_AUSENTE;
}

async function varrerPortas(
  portas: number[]
): Promise<ResultadoDescoberta> {
  let ultimo: MotivoFalhaDescoberta = "ausente";
  for (let i = 0; i < portas.length; i += 1) {
    const porta = portas[i];
    const origem = origemConectorNaPorta(porta);
    const timeoutMs =
      i === 0 ? TIMEOUT_PRIMEIRA_PORTA_MS : TIMEOUT_DEMAIS_PORTAS_MS;
    const ping = await pingHealth(origem, timeoutMs);
    if (ping.ok) {
      memorizar(origem, ping.saude);
      return { ok: true, origem, saude: ping.saude };
    }
    ultimo = ping.motivo;
  }
  const motivo = ultimo === "ausente" ? "sem_porta" : ultimo;
  return { ok: false, erro: erroPorMotivo(motivo), motivo };
}

async function descobrirInterno(): Promise<ResultadoDescoberta> {
  if (origemCache) {
    const atual = await pingHealth(origemCache, TIMEOUT_CACHE_MS);
    if (atual.ok) {
      memorizar(origemCache, atual.saude);
      return { ok: true, origem: origemCache, saude: atual.saude };
    }
    origemCache = null;
    escreverPortaMemorizada(null);
  } else {
    const gravada = lerPortaMemorizada();
    if (gravada) {
      const origem = origemConectorNaPorta(gravada);
      const atual = await pingHealth(origem, TIMEOUT_CACHE_MS);
      if (atual.ok) {
        memorizar(origem, atual.saude);
        return { ok: true, origem, saude: atual.saude };
      }
      escreverPortaMemorizada(null);
    }
  }

  return varrerPortas(portasDescobertaConector());
}

export async function descobrirUltraPdvConector(): Promise<ResultadoDescoberta> {
  if (descobertaEmAndamento) {
    return descobertaEmAndamento;
  }
  descobertaEmAndamento = descobrirInterno().finally(() => {
    descobertaEmAndamento = null;
  });
  return descobertaEmAndamento;
}

export async function fetchConector(
  path: string,
  init?: RequestInit,
  timeoutMs = 2500
): Promise<Response> {
  const executar = async (origem: string) => {
    const controlador = new AbortController();
    const timer = window.setTimeout(() => controlador.abort(), timeoutMs);
    try {
      return await fetchLocalConector(`${origem}${path}`, {
        ...init,
        signal: controlador.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const descoberto = await descobrirUltraPdvConector();
  if (!descoberto.ok) {
    throw new Error(descoberto.erro);
  }

  try {
    return await executar(descoberto.origem);
  } catch {
    invalidarOrigemConector();
    const novo = await descobrirUltraPdvConector();
    if (!novo.ok) {
      throw new Error(novo.erro);
    }
    return executar(novo.origem);
  }
}
