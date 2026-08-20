/** URL pública já resolvida pelo storage — não o path bruto do banco. */
export function logoUrlUtilizavel(url: string | null | undefined): string | null {
  const valor = String(url ?? "").trim();
  if (!valor) {
    return null;
  }
  if (!/^https?:\/\//i.test(valor)) {
    return null;
  }
  return valor;
}
