export type PagamentoRascunhoNfe = {
  formaPagamentoId: string;
  valorCentavos: number;
  pixLocalRecebimentoId?: string | null;
};

function uuidValido(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor
  );
}

export function pagamentosRascunhoDoSnapshot(snapshot: unknown): PagamentoRascunhoNfe[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [];
  }
  const bruto = (snapshot as { pagamentos_rascunho?: unknown }).pagamentos_rascunho;
  if (!Array.isArray(bruto)) {
    return [];
  }
  return bruto.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const linha = item as Record<string, unknown>;
    const formaPagamentoId = String(linha.formaPagamentoId ?? "").trim();
    const valorCentavos = Math.round(Number(linha.valorCentavos ?? 0));
    const pix = linha.pixLocalRecebimentoId
      ? String(linha.pixLocalRecebimentoId).trim()
      : "";
    if (!uuidValido(formaPagamentoId) || !Number.isInteger(valorCentavos) || valorCentavos <= 0) {
      return [];
    }
    return [
      {
        formaPagamentoId,
        valorCentavos,
        pixLocalRecebimentoId: uuidValido(pix) ? pix : null,
      },
    ];
  });
}

export function mesclarSnapshotOperacao(
  atual: unknown,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const base =
    atual && typeof atual === "object" && !Array.isArray(atual)
      ? { ...(atual as Record<string, unknown>) }
      : {};
  return { ...base, ...extra };
}
