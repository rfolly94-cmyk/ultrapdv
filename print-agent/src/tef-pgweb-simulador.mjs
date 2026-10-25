import { PWINFO, PWRET, PWDAT } from "./tef-pgweb.mjs";

/**
 * Biblioteca em memória com os mesmos códigos do header.
 * Não abre socket, pinpad nem a DLL.
 */
export function criarSimuladorPgWeb(roteiro = "aprovada") {
  const resultados = new Map();
  let transacao = null;
  let etapa = 0;
  let confirmada = false;
  const nome = roteiro;

  function guardarAprovada() {
    resultados.set(PWINFO.CNFREQ, "1");
    resultados.set(PWINFO.REQNUM, "1001");
    resultados.set(PWINFO.AUTLOCREF, "LOC-1");
    resultados.set(PWINFO.AUTEXTREF, "EXT-1");
    resultados.set(PWINFO.VIRTMERCH, "6696546");
    resultados.set(PWINFO.AUTHSYST, "SIMULADO");
    resultados.set(PWINFO.AUTHCODE, "ABC123");
    resultados.set(PWINFO.AUTRESPCODE, "00");
    resultados.set(PWINFO.RESULTMSG, "Aprovado no simulador");
    resultados.set(PWINFO.RCPTMERCH, "VIA ESTABELECIMENTO");
    resultados.set(PWINFO.RCPTCHOLDER, "VIA CLIENTE");
    resultados.set(PWINFO.IDLEPROCTIME, "30");
    resultados.set(PWINFO.LIBVERSION, "4.1.50.924");
  }

  return {
    real: false,
    async setEnvironment(codigo) {
      if (nome === "ambiente_invalido") return PWRET.INVPARAM;
      return codigo === 0 || codigo === 1 ? PWRET.OK : PWRET.INVPARAM;
    },
    async init(diretorio) {
      if (!diretorio || nome === "diretorio") return PWRET.WRITERR;
      resultados.set(PWINFO.IDLEPROCTIME, "30");
      resultados.set(PWINFO.LIBVERSION, "4.1.50.924");
      return PWRET.OK;
    },
    async newTransac(operacao) {
      if (nome === "nao_instalado" && operacao !== 0x01) return PWRET.NOTINST;
      transacao = { operacao, params: new Map(), etapa: 0 };
      etapa = 0;
      confirmada = false;
      return PWRET.OK;
    },
    async addParam(info, valor) {
      if (!transacao) return PWRET.TRNNOTINIT;
      if (typeof valor !== "string" || valor.includes("ç") || /[^\x20-\x7e]/u.test(valor)) {
        return PWRET.INVPARAM;
      }
      transacao.params.set(info, valor);
      return PWRET.OK;
    },
    async execTransac() {
      if (!transacao) return { codigo: PWRET.TRNNOTINIT, captura: [] };
      for (const info of [PWINFO.AUTNAME, PWINFO.AUTVER, PWINFO.AUTDEV, PWINFO.AUTCAP]) {
        if (!transacao.params.get(info)) return { codigo: PWRET.NOMANDATORY, captura: [] };
      }
      if (nome === "timeout") return { codigo: PWRET.TIMEOUT, captura: [] };
      if (nome === "recusada") {
        resultados.set(PWINFO.CNFREQ, "0");
        resultados.set(PWINFO.AUTRESPCODE, "51");
        resultados.set(PWINFO.RESULTMSG, "Recusado no simulador");
        resultados.set(PWINFO.REQNUM, "");
        resultados.set(PWINFO.IDLEPROCTIME, "30");
        return { codigo: PWRET.OK, captura: [] };
      }
      if (nome === "nothing" && etapa === 0) {
        etapa = 1;
        return { codigo: PWRET.NOTHING, captura: [] };
      }
      if ((nome === "aprovada" || nome === "nothing" || nome === "abortar") && etapa < 2) {
        etapa = 2;
        return {
          codigo: PWRET.MOREDATA,
          captura: [
            {
              wIdentificador: PWINFO.FINTYPE,
              bTipoDeDado: PWDAT.MENU,
              szPrompt: "Modalidade",
              opcoes: ["A vista", "Parcelado"],
              valores: ["1", "2"],
            },
          ],
        };
      }
      guardarAprovada();
      return { codigo: PWRET.OK, captura: [] };
    },
    async getResult(info) {
      if (!resultados.has(info)) return { codigo: PWRET.NODATA, valor: "" };
      return { codigo: PWRET.OK, valor: resultados.get(info) };
    },
    async confirmation(status, tupla) {
      if (nome === "confirmacao_invalida") return PWRET.INVPARAM;
      if (!tupla || typeof tupla.reqNum !== "string") return PWRET.INVPARAM;
      confirmada = status === 0x00003221 || status === 0x00000121;
      return PWRET.OK;
    },
    async waitConfirmation() {
      return confirmada || nome !== "espera" ? PWRET.OK : PWRET.TIMEOUT;
    },
    async idleProc() {
      return PWRET.OK;
    },
    async ppCommTest(porta) {
      if (nome === "pinpad_ausente") return { codigo: PWRET.PPNOTFOUND, mensagem: "", porta: 0xff };
      return { codigo: PWRET.OK, mensagem: "pinpad simulado", porta: Number(porta) || 1 };
    },
    async ppEventLoop() {
      return { codigo: PWRET.OK, display: "" };
    },
  };
}
