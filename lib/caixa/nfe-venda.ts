/**
 * Nova NF-e → Venda só exige Caixa quando a natureza é venda comercial
 * nova (catálogo `tipo_operacao_interno` + `vincula_venda`), não pelo
 * rótulo da tela. NF-e sobre venda já existente não reabre o livro.
 */
export function nfeVendaNovaExigeCaixa(input: {
  tipoOperacaoInterno?: string | null;
  vinculaVenda?: boolean | null;
  vendaId?: string | null;
}): boolean {
  if (String(input.vendaId ?? "").trim()) {
    return false;
  }
  if (String(input.tipoOperacaoInterno ?? "").trim() !== "venda") {
    return false;
  }
  if (input.vinculaVenda === false) {
    return false;
  }
  return true;
}
