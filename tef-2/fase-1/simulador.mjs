import { PWDAT, PWINFO, PWRET } from "./contrato.mjs";

export function criarSimuladorFase1(roteiro = "aprovada") {
  const resultados = new Map();
  let transacao = null;
  let etapa = 0;
  let confirmada = false;

  function executarInstalacao() {
    if (roteiro === "instalacao_falha") {
      return { codigo: PWRET.PPCOMERR, quantidade: 0, captura: [] };
    }
    if (roteiro === "instalacao_recusa" && etapa === 0) {
      etapa = 1;
      return { codigo: PWRET.CANCEL, quantidade: 0, captura: [] };
    }
    if (!transacao.params.has(PWINFO.POSID)) {
      if (etapa === 0) {
        etapa = 1;
        return { codigo: PWRET.NOTHING, quantidade: 0, captura: [] };
      }
      return {
        codigo: PWRET.MOREDATA,
        quantidade: 1,
        captura: [
          {
            wIdentificador: PWINFO.POSID,
            bTipoDeDado: PWDAT.TYPED,
            szPrompt: "Identificador do ponto",
            bTamanhoMinimo: 1,
            bTamanhoMaximo: 20,
          },
        ],
      };
    }
    resultados.set(PWINFO.CNFREQ, "1");
    resultados.set(PWINFO.REQNUM, "2001");
    resultados.set(PWINFO.AUTLOCREF, "INST-LOC");
    resultados.set(PWINFO.AUTEXTREF, "INST-EXT");
    resultados.set(PWINFO.VIRTMERCH, "7711001");
    resultados.set(PWINFO.AUTHSYST, "HOMOLOGACAO");
    resultados.set(PWINFO.RESULTMSG, "ponto instalado");
    resultados.set(PWINFO.IDLEPROCTIME, "000101000000");
    return { codigo: PWRET.OK, quantidade: 0, captura: [] };
  }

  const biblioteca = {
    real: false,
    espera: null,
    chamadas: [],
    async setEnvironment(codigo) {
      biblioteca.chamadas.push("PW_iSetEnvironment");
      return codigo === 0 || codigo === 1 ? PWRET.OK : PWRET.INVPARAM;
    },
    async init(diretorio) {
      biblioteca.chamadas.push("PW_iInit");
      if (!diretorio) return PWRET.WRITERR;
      resultados.set(PWINFO.IDLEPROCTIME, "991231235959");
      resultados.set(PWINFO.LIBVERSION, "4.1.50.924");
      return PWRET.OK;
    },
    async newTransac(operacao) {
      biblioteca.chamadas.push("PW_iNewTransac");
      biblioteca.operacao = operacao;
      transacao = { operacao, params: new Map() };
      etapa = 0;
      confirmada = false;
      return PWRET.OK;
    },
    async addParam(info, valor) {
      biblioteca.chamadas.push("PW_iAddParam");
      if (!transacao) return PWRET.TRNNOTINIT;
      if (typeof valor !== "string") return PWRET.INVPARAM;
      transacao.params.set(info, valor);
      biblioteca.informados = [...(biblioteca.informados ?? []), info];
      return PWRET.OK;
    },
    async execTransac(maximo) {
      biblioteca.chamadas.push("PW_iExecTransac");
      if (biblioteca.espera) await biblioteca.espera;
      if (!transacao) return { codigo: PWRET.TRNNOTINIT, quantidade: 0, captura: [] };
      if (maximo !== 9) return { codigo: PWRET.INVPARAM, quantidade: 0, captura: [] };
      if (transacao.operacao === 0x01) return executarInstalacao();
      for (const info of [PWINFO.AUTNAME, PWINFO.AUTVER, PWINFO.AUTDEV, PWINFO.AUTCAP]) {
        if (!transacao.params.get(info)) return { codigo: PWRET.NOMANDATORY, quantidade: 0, captura: [] };
      }
      if (roteiro === "timeout") return { codigo: PWRET.TIMEOUT, quantidade: 0, captura: [] };
      if (roteiro === "nothing" && etapa === 0) {
        etapa = 1;
        return { codigo: PWRET.NOTHING, quantidade: 0, captura: [] };
      }
      if ((roteiro === "aprovada" || roteiro === "nothing" || roteiro === "queda") && etapa < 2) {
        etapa = 2;
        return {
          codigo: PWRET.MOREDATA,
          quantidade: 1,
          captura: [
            {
              wIdentificador: PWINFO.CURRENCY,
              bTipoDeDado: PWDAT.MENU,
              szPrompt: "Modalidade",
              bNumOpcoesMenu: 2,
              vszTextoMenu: ["A vista", "Parcelado"],
              vszValorMenu: ["1", "2"],
            },
          ],
        };
      }
      if (roteiro === "digitado" && etapa < 2) {
        etapa = 2;
        return {
          codigo: PWRET.MOREDATA,
          quantidade: 1,
          captura: [
            {
              wIdentificador: PWINFO.FISCALREF,
              bTipoDeDado: PWDAT.TYPED,
              szPrompt: "Documento",
              bTamanhoMinimo: 1,
              bTamanhoMaximo: 20,
              bAceitaNulo: 0,
              bNumeroCapturas: 1,
            },
          ],
        };
      }
      if (roteiro === "pinpad" && etapa === 0) {
        etapa = 1;
        return {
          codigo: PWRET.MOREDATA,
          quantidade: 1,
          captura: [
            {
              wIdentificador: 0x7f15,
              bTipoDeDado: PWDAT.PPENTRY,
              szPrompt: "Digite no pinpad",
              bOcultarDadosDigitados: 0,
            },
          ],
        };
      }
      if (roteiro === "senha" && etapa === 0) {
        etapa = 1;
        return {
          codigo: PWRET.MOREDATA,
          quantidade: 1,
          captura: [
            {
              wIdentificador: PWINFO.CARDFULLPAN,
              bTipoDeDado: PWDAT.PPENCPIN,
              szPrompt: "Senha",
              bOcultarDadosDigitados: 1,
            },
          ],
        };
      }
      if (roteiro === "recusada") {
        resultados.set(PWINFO.CNFREQ, "0");
        resultados.set(PWINFO.REQNUM, "");
        resultados.set(PWINFO.AUTLOCREF, "");
        resultados.set(PWINFO.AUTEXTREF, "");
        resultados.set(PWINFO.VIRTMERCH, "");
        resultados.set(PWINFO.AUTHSYST, "");
        resultados.set(PWINFO.IDLEPROCTIME, "991231235959");
        return { codigo: PWRET.OK, quantidade: 0, captura: [] };
      }
      resultados.set(PWINFO.CNFREQ, "1");
      resultados.set(PWINFO.REQNUM, "1001");
      resultados.set(PWINFO.AUTLOCREF, "LOC-1");
      resultados.set(PWINFO.AUTEXTREF, "EXT-1");
      resultados.set(PWINFO.VIRTMERCH, "6696546");
      resultados.set(PWINFO.AUTHSYST, "SIMULADO");
      resultados.set(PWINFO.CARDFULLPAN, "4111111111111111");
      resultados.set(PWINFO.IDLEPROCTIME, "000101000000");
      return { codigo: PWRET.OK, quantidade: 0, captura: [] };
    },
    async getResult(info) {
      biblioteca.chamadas.push("PW_iGetResult");
      if (!resultados.has(info)) return { codigo: PWRET.NODATA, valor: "" };
      return { codigo: PWRET.OK, valor: resultados.get(info) };
    },
    async confirmation(status, tupla) {
      biblioteca.chamadas.push(["PW_iConfirmation", status]);
      if (!tupla) return PWRET.INVPARAM;
      confirmada = status === 0x00003221 || status === 0x00000121;
      biblioteca.ultimoStatus = status;
      return PWRET.OK;
    },
    async waitConfirmation() {
      biblioteca.chamadas.push("PW_iWaitConfirmation");
      return PWRET.OK;
    },
    async idleProc() {
      biblioteca.chamadas.push("PW_iIdleProc");
      if (biblioteca.recusarIdle) return PWRET.INVCALL;
      return PWRET.OK;
    },
    async ppGetData() {
      biblioteca.chamadas.push("PW_iPPGetData");
      return PWRET.OK;
    },
    async ppGetPIN() {
      biblioteca.chamadas.push("PW_iPPGetPIN");
      return PWRET.OK;
    },
    async ppEventLoop() {
      biblioteca.chamadas.push("PW_iPPEventLoop");
      if (biblioteca.exibir) {
        biblioteca.exibir = false;
        return { codigo: PWRET.DISPLAY, display: "Aguardando pinpad" };
      }
      return { codigo: PWRET.OK, display: "" };
    },
    async ppAbort() {
      biblioteca.chamadas.push("PW_iPPAbort");
      return PWRET.OK;
    },
    async ppCommTest() {
      biblioteca.chamadas.push("PW_iPPCommTest");
      if (roteiro === "pinpad_ausente") {
        return { codigo: PWRET.PPNOTFOUND, mensagem: "", porta: 0xff };
      }
      return { codigo: PWRET.OK, mensagem: "pinpad simulado", porta: 1 };
    },
  };
  biblioteca.exibir = roteiro === "pinpad";
  return biblioteca;
}
