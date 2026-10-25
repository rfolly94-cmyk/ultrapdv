/**
 * Contrato Windows x64 da PGWebLib 4.1.50.924.
 * A SETIS informou que PWL_Type.h não é um arquivo separado necessário.
 * As larguras são as do PGWebLib.h compilado com o Visual C++ da DLL:
 * Int16 = int16, Byte = uint8, Word = uint16, Uint32 = uint32.
 * PW_iGetResult recebe ulDataSize por valor, como no header do kit.
 */

export const PWL_TYPE_SEPARADO_EXIGIDO = false;
export const TAMANHO_PW_GETDATA_WINDOWS = 12500;

export const ASSINATURAS_OFICIAIS_WINDOWS = Object.freeze({
  PW_iInit: "int16 __stdcall PW_iInit(str)",
  PW_iNewTransac: "int16 __stdcall PW_iNewTransac(uint8)",
  PW_iAddParam: "int16 __stdcall PW_iAddParam(uint16, str)",
  PW_iExecTransac: "int16 __stdcall PW_iExecTransac(_Out_ uint8 *capturas, _Inout_ int16 *quantidade)",
  PW_iGetResult: "int16 __stdcall PW_iGetResult(int16, _Out_ char *saida, uint32)",
  PW_iConfirmation: "int16 __stdcall PW_iConfirmation(uint32, str, str, str, str, str)",
  PW_iWaitConfirmation: "int16 __stdcall PW_iWaitConfirmation()",
  PW_iPPAbort: "int16 __stdcall PW_iPPAbort()",
  PW_iPPEventLoop: "int16 __stdcall PW_iPPEventLoop(_Out_ char *display, uint32)",
});

export const VERSAO_MINIMA_CONECTOR_TEF = "1.3.32";

export function contratoOficialAtual() {
  const assinaturas = Object.values(ASSINATURAS_OFICIAIS_WINDOWS);
  const tipos = assinaturas.every(
    (item) => item.startsWith("int16 __stdcall ") && !item.includes("PWL_Type")
  );
  const layout = TAMANHO_PW_GETDATA_WINDOWS === 12500;
  return {
    ok: tipos && layout && PWL_TYPE_SEPARADO_EXIGIDO === false,
    assinaturas: tipos,
    layout,
    pwlTypeSeparadoExigido: PWL_TYPE_SEPARADO_EXIGIDO,
    motivos: [] as string[],
  };
}

export function versaoConnectorAceita(versao: string) {
  const atual = String(versao ?? "")
    .split(".")
    .map((parte) => Number(parte));
  const minima = VERSAO_MINIMA_CONECTOR_TEF.split(".").map((parte) => Number(parte));
  for (let indice = 0; indice < 3; indice += 1) {
    const esquerda = Number.isFinite(atual[indice]) ? atual[indice] : 0;
    const direita = minima[indice] ?? 0;
    if (esquerda > direita) return true;
    if (esquerda < direita) return false;
  }
  return true;
}
