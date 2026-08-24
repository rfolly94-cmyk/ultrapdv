export function parseValorCaixa(valor: string | number | null | undefined) {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      return null;
    }
    return Math.round(valor * 100) / 100;
  }

  const textoOriginal = String(valor ?? "").trim();
  if (!textoOriginal) {
    return null;
  }

  let texto = textoOriginal;
  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero)) {
    return null;
  }

  return Math.round(numero * 100) / 100;
}

export function uuidCaixaValido(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor
  );
}

export function mensagemErroCaixa(erro: unknown, fallback: string) {
  const texto =
    erro instanceof Error
      ? erro.message
      : typeof erro === "string"
        ? erro
        : "";
  const limpo = String(texto ?? "").trim();
  if (!limpo) {
    return fallback;
  }
  if (
    /rpc_|postgres|permission denied|jwt|stack|function public\./i.test(limpo)
  ) {
    return fallback;
  }
  return limpo;
}
