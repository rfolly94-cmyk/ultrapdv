import { imprimirPdfNoUltraPdvConector } from "./imprimir-pdf";
import type { ConfiguracaoImpressao, DestinoImpressaoAutomatica } from "./tipos";
import { baixarPdfComoBase64 } from "./agente";
import { configDoTipo, podeImprimirAutomaticamente } from "./regras";

export { imprimirPdfNoUltraPdvConector } from "./imprimir-pdf";
export { imprimirUrlPdfNoUltraPdvConector } from "./imprimir-pdf";

export async function imprimirPdfNaConfiguracao(
  config: ConfiguracaoImpressao,
  pdfBase64: string
) {
  return imprimirPdfNoUltraPdvConector({
    tipoDocumento: config.tipoDocumento,
    impressora: config.impressoraNome,
    copias: config.copias,
    papel: config.papel,
    pdfBase64,
  });
}

export async function executarDestinoImpressao(input: {
  destino: DestinoImpressaoAutomatica;
  configs: ConfiguracaoImpressao[];
  forcar?: boolean;
}) {
  const { destino, configs, forcar = false } = input;
  if (destino.tipo === "nenhum") {
    return { ok: true as const, pulou: true as const };
  }

  try {
    if (destino.tipo === "recibo") {
      const config = configDoTipo(configs, "recibo");
      if (!forcar && !podeImprimirAutomaticamente(config)) {
        return { ok: true as const, pulou: true as const };
      }
      const pdfBase64 = await baixarPdfComoBase64(
        `/api/impressao/recibo/${destino.vendaId}?papel=${config.papel}`
      );
      return imprimirPdfNaConfiguracao(config, pdfBase64);
    }

    const tipo = destino.tipo;
    const config = configDoTipo(configs, tipo);
    if (!forcar && !podeImprimirAutomaticamente(config)) {
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

