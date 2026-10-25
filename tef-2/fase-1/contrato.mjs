/**
 * Constantes e tamanhos copiados do PGWebLib.h 4.1.50.924
 * e do dicionário PayGo (tamanho máximo do dado, não o buffer da chamada).
 * A DLL real permanece bloqueada: o kit não inclui PWL_Type.h.
 */

export const SELECAO_PRODUCAO = false;
export const DLL_ESPERADA = "4.1.50.924";
export const CAPTURAS_SUGERIDAS = 9;
export const DISPLAY_MINIMO_RECOMENDADO = 100;
export const MENSAGEM_PINPAD_MINIMA = 100;

export const IMPEDIMENTO_DLL =
  "PGWebLib.h inclui PWL_Type.h, ausente neste kit. Sem ele não há confirmação de Byte, Word, Int16, Uint16, Uint32, Bool nem do alinhamento de PW_GetData. Nenhuma função real é carregada.";

export const PWRET = Object.freeze({
  OK: 0,
  INVPARAM: -2499,
  NOTINST: -2498,
  MOREDATA: -2497,
  NODATA: -2496,
  DISPLAY: -2495,
  INVCALL: -2494,
  NOTHING: -2493,
  BUFOVFLW: -2492,
  CANCEL: -2491,
  TIMEOUT: -2490,
  PPNOTFOUND: -2489,
  TRNNOTINIT: -2488,
  DLLNOTINIT: -2487,
  FALLBACK: -2486,
  WRITERR: -2485,
  PPCOMERR: -2484,
  NOMANDATORY: -2483,
});

export const PWOPER = Object.freeze({
  INSTALL: 0x01,
  ADMIN: 0x20,
  SALE: 0x21,
  SALEVOID: 0x22,
});

export const PWCNF = Object.freeze({
  CNF_AUTO: 0x00000121,
  CNF_MANU_AUT: 0x00003221,
  REV_MANU_AUT: 0x00003231,
  REV_PRN_AUT: 0x00013131,
  REV_DISP_AUT: 0x00023131,
  REV_COMM_AUT: 0x00033131,
  REV_ABORT: 0x00043131,
  REV_OTHER_AUT: 0x00073131,
  REV_PWR_AUT: 0x00083131,
  REV_FISC_AUT: 0x00093131,
});

export const PWINFO = Object.freeze({
  AUTNAME: 0x15,
  AUTVER: 0x16,
  AUTDEV: 0x17,
  MERCHCNPJCPF: 0x1c,
  AUTCAP: 0x24,
  TOTAMNT: 0x25,
  CURRENCY: 0x26,
  CURREXP: 0x27,
  FISCALREF: 0x28,
  REQNUM: 0x32,
  AUTHSYST: 0x35,
  VIRTMERCH: 0x36,
  RESULTMSG: 0x42,
  CNFREQ: 0x43,
  AUTLOCREF: 0x44,
  AUTEXTREF: 0x45,
  CARDFULLPAN: 0xc1,
  CARDEXPDATE: 0xc2,
  CARDPARCPAN: 0xc8,
  IDLEPROCTIME: 0x7f04,
  LIBVERSION: 0x7f21,
});

export const PWDAT = Object.freeze({
  MENU: 1,
  TYPED: 2,
  CARDINF: 3,
  PPENTRY: 5,
  PPENCPIN: 6,
  CARDOFF: 9,
  CARDONL: 10,
  PPCONF: 11,
  BARCODE: 12,
  PPREMCRD: 13,
  PPGENCMD: 14,
  PPDATAPOSCNF: 16,
  USERAUTH: 17,
  DSPCHECKOUT: 18,
  TSTKEY: 19,
  DSPQRCODE: 20,
});

export const AMBIENTE = Object.freeze({
  producao: 0,
  homologacao: 1,
});

/** Tamanho máximo do valor ASCII no dicionário PayGo. O buffer de PW_iGetResult precisa ser maior; a chamada real está bloqueada. */
export const TAMANHO_DADO = Object.freeze({
  [PWINFO.CNFREQ]: 1,
  [PWINFO.REQNUM]: 10,
  [PWINFO.AUTHSYST]: 20,
  [PWINFO.VIRTMERCH]: 9,
  [PWINFO.AUTLOCREF]: 50,
  [PWINFO.AUTEXTREF]: 50,
  [PWINFO.IDLEPROCTIME]: 12,
});

export const CAMPOS_CONFIRMACAO = Object.freeze([
  ["cnfReq", PWINFO.CNFREQ],
  ["reqNum", PWINFO.REQNUM],
  ["locRef", PWINFO.AUTLOCREF],
  ["extRef", PWINFO.AUTEXTREF],
  ["virtMerch", PWINFO.VIRTMERCH],
  ["authSyst", PWINFO.AUTHSYST],
]);

export const INFOS_SENSIVEIS = new Set([
  PWINFO.MERCHCNPJCPF,
  PWINFO.CARDFULLPAN,
  PWINFO.CARDEXPDATE,
  PWINFO.CARDPARCPAN,
]);

export const TIPOS_SENSIVEIS = new Set([
  PWDAT.CARDINF,
  PWDAT.PPENCPIN,
  PWDAT.USERAUTH,
]);

/** Função oficial cujo comentário no header liga o PWDAT ao iniciador. Tipos sem essa frase ficam bloqueados. */
export const INICIO_PINPAD = Object.freeze({
  [PWDAT.CARDINF]: "ppGetCard",
  [PWDAT.PPENCPIN]: "ppGetPIN",
  [PWDAT.PPENTRY]: "ppGetData",
  [PWDAT.CARDOFF]: "ppGoOnChip",
  [PWDAT.CARDONL]: "ppFinishChip",
  [PWDAT.PPCONF]: "ppConfirmData",
  [PWDAT.PPREMCRD]: "ppRemoveCard",
  [PWDAT.PPGENCMD]: "ppGenericCMD",
  [PWDAT.PPDATAPOSCNF]: "ppPositiveConfirmation",
  [PWDAT.TSTKEY]: "ppTestKey",
});

export const PWCNF_POR_MOTIVO = Object.freeze({
  automatica: PWCNF.CNF_AUTO,
  manual: PWCNF.CNF_MANU_AUT,
  desfazer_manual: PWCNF.REV_MANU_AUT,
  aborto: PWCNF.REV_ABORT,
  queda: PWCNF.REV_PWR_AUT,
  fiscal: PWCNF.REV_FISC_AUT,
  comunicacao: PWCNF.REV_COMM_AUT,
  mercadoria: PWCNF.REV_DISP_AUT,
  outro: PWCNF.REV_OTHER_AUT,
});

const NOMES = new Map([
  [PWRET.OK, "PWRET_OK"],
  [PWRET.INVPARAM, "PWRET_INVPARAM"],
  [PWRET.NOTINST, "PWRET_NOTINST"],
  [PWRET.MOREDATA, "PWRET_MOREDATA"],
  [PWRET.NODATA, "PWRET_NODATA"],
  [PWRET.DISPLAY, "PWRET_DISPLAY"],
  [PWRET.INVCALL, "PWRET_INVCALL"],
  [PWRET.NOTHING, "PWRET_NOTHING"],
  [PWRET.BUFOVFLW, "PWRET_BUFOVFLW"],
  [PWRET.CANCEL, "PWRET_CANCEL"],
  [PWRET.TIMEOUT, "PWRET_TIMEOUT"],
  [PWRET.PPNOTFOUND, "PWRET_PPNOTFOUND"],
  [PWRET.TRNNOTINIT, "PWRET_TRNNOTINIT"],
  [PWRET.DLLNOTINIT, "PWRET_DLLNOTINIT"],
  [PWRET.FALLBACK, "PWRET_FALLBACK"],
  [PWRET.WRITERR, "PWRET_WRITERR"],
  [PWRET.PPCOMERR, "PWRET_PPCOMERR"],
  [PWRET.NOMANDATORY, "PWRET_NOMANDATORY"],
]);

const DESCRICOES = new Map([
  [PWRET.NOTINST, "É necessário efetuar uma transação de Instalação."],
]);

export function nomeRetorno(codigo) {
  return NOMES.get(Number(codigo)) ?? `PWRET_${codigo}`;
}

export function descricaoRetorno(codigo) {
  return DESCRICOES.get(Number(codigo)) ?? "";
}

export function textoLimite(valor, limite) {
  const texto = typeof valor === "string" ? valor : "";
  return texto.length > limite ? texto.slice(0, limite) : texto;
}

/** Formato AAMMDDHHMMSS do dicionário. O fuso não está documentado; a comparação usa o relógio local. */
export function horarioIdle(valor, agora = new Date()) {
  if (typeof valor !== "string" || !/^\d{12}$/.test(valor)) return null;
  const ano = 2000 + Number(valor.slice(0, 2));
  const mes = Number(valor.slice(2, 4));
  const dia = Number(valor.slice(4, 6));
  const hora = Number(valor.slice(6, 8));
  const minuto = Number(valor.slice(8, 10));
  const segundo = Number(valor.slice(10, 12));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) {
    return null;
  }
  const data = new Date(ano, mes - 1, dia, hora, minuto, segundo);
  if (Number.isNaN(data.getTime())) return null;
  void agora;
  return data;
}
