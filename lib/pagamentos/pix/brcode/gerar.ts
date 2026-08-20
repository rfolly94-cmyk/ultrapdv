import { montarPayloadPixEstatico, type DadosPixEstatico } from "./payload";
import { renderizarQrBrCode } from "./qr";
import { sanitizarTxidPix } from "./txid";

export async function gerarPixEstatico(dados: DadosPixEstatico) {
  const payload = montarPayloadPixEstatico(dados);
  const qrCode = await renderizarQrBrCode(payload);

  return {
    payload,
    qrCode,
    valor: dados.valor,
    txid: sanitizarTxidPix(dados.txid),
    pago: false as const,
  };
}
