import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";

export type RecursoFiscalDocumento = "nfe" | "nfce";

export function recursoFiscalDoModelo(
  modelo: string | number | null | undefined
): RecursoFiscalDocumento | null {
  const valor = String(modelo ?? "").trim();
  if (valor === "55") {
    return "nfe";
  }
  if (valor === "65") {
    return "nfce";
  }
  return null;
}

const STATUS_RECONCILIACAO_SEGURA = new Set([
  "aguardando_reconciliacao",
  "enviando",
  "erro_comunicacao",
  "transmitindo_contingencia",
  "aguardando_transmissao_contingencia",
  "aguardando_inutilizacao",
]);

export function reconciliacaoFiscalDispensaPlano(emissao: {
  status?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
}) {
  const status = String(emissao.status ?? "").trim();
  if (STATUS_RECONCILIACAO_SEGURA.has(status)) {
    return true;
  }

  const estado = resolverEstadoOperacionalDeEmissaoPersistida(emissao);
  return (
    estado.documentoFiscalAmbiguo ||
    estado.estado === "ambigua" ||
    estado.estado === "em_transmissao"
  );
}
