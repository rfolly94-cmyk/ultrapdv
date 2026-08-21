import {
  type ImpressoraWindows,
  type StatusAgenteImpressao,
} from "./tipos";
import {
  descobrirUltraPdvConector,
  invalidarOrigemConector,
  MENSAGEM_CONECTOR_AUSENTE,
} from "./descobrir";

const TIMEOUT_MS = 2500;
const TIMEOUT_PRINT_MS = 20000;

async function fetchAgente(
  path: string,
  init?: RequestInit,
  timeoutMs = TIMEOUT_MS
) {
  const descoberto = await descobrirUltraPdvConector();
  if (!descoberto.ok) {
    throw new Error(descoberto.erro);
  }

  const executar = async (origem: string) => {
    const controlador = new AbortController();
    const timer = window.setTimeout(() => controlador.abort(), timeoutMs);
    try {
      return await fetch(`${origem}${path}`, {
        ...init,
        signal: controlador.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }
  };

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

export async function consultarSaudeAgente(): Promise<StatusAgenteImpressao> {
  try {
    const descoberto = await descobrirUltraPdvConector();
    if (!descoberto.ok) {
      return { ok: false };
    }
    return descoberto.saude;
  } catch {
    return { ok: false };
  }
}

export async function listarImpressorasAgente(): Promise<ImpressoraWindows[]> {
  try {
    const resposta = await fetchAgente("/printers");
    if (!resposta.ok) {
      return [];
    }
    const data = (await resposta.json()) as {
      impressoras?: Array<{ nome?: string; name?: string; padrao?: boolean }>;
    };
    return (data.impressoras ?? [])
      .map((item) => ({
        nome: String(item.nome ?? item.name ?? "").trim(),
        padrao: item.padrao === true,
      }))
      .filter((item) => item.nome.length > 0);
  } catch {
    return [];
  }
}

export async function enviarImpressaoAgente(input: {
  tipoDocumento: string;
  impressora: string;
  copias: number;
  papel: string;
  pdfBase64: string;
}) {
  const impressora = String(input.impressora ?? "").trim();
  if (!impressora) {
    return { ok: false as const, erro: "Selecione uma impressora." };
  }

  const pdf = String(input.pdfBase64 ?? "").replace(/^data:application\/pdf;base64,/, "");
  if (!pdf) {
    return { ok: false as const, erro: "Documento de impressão vazio." };
  }

  try {
    const resposta = await fetchAgente(
      "/print",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipoDocumento: input.tipoDocumento,
          impressora,
          copias: input.copias,
          papel: input.papel,
          pdfBase64: pdf,
        }),
      },
      TIMEOUT_PRINT_MS
    );

    const data = (await resposta.json().catch(() => ({}))) as {
      ok?: boolean;
      erro?: string;
    };

    if (!resposta.ok || data.ok !== true) {
      return {
        ok: false as const,
        erro:
          data.erro ||
          "Não foi possível imprimir neste computador.",
      };
    }

    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      erro: MENSAGEM_CONECTOR_AUSENTE,
    };
  }
}

export async function baixarPdfComoBase64(url: string) {
  const resposta = await fetch(url, { credentials: "same-origin" });
  if (!resposta.ok) {
    const data = (await resposta.json().catch(() => ({}))) as { erro?: string };
    throw new Error(data.erro || "Não foi possível obter o documento.");
  }
  const buffer = await resposta.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binario = "";
  const fatia = 0x8000;
  for (let i = 0; i < bytes.length; i += fatia) {
    binario += String.fromCharCode(...bytes.subarray(i, i + fatia));
  }
  return btoa(binario);
}
