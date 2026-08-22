import { autorizarUsoConectorImpressaoAction } from "@/app/configuracoes/impressao/actions";
import {
  baixarPdfComoBase64,
  enviarImpressaoAgente,
} from "./agente";
import { mensagemDocumentoEnviado } from "./mensagens";

export type ResultadoImpressaoConector =
  | {
      ok: true;
      impressora: string;
      papel?: string;
      mensagem: string;
    }
  | {
      ok: false;
      erro: string;
      codigo?: "RECURSO_NAO_CONTRATADO";
    };

export async function imprimirPdfNoUltraPdvConector(input: {
  pdfBase64: string;
  tipoDocumento?: string;
  papel?: string | null;
  copias?: number;
  impressora?: string | null;
}): Promise<ResultadoImpressaoConector> {
  const autorizado = await autorizarUsoConectorImpressaoAction();
  if (!autorizado.ok) {
    return {
      ok: false,
      erro: autorizado.erro,
      codigo: autorizado.codigo,
    };
  }

  const resultado = await enviarImpressaoAgente({
    tipoDocumento: String(input.tipoDocumento ?? "recibo").trim() || "recibo",
    impressora: String(input.impressora ?? "").trim(),
    copias: input.copias ?? 1,
    papel: String(input.papel ?? "").trim() || "80mm",
    pdfBase64: input.pdfBase64,
  });

  if (!resultado.ok) {
    return { ok: false, erro: resultado.erro };
  }

  return {
    ok: true,
    impressora: resultado.impressora,
    papel: resultado.papel,
    mensagem: mensagemDocumentoEnviado(resultado.impressora),
  };
}

export async function imprimirUrlPdfNoUltraPdvConector(input: {
  url: string;
  tipoDocumento?: string;
  papel?: string | null;
  copias?: number;
  impressora?: string | null;
}): Promise<ResultadoImpressaoConector> {
  const autorizado = await autorizarUsoConectorImpressaoAction();
  if (!autorizado.ok) {
    return {
      ok: false,
      erro: autorizado.erro,
      codigo: autorizado.codigo,
    };
  }

  try {
    const pdfBase64 = await baixarPdfComoBase64(input.url);
    return imprimirPdfNoUltraPdvConector({
      ...input,
      pdfBase64,
    });
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Não foi possível obter o documento.",
    };
  }
}
