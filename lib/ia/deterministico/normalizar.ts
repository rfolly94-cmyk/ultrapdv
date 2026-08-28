export function normalizarTextoDeterministico(texto: string) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function textoSemPeriodo(textoNormalizado: string, trechoPeriodo: string | null) {
  if (!trechoPeriodo) {
    return textoNormalizado;
  }
  return textoNormalizado.replace(trechoPeriodo, " ").replace(/\s+/g, " ").trim();
}
