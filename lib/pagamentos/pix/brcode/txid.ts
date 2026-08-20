const TXID_PERMITIDO = /[^a-zA-Z0-9]/g;
const TXID_MAXIMO = 25;

export function sanitizarTxidPix(valor: string) {
  const limpo = valor.replace(TXID_PERMITIDO, "").slice(0, TXID_MAXIMO);
  if (!limpo) {
    throw new Error("TXID PIX inválido.");
  }
  return limpo;
}

export function gerarTxidPixLocal(params?: {
  vendaId?: string | null;
  numeroVenda?: string | number | null;
}) {
  const numero = String(params?.numeroVenda ?? "").replace(/\D/g, "");
  if (numero) {
    return sanitizarTxidPix(`V${numero}`);
  }

  const venda = String(params?.vendaId ?? "").replace(/-/g, "");
  if (venda) {
    return sanitizarTxidPix(`U${venda}`);
  }

  return sanitizarTxidPix(`T${Date.now().toString(36).toUpperCase()}`);
}

export function gerarTxidPixLocalPdv() {
  const agora = Date.now().toString(36).toUpperCase();
  const aleatorio = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return sanitizarTxidPix(`T${agora}${aleatorio}`);
}

export function ehTxidPixValido(valor: string) {
  return /^[a-zA-Z0-9]{1,25}$/.test(valor);
}
