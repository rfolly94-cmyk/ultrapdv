/**
 * PWINFO_AUTCAP, dicionário oficial da PGWebLib, capítulo 10.
 * O valor 4 é o termo fixo que a especificação manda incluir em toda soma.
 * Os demais valores só entram quando o fluxo correspondente existe e tem teste.
 * Bits a partir de 32 divergem entre o dicionário e o detalhamento do campo 706-000,
 * então não são enviados.
 */
export const AUTCAP_FIXO = 4;

export const CAPACIDADES_NAO_ENVIADAS = Object.freeze([
  { valor: 1, nome: "troco/saque" },
  { valor: 2, nome: "desconto" },
  { valor: 8, nome: "vias diferenciadas do comprovante" },
  { valor: 16, nome: "cupom reduzido" },
  { valor: 32, nome: "saldo de voucher ou valor devido" },
  { valor: 64, nome: "remoção do cartão ou valor reajustado" },
  { valor: 128, nome: "mensagem no checkout ou NSU de 40 caracteres" },
  { valor: 256, nome: "QR Code no checkout ou índice da aplicação" },
  { valor: 512, nome: "fluxo DCC" },
]);

export function calcularPwinfoAutcap(): string {
  return String(AUTCAP_FIXO);
}
