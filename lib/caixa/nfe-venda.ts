/**
 * Exigência de Caixa na NF-e 55: venda comercial ainda não materializada.
 * Não depende da URL (Nova vs Editar) nem do rótulo da natureza.
 *
 * Exige Caixa quando NÃO há venda_id e:
 * - `tipo_operacao_interno` (código do catálogo) é venda; ou
 * - `vincula_venda` do tipo de operação é true.
 */
function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function vendaIdNfeMaterializada(vendaId?: string | null) {
  const id = texto(vendaId);
  return Boolean(id) && id !== "null" && id !== "undefined";
}

export function nfeVendaNovaExigeCaixa(input: {
  tipoOperacaoInterno?: string | null;
  vinculaVenda?: boolean | null;
  vendaId?: string | null;
}): boolean {
  if (vendaIdNfeMaterializada(input.vendaId)) {
    return false;
  }
  const tipo = texto(input.tipoOperacaoInterno).toLowerCase();
  if (tipo === "venda") {
    return true;
  }
  return input.vinculaVenda === true;
}
