import {
  type ImpressoraWindows,
  type StatusAgenteImpressao,
} from "./tipos";
import {
  descobrirUltraPdvConector,
  fetchConector,
  MENSAGEM_CONECTOR_AUSENTE,
} from "./descobrir";
import { normalizarErroImpressaoConector } from "./mensagens";

const TIMEOUT_MS = 2500;
const TIMEOUT_PRINT_MS = 20000;

export async function consultarSaudeAgente(): Promise<StatusAgenteImpressao> {
  try {
    const descoberto = await descobrirUltraPdvConector();
    if (!descoberto.ok) {
      return { ok: false, motivoDescoberta: descoberto.motivo };
    }
    return descoberto.saude;
  } catch {
    return { ok: false, motivoDescoberta: "ausente" };
  }
}

export async function listarImpressorasAgente(): Promise<ImpressoraWindows[]> {
  try {
    const resposta = await fetchConector("/printers", undefined, TIMEOUT_MS);
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
  impressora?: string | null;
  copias: number;
  papel: string;
  pdfBase64: string;
}) {
  const pdf = String(input.pdfBase64 ?? "").replace(
    /^data:application\/pdf;base64,/,
    ""
  );
  if (!pdf) {
    return { ok: false as const, erro: "Documento de impressão vazio." };
  }

  const impressora = String(input.impressora ?? "").trim();
  const payload: Record<string, unknown> = {
    tipoDocumento: input.tipoDocumento,
    copias: input.copias,
    papel: input.papel,
    pdfBase64: pdf,
  };
  if (impressora) {
    payload.impressora = impressora;
  }

  try {
    const resposta = await fetchConector(
      "/print",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      TIMEOUT_PRINT_MS
    );

    const data = (await resposta.json().catch(() => ({}))) as {
      ok?: boolean;
      erro?: string;
      impressora?: string;
      papel?: string;
    };

    if (!resposta.ok || data.ok !== true) {
      return {
        ok: false as const,
        erro: normalizarErroImpressaoConector(
          data.erro || "Não foi possível imprimir neste computador."
        ),
      };
    }

    return {
      ok: true as const,
      impressora: String(data.impressora ?? impressora).trim(),
      papel: String(data.papel ?? input.papel).trim(),
    };
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
