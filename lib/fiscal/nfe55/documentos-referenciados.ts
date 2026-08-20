export type DocumentoFiscalReferenciado = {
  chave: string;
  numero?: string | null;
  serie?: string | null;
  numeroItem?: number | null;
  documentoEntradaId?: string | null;
};

export const MENSAGEM_DEVOLUCAO_OUTRO_FORNECEDOR =
  "Não é possível adicionar itens de outro fornecedor nesta devolução. Crie uma devolução separada para esse fornecedor.";

export function somenteDigitosChave(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function chaveNfeValida(valor: unknown) {
  return somenteDigitosChave(valor).length === 44;
}

export function cnpjFornecedorCompativel(
  cnpjA: unknown,
  cnpjB: unknown
) {
  const a = somenteDigitosChave(cnpjA);
  const b = somenteDigitosChave(cnpjB);
  return a.length === 14 && a === b;
}

export function montarDocumentosReferenciados(
  documentos: DocumentoFiscalReferenciado[]
) {
  const vistos = new Set<string>();
  const unicos: DocumentoFiscalReferenciado[] = [];
  for (const documento of documentos) {
    const chave = somenteDigitosChave(documento.chave);
    if (!chaveNfeValida(chave) || vistos.has(chave)) {
      continue;
    }
    vistos.add(chave);
    unicos.push({
      ...documento,
      chave,
    });
  }
  return unicos;
}

/** Geranet aceita uma única chave 44 dígitos em nfe.notaFiscalReferencia. */
export function notaFiscalReferenciaGeranet(
  documentos: DocumentoFiscalReferenciado[]
) {
  return montarDocumentosReferenciados(documentos)[0]?.chave ?? "";
}

export function textoAutomaticoDocumentosReferenciados(
  documentos: DocumentoFiscalReferenciado[]
) {
  const unicos = montarDocumentosReferenciados(documentos);
  if (unicos.length === 0) {
    return "";
  }
  const lista = unicos
    .map((documento) => {
      const numero = documento.numero ? ` NF-e ${documento.numero}` : "";
      return `${numero} ${documento.chave}`.trim();
    })
    .join("; ");
  return `Devolução referente à(s) NF-e: ${lista}.`;
}
