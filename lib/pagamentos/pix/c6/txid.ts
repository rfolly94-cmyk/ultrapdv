const TXID_C6_MIN = 26;
const TXID_C6_MAX = 35;
const TXID_C6_ALFANUM = /^[a-zA-Z0-9]+$/;

export function ehTxidPixC6Valido(valor: string) {
  return (
    TXID_C6_ALFANUM.test(valor) &&
    valor.length >= TXID_C6_MIN &&
    valor.length <= TXID_C6_MAX
  );
}

export function gerarTxidPixC6() {
  const bruto = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(
    /-/g,
    ""
  );
  const txid = bruto.slice(0, 32);
  if (!ehTxidPixC6Valido(txid)) {
    throw new Error("Não foi possível gerar TXID PIX C6 válido.");
  }
  return txid;
}

export function reutilizarTxidC6AposFalha(txidExistente: string) {
  const txid = String(txidExistente ?? "").trim();
  if (!ehTxidPixC6Valido(txid)) {
    throw new Error("TXID C6 existente inválido. Não será gerada uma nova cobrança automaticamente.");
  }
  return txid;
}
