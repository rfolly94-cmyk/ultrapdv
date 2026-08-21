import {
  baixarPdfComoBase64,
  enviarImpressaoAgente,
} from "./agente";
import type { ConfiguracaoImpressao, DestinoImpressaoAutomatica } from "./tipos";
import { configDoTipo, podeImprimirAutomaticamente } from "./regras";

export async function imprimirPdfNaConfiguracao(
  config: ConfiguracaoImpressao,
  pdfBase64: string
) {
  const impressora = String(config.impressoraNome ?? "").trim();
  if (!impressora) {
    return { ok: false as const, erro: "Selecione uma impressora." };
  }

  return enviarImpressaoAgente({
    tipoDocumento: config.tipoDocumento,
    impressora,
    copias: config.copias,
    papel: config.papel,
    pdfBase64,
  });
}

export async function executarDestinoImpressao(input: {
  destino: DestinoImpressaoAutomatica;
  configs: ConfiguracaoImpressao[];
}) {
  const { destino, configs } = input;
  if (destino.tipo === "nenhum") {
    return { ok: true as const, pulou: true as const };
  }

  try {
    if (destino.tipo === "recibo") {
      const config = configDoTipo(configs, "recibo");
      if (!podeImprimirAutomaticamente(config)) {
        return { ok: true as const, pulou: true as const };
      }
      const pdfBase64 = await baixarPdfComoBase64(
        `/api/impressao/recibo/${destino.vendaId}?papel=${config.papel}`
      );
      return imprimirPdfNaConfiguracao(config, pdfBase64);
    }

    const tipo = destino.tipo;
    const config = configDoTipo(configs, tipo);
    if (!podeImprimirAutomaticamente(config)) {
      return { ok: true as const, pulou: true as const };
    }
    const pdfBase64 = await baixarPdfComoBase64(
      `/api/impressao/danfe/${destino.emissaoId}`
    );
    return imprimirPdfNaConfiguracao(config, pdfBase64);
  } catch (error) {
    return {
      ok: false as const,
      erro:
        error instanceof Error
          ? error.message
          : "Não foi possível imprimir automaticamente.",
    };
  }
}
