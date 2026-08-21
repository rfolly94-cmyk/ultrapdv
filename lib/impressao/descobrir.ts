import {
  PRINT_AGENT_APP,
  PRINT_AGENT_HOST,
  PRINT_AGENT_PORT,
  PRINT_AGENT_PORTA_MAX_AUTO,
  type StatusAgenteImpressao,
} from "./tipos";
import { ehUuid } from "./regras";

export const MENSAGEM_CONECTOR_AUSENTE = "UltraPDV Conector não encontrado.";
const STORAGE_ORIGEM = "ultrapdv_conector_origem";
const TIMEOUT_DESCOBERTA_MS = 450;

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
  return corpo.ok === true && corpo.app === PRINT_AGENT_APP;
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
  return {
    ok: data.ok === true,
    app: data.app,
    nome: data.nome,
    versao: data.versao ?? data.version,
    version: data.version ?? data.versao,
    port: typeof data.port === "number" ? data.port : undefined,
    dispositivoId: ehUuid(data.dispositivoId) ? data.dispositivoId : undefined,
    motorImpressao: data.motorImpressao
      ? {
          encontrado: data.motorImpressao.encontrado === true,
          tipo: data.motorImpressao.tipo ?? null,
          caminho: data.motorImpressao.caminho ?? null,
        }
      : undefined,
  };
}

async function pingOrigem(
  origem: string,
  timeoutMs = TIMEOUT_DESCOBERTA_MS
): Promise<StatusAgenteImpressao | null> {
  const controlador = new AbortController();
  const timer = window.setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const resposta = await fetch(`${origem}/health`, {
      signal: controlador.signal,
      cache: "no-store",
    });
    if (!resposta.ok) {
      return null;
    }
    const data = (await resposta.json()) as StatusAgenteImpressao;
    if (!ehSaudeConector(data)) {
      return null;
    }
    return mapearSaude(data);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function descobrirUltraPdvConector(): Promise<
  | { ok: true; origem: string; saude: StatusAgenteImpressao }
  | { ok: false; erro: string }
> {
  if (origemCache) {
    const atual = await pingOrigem(origemCache, 700);
    if (atual) {
      return { ok: true, origem: origemCache, saude: atual };
    }
    origemCache = null;
  }

  try {
    const gravada = window.sessionStorage.getItem(STORAGE_ORIGEM);
    if (gravada) {
      const atual = await pingOrigem(gravada, 700);
      if (atual) {
        origemCache = gravada;
        return { ok: true, origem: gravada, saude: atual };
      }
    }
  } catch {
    // sem sessionStorage
  }

  const encontrados = await Promise.all(
    portasDescobertaConector().map(async (porta) => {
      const origem = origemConectorNaPorta(porta);
      const saude = await pingOrigem(origem);
      return saude ? { origem, saude } : null;
    })
  );
  const hit = encontrados.find((item) => item !== null);
  if (!hit) {
    return { ok: false, erro: MENSAGEM_CONECTOR_AUSENTE };
  }

  origemCache = hit.origem;
  try {
    window.sessionStorage.setItem(STORAGE_ORIGEM, hit.origem);
  } catch {
    // ignore
  }
  return { ok: true, origem: hit.origem, saude: hit.saude };
}
