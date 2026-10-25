export const DISPLAY_MINIMO_PGWEB = 100;
export const BUFFER_DISPLAY_IMPLEMENTADO = 128;

export const ROTEIRO_FISICO_HOMOLOGACAO = [
  "Mantenha ABI_COMPROVADO e LAYOUT_HOMOLOGADO falsos. Este roteiro não liga as flags e não começa pelo F2.",
  "Use somente o ambiente de homologação já gravado em Configurações, Financeiro, TEF, com o PinPad livre e uma pessoa presente.",
  "Não apague journal. Se houver resultado desconhecido, pare e reconcilie antes de qualquer captura.",
  "Numa única captura supervisionada, cancele no PinPad e registre o retorno imediato de PW_iPPAbort e o ciclo de PW_iPPEventLoop até PWRET_CANCEL, PWRET_TIMEOUT ou PWRET_PPCOMERR.",
  "Numa aprovação separada, leia REQNUM, AUTLOCREF, AUTEXTREF, VIRTMERCH e AUTHSYST. Só então chame PW_iConfirmation com o PWCNF correspondente e, em seguida, PW_iWaitConfirmation.",
  "Aprovação sem PWRET_OK nessas duas funções não é pagamento. Timeout, queda ou PWRET_FROMHOST sem recusa comprovada preservam o journal e impedem outra cobrança da mesma operação.",
  "A evidência física fica registrada para decisão posterior. O roteiro não promove produção nem emite NFC-e comercial.",
] as const;

export type DiagnosticoContratoNativo = {
  abort: boolean;
  evento: boolean;
  confirmacao: boolean;
  espera: boolean;
  divergencias: string[];
  abiComprovado: false;
  layoutHomologado: false;
  cobrancaIniciada: false;
  typedefNoKit: false;
  roteiro: readonly string[];
};

function exigir(divergencias: string[], ok: boolean, mensagem: string) {
  if (!ok) divergencias.push(mensagem);
}

export function diagnosticarContratoNativo(input: {
  header: string;
  conector: string;
  pascal: string;
}): DiagnosticoContratoNativo {
  const divergencias: string[] = [];
  const header = input.header;
  const conector = input.conector;
  const pascal = input.pascal;
  exigir(divergencias, header.includes("extern Int16 PW_EXPORT PW_iPPAbort(void);"), "PW_iPPAbort não confere com PGWebLib.h.");
  exigir(
    divergencias,
    header.includes("extern Int16 PW_EXPORT PW_iPPEventLoop (char *pszDisplay, Uint32 ulDisplaySize);"),
    "PW_iPPEventLoop não confere com PGWebLib.h."
  );
  exigir(
    divergencias,
    header.includes("extern Int16 PW_EXPORT PW_iConfirmation (Uint32 ulResult, const char* pszReqNum, const char* pszLocRef, const char* pszExtRef,"),
    "PW_iConfirmation não confere com PGWebLib.h."
  );
  exigir(divergencias, header.includes("const char* pszVirtMerch, const char* pszAuthSyst);"), "PW_iConfirmation não recebe as cinco referências do header.");
  exigir(divergencias, header.includes("extern Int16 PW_EXPORT PW_iWaitConfirmation(void);"), "PW_iWaitConfirmation não confere com PGWebLib.h.");
  exigir(divergencias, /PW_iPPEventLoop[\s\S]{0,900}100 bytes/.test(header), "PW_iPPEventLoop não documenta o buffer mínimo de 100 bytes.");
  exigir(divergencias, header.includes('#include "PWL_Type.h"'), "O header deixa a largura dos tipos em PWL_Type.h.");
  exigir(divergencias, conector.includes('PW_iPPAbort: "int16 __stdcall PW_iPPAbort()"'), "A assinatura koffi de PW_iPPAbort diverge.");
  exigir(
    divergencias,
    conector.includes('PW_iPPEventLoop: "int16 __stdcall PW_iPPEventLoop(_Out_ char *display, uint32)"'),
    "A assinatura koffi de PW_iPPEventLoop diverge."
  );
  exigir(
    divergencias,
    conector.includes('PW_iConfirmation: "int16 __stdcall PW_iConfirmation(uint32, str, str, str, str, str)"'),
    "A assinatura koffi de PW_iConfirmation diverge."
  );
  exigir(
    divergencias,
    conector.includes('PW_iWaitConfirmation: "int16 __stdcall PW_iWaitConfirmation()"'),
    "A assinatura koffi de PW_iWaitConfirmation diverge."
  );
  exigir(divergencias, conector.includes("Buffer.alloc(128)"), "O Connector não reserva 128 bytes para o display.");
  exigir(
    divergencias,
    pascal.includes("TPwConfirmation = function(ulResult: Cardinal; pszReqNum, pszLocRef, pszExtRef, pszVirtMerch, pszAuthSyst: PAnsiChar): SmallInt; stdcall;"),
    "O agente Pascal diverge em PW_iConfirmation."
  );
  exigir(
    divergencias,
    pascal.includes("TPwPPEventLoop = function(pszDisplay: PAnsiChar; ulDisplaySize: Cardinal): SmallInt; stdcall;"),
    "O agente Pascal diverge em PW_iPPEventLoop."
  );
  exigir(divergencias, pascal.includes("PPAbort: TPwVoid;"), "O agente Pascal diverge em PW_iPPAbort.");
  exigir(divergencias, pascal.includes("WaitConfirmation: TPwVoid;"), "O agente Pascal diverge em PW_iWaitConfirmation.");
  exigir(divergencias, pascal.includes("DISPLAY_MINIMO = 100;"), "O agente Pascal não guarda o mínimo de 100 bytes.");
  exigir(divergencias, pascal.includes("Buffer: array[0..127] of AnsiChar;"), "O agente Pascal não reserva 128 bytes ao display.");
  exigir(divergencias, pascal.includes("ABI_COMPROVADO = False;"), "ABI_COMPROVADO foi alterado sem evidência.");
  exigir(divergencias, pascal.includes("LAYOUT_HOMOLOGADO = False;"), "LAYOUT_HOMOLOGADO foi alterado sem evidência.");
  const menciona = (funcao: string) => divergencias.some((item) => item.includes(funcao));
  return {
    abort: !menciona("PW_iPPAbort"),
    evento: !menciona("PW_iPPEventLoop"),
    confirmacao: !menciona("PW_iConfirmation"),
    espera: !menciona("PW_iWaitConfirmation"),
    divergencias,
    abiComprovado: false,
    layoutHomologado: false,
    cobrancaIniciada: false,
    typedefNoKit: false,
    roteiro: ROTEIRO_FISICO_HOMOLOGACAO,
  };
}

export const TRECHOS_CONTRATO_NATIVO = {
  header: [
    "extern Int16 PW_EXPORT PW_iPPAbort(void);",
    "extern Int16 PW_EXPORT PW_iPPEventLoop (char *pszDisplay, Uint32 ulDisplaySize);",
    "extern Int16 PW_EXPORT PW_iConfirmation (Uint32 ulResult, const char* pszReqNum, const char* pszLocRef, const char* pszExtRef,",
    "const char* pszVirtMerch, const char* pszAuthSyst);",
    "extern Int16 PW_EXPORT PW_iWaitConfirmation(void);",
    "PW_iPPEventLoop",
    "100 bytes",
    '#include "PWL_Type.h"',
  ].join("\n"),
  conector: [
    'PW_iPPAbort: "int16 __stdcall PW_iPPAbort()"',
    'PW_iPPEventLoop: "int16 __stdcall PW_iPPEventLoop(_Out_ char *display, uint32)"',
    'PW_iConfirmation: "int16 __stdcall PW_iConfirmation(uint32, str, str, str, str, str)"',
    'PW_iWaitConfirmation: "int16 __stdcall PW_iWaitConfirmation()"',
    "Buffer.alloc(128)",
  ].join("\n"),
  pascal: [
    "TPwConfirmation = function(ulResult: Cardinal; pszReqNum, pszLocRef, pszExtRef, pszVirtMerch, pszAuthSyst: PAnsiChar): SmallInt; stdcall;",
    "TPwPPEventLoop = function(pszDisplay: PAnsiChar; ulDisplaySize: Cardinal): SmallInt; stdcall;",
    "PPAbort: TPwVoid;",
    "WaitConfirmation: TPwVoid;",
    "DISPLAY_MINIMO = 100;",
    "Buffer: array[0..127] of AnsiChar;",
    "ABI_COMPROVADO = False;",
    "LAYOUT_HOMOLOGADO = False;",
  ].join("\n"),
};

export function contratoNativoAtual() {
  return diagnosticarContratoNativo(TRECHOS_CONTRATO_NATIVO);
}
