/** Motor antigo do Connector. Estas flags não liberam o UltraPDV.TEF em C#. */
export const MOTOR_UNICO = "pgweb" as const;
export const ABI_COMPROVADO = false;
export const LAYOUT_HOMOLOGADO = false;
export const PGWEB2_PRODUCAO = true;

export const MENSAGEM_COBRANCA_BLOQUEADA =
  "A cobrança TEF permanece bloqueada até a homologação do layout da PGWebLib. Nenhuma cobrança foi iniciada.";

export function cobrancaRealBloqueada() {
  const abi: boolean = ABI_COMPROVADO;
  const layout: boolean = LAYOUT_HOMOLOGADO;
  return !abi || !layout;
}
