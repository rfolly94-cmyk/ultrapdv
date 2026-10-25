/**
 * Ciclo TEF 2.0 da PGWebLib 4.1.50.924 sem Warsaw.
 * Constantes conferidas em PGWebLib.h. A DLL real não é carregada aqui.
 */
import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path, { dirname } from "node:path";

import { calcularPwinfoAutcap } from "./tef-autcap.mjs";

export const VERSAO_CICLO = "2.0.0";
export const DLL_ESPERADA = "4.1.50.924";
export const MOTOR_PADRAO = "pgweb";
export const PGWEB2_PRODUCAO = true;
export const ABI_COMPROVADO = false;
export const LAYOUT_HOMOLOGADO = false;

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
  CARDTYPE: 0x29,
  REQNUM: 0x32,
  AUTHSYST: 0x35,
  VIRTMERCH: 0x36,
  FINTYPE: 0x3b,
  INSTALLMENTS: 0x3c,
  RESULTMSG: 0x42,
  CNFREQ: 0x43,
  AUTLOCREF: 0x44,
  AUTEXTREF: 0x45,
  AUTHCODE: 0x46,
  AUTRESPCODE: 0x47,
  RCPTMERCH: 0x53,
  RCPTCHOLDER: 0x54,
  SERVERPND: 0x7f0b,
  PNDAUTHSYST: 0x7f05,
  PNDVIRTMERCH: 0x7f06,
  PNDREQNUM: 0x7f07,
  PNDAUTLOCREF: 0x7f08,
  PNDAUTEXTREF: 0x7f09,
  IDLEPROCTIME: 0x7f04,
  PPINFO: 0x7f15,
  RESULTID: 0x7f16,
  LIBVERSION: 0x7f21,
});

export const SEQUENCIA_REFERENCIAS_PENDENTES = Object.freeze([
  Object.freeze({ nome: "PWINFO_PNDREQNUM", info: PWINFO.PNDREQNUM }),
  Object.freeze({ nome: "PWINFO_PNDAUTLOCREF", info: PWINFO.PNDAUTLOCREF }),
  Object.freeze({ nome: "PWINFO_PNDAUTEXTREF", info: PWINFO.PNDAUTEXTREF }),
  Object.freeze({ nome: "PWINFO_PNDVIRTMERCH", info: PWINFO.PNDVIRTMERCH }),
  Object.freeze({ nome: "PWINFO_PNDAUTHSYST", info: PWINFO.PNDAUTHSYST }),
]);

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
  DSPCHECKOUT: 18,
  DSPQRCODE: 20,
});

export const AMBIENTE_PGWEB = Object.freeze({
  producao: 0,
  homologacao: 1,
});

export const ASSINATURAS_NATIVAS = Object.freeze({
  PW_iInit: "int16 __stdcall PW_iInit(str)",
  PW_iSetEnvironment: "int16 __stdcall PW_iSetEnvironment(int16)",
  PW_iNewTransac: "int16 __stdcall PW_iNewTransac(uint8)",
  PW_iAddParam: "int16 __stdcall PW_iAddParam(uint16, str)",
  PW_iExecTransac: "int16 __stdcall PW_iExecTransac(_Out_ uint8 *capturas, _Inout_ int16 *quantidade)",
  PW_iGetResult: "int16 __stdcall PW_iGetResult(int16, _Out_ char *saida, uint32)",
  PW_iConfirmation: "int16 __stdcall PW_iConfirmation(uint32, str, str, str, str, str)",
  PW_iWaitConfirmation: "int16 __stdcall PW_iWaitConfirmation()",
  PW_iIdleProc: "int16 __stdcall PW_iIdleProc()",
  PW_End: "void __stdcall PW_End()",
  PW_iPPEventLoop: "int16 __stdcall PW_iPPEventLoop(_Out_ char *display, uint32)",
  PW_iPPAbort: "int16 __stdcall PW_iPPAbort()",
  PW_iPPGetCard: "int16 __stdcall PW_iPPGetCard(uint16)",
  PW_iPPGetData: "int16 __stdcall PW_iPPGetData(uint16)",
  PW_iPPGetPIN: "int16 __stdcall PW_iPPGetPIN(uint16)",
  PW_iPPGoOnChip: "int16 __stdcall PW_iPPGoOnChip(uint16)",
  PW_iPPFinishChip: "int16 __stdcall PW_iPPFinishChip(uint16)",
  PW_iPPConfirmData: "int16 __stdcall PW_iPPConfirmData(uint16)",
  PW_iPPRemoveCard: "int16 __stdcall PW_iPPRemoveCard()",
  PW_iPPGenericCMD: "int16 __stdcall PW_iPPGenericCMD(uint16)",
  PW_iPPPositiveConfirmation: "int16 __stdcall PW_iPPPositiveConfirmation(uint16)",
  PW_iPPCommTest: "int16 __stdcall PW_iPPCommTest(_Out_ char *mensagem, uint16, _Out_ uint8 *porta)",
  PW_iPPDisplay: "int16 __stdcall PW_iPPDisplay(str)",
  PW_iPPSetIdleImage: "int16 __stdcall PW_iPPSetIdleImage(str, str)",
});

async function pontoJaInstalado(diretorio) {
  const base = path.win32.join(String(diretorio ?? ""), "Data");
  try {
    await access(path.win32.join(base, "certificado.crt"));
    await access(path.win32.join(base, "check.pos"));
    return true;
  } catch {
    return false;
  }
}

export function assinaturaNativa(nome) {
  const assinatura = ASSINATURAS_NATIVAS[nome];
  if (!assinatura) {
    throw new Error("Assinatura nativa ausente no contrato da PGWebLib.");
  }
  return assinatura;
}

const NOMES_RETORNO = new Map([
  [PWRET.OK, "PWRET_OK"],
  [PWRET.INVPARAM, "PWRET_INVPARAM"],
  [PWRET.NOTINST, "PWRET_NOTINST"],
  [PWRET.MOREDATA, "PWRET_MOREDATA"],
  [PWRET.NODATA, "PWRET_NODATA"],
  [PWRET.DISPLAY, "PWRET_DISPLAY"],
  [PWRET.INVCALL, "PWRET_INVCALL"],
  [PWRET.NOTHING, "PWRET_NOTHING"],
  [PWRET.CANCEL, "PWRET_CANCEL"],
  [PWRET.TIMEOUT, "PWRET_TIMEOUT"],
  [PWRET.PPNOTFOUND, "PWRET_PPNOTFOUND"],
  [PWRET.TRNNOTINIT, "PWRET_TRNNOTINIT"],
  [PWRET.DLLNOTINIT, "PWRET_DLLNOTINIT"],
  [PWRET.WRITERR, "PWRET_WRITERR"],
  [PWRET.PPCOMERR, "PWRET_PPCOMERR"],
  [PWRET.NOMANDATORY, "PWRET_NOMANDATORY"],
]);

export function nomeCodigoPw(codigo) {
  const numero = Number(codigo);
  if (!Number.isInteger(numero)) return "sem código numérico";
  return NOMES_RETORNO.get(numero) ?? `codigo ${numero}`;
}

const INFOS_SENSIVEIS = new Set([
  PWINFO.MERCHCNPJCPF,
  0xc1,
  0xc2,
]);

const TIPOS_SENSIVEIS = new Set([PWDAT.CARDINF, PWDAT.PPENCPIN]);

/** AAMMDDHHMMSS do dicionário. Formato inválido não vira um intervalo inventado. */
export function horarioIdle(valor) {
  if (typeof valor !== "string" || !/^\d{12}$/.test(valor)) return null;
  const ano = 2000 + Number(valor.slice(0, 2));
  const mes = Number(valor.slice(2, 4));
  const dia = Number(valor.slice(4, 6));
  const hora = Number(valor.slice(6, 8));
  const minuto = Number(valor.slice(8, 10));
  const segundo = Number(valor.slice(10, 12));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) return null;
  const data = new Date(ano, mes - 1, dia, hora, minuto, segundo);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return data;
}

export function nomeRetorno(codigo) {
  return NOMES_RETORNO.get(Number(codigo)) ?? `PWRET_${codigo}`;
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function agora() {
  return new Date().toISOString();
}

export function criarBibliotecaRealBloqueada() {
  const recusa = async () => {
    throw Object.assign(
      new Error(
        "A PGWebLib real permanece desligada até a homologação em equipamento. Nenhuma chamada de produção foi feita."
      ),
      { code: "PGWEB_REAL_BLOQUEADA" }
    );
  };
  return {
    real: true,
    setEnvironment: recusa,
    init: recusa,
    newTransac: recusa,
    addParam: recusa,
    execTransac: recusa,
    getResult: recusa,
    confirmation: recusa,
    waitConfirmation: recusa,
    idleProc: recusa,
    ppCommTest: recusa,
    ppEventLoop: recusa,
  };
}

function capturaPublica(item) {
  const tipo = Number(item?.bTipoDeDado);
  return {
    identificador: Number(item?.wIdentificador),
    tipo,
    prompt: texto(item?.szPrompt).slice(0, 84),
    opcoes: Array.isArray(item?.opcoes) ? item.opcoes.map((opcao) => texto(opcao).slice(0, 41)) : [],
    valores: Array.isArray(item?.valores) ? item.valores.map((opcao) => texto(opcao).slice(0, 41)) : [],
    sensivel: TIPOS_SENSIVEIS.has(tipo),
  };
}

export class SessaoPgWeb {
  constructor({
    biblioteca,
    dispositivoId = "",
    moeda = "986",
    expoente = "2",
    arquivo = "",
    agendar = null,
  } = {}) {
    if (!biblioteca || biblioteca.real === true) {
      throw new Error("A sessão 2.0 de ensaio exige o simulador. A DLL real não entra neste processo.");
    }
    this.biblioteca = biblioteca;
    this.dispositivoId = texto(dispositivoId);
    this.moeda = texto(moeda) || "986";
    this.expoente = texto(expoente) || "2";
    this.estado = "ociosa";
    this.inicializada = false;
    this.ambiente = null;
    this.pontoInstalado = false;
    this.captura = null;
    this.transacao = null;
    this.journal = null;
    this.eventos = [];
    this.proximaOciosidade = null;
    this.ocupado = false;
    this.ultimo = null;
    this.arquivo = texto(arquivo);
    this.agendar = typeof agendar === "function" ? agendar : null;
    this.timerOciosidade = null;
    this.erroJournal = "";
  }

  registrar(funcao, codigo, extra = {}) {
    this.eventos.push({
      em: agora(),
      funcao,
      codigo: Number(codigo),
      nome: nomeRetorno(codigo),
      ...extra,
    });
    if (this.eventos.length > 80) {
      this.eventos.splice(0, this.eventos.length - 80);
    }
  }

  exigirDispositivo(dispositivoId) {
    const pedido = texto(dispositivoId);
    if (!this.dispositivoId || !pedido || pedido !== this.dispositivoId) {
      return {
        ok: false,
        codigo: "DISPOSITIVO",
        mensagem: "O computador desta sessão não é o dispositivo vinculado ao Connector.",
      };
    }
    return null;
  }

  async inicializar({ ambiente, diretorio, dispositivoId }) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    if (this.ocupado) return this.ocupada();
    const codigoAmbiente = AMBIENTE_PGWEB[ambiente];
    if (codigoAmbiente === undefined || !texto(diretorio)) {
      return this.falha(PWRET.INVPARAM, "Ambiente ou diretório de trabalho ausente.");
    }
    this.ocupado = true;
    try {
      await this.carregarJournal();
      if (this.erroJournal) return this.falha("JOURNAL", this.erroJournal);
      if (!this.inicializada) {
        const instalado = await pontoJaInstalado(diretorio);
        if (!instalado) {
          const ambienteCodigo = await this.biblioteca.setEnvironment(codigoAmbiente);
          this.registrar("PW_iSetEnvironment", ambienteCodigo, { ambiente });
          if (ambienteCodigo !== PWRET.OK) {
            return this.falha(
              ambienteCodigo,
              "PW_iSetEnvironment recusou o ambiente. A função só é válida antes de PW_iInit e antes da instalação do ponto."
            );
          }
        }
        const init = await this.biblioteca.init(diretorio);
        this.registrar("PW_iInit", init);
        if (init !== PWRET.OK) {
          return this.falha(init, "PW_iInit recusou o diretório de trabalho.");
        }
        this.inicializada = true;
        this.ambiente = ambiente;
      }
      await this.lerOciosidade();
      const statusJournal = this.journal?.status;
      this.estado =
        statusJournal === "aguardando_confirmacao" || statusJournal === "aguardando_captura"
          ? statusJournal
          : "ociosa";
      return {
        ok: true,
        pago: false,
        estado: this.estado,
        codigo: PWRET.OK,
        nome: "PWRET_OK",
        dll: DLL_ESPERADA,
        warsaw: false,
        pendencia: this.journal,
      };
    } finally {
      this.ocupado = false;
    }
  }

  async instalar({ dispositivoId, ponto, cnpj }) {
    const pronto = await this.exigirPronta(dispositivoId);
    if (pronto) return pronto;
    this.ocupado = true;
    this.estado = "instalando";
    try {
      const aberta = await this.abrirTransacao(PWOPER.INSTALL, {
        ponto,
        cnpj,
      });
      if (!aberta.ok) return aberta;
      return await this.executarAteParar();
    } finally {
      this.ocupado = false;
    }
  }

  async vender({ dispositivoId, identificador, valorCentavos, modalidade, parcelas = 1 }) {
    const pronto = await this.exigirPronta(dispositivoId);
    if (pronto) return pronto;
    if (this.erroJournal) return this.falha("JOURNAL", this.erroJournal);
    if (this.journal?.status === "aguardando_confirmacao" || this.journal?.status === "aguardando_captura") {
      return {
        ok: false,
        pago: false,
        codigo: "PENDENTE",
        mensagem: "Há transação aguardando confirmação. Confirme ou desfaça antes de cobrar de novo.",
        pendencia: this.journal,
      };
    }
    if (modalidade !== "debito" && modalidade !== "credito") {
      return this.falha(PWRET.INVPARAM, "A modalidade precisa ser débito ou crédito.");
    }
    const valor = Number(valorCentavos);
    const vezes = Number(parcelas);
    if (!Number.isInteger(valor) || valor <= 0 || !texto(identificador)) {
      return this.falha(PWRET.INVPARAM, "Identificador ou valor inválido.");
    }
    if (!Number.isInteger(vezes) || vezes < 1 || (modalidade === "debito" && vezes !== 1)) {
      return this.falha(PWRET.INVPARAM, "Parcelamento inválido para a modalidade.");
    }
    this.ocupado = true;
    this.estado = "em_transacao";
    try {
      const aberta = await this.abrirTransacao(PWOPER.SALE, {
        identificador,
        valorCentavos: valor,
        modalidade,
        parcelas: vezes,
      });
      if (!aberta.ok) return aberta;
      return await this.executarAteParar();
    } finally {
      this.ocupado = false;
    }
  }

  async responderCaptura({ dispositivoId, solicitacaoId, indice, valor, cancelar = false }) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    if (!this.captura || this.captura.solicitacaoId !== solicitacaoId) {
      return { ok: false, codigo: "CAPTURA", mensagem: "Não há captura pendente com este identificador." };
    }
    if (this.ocupado) return this.ocupada();
    if (cancelar === true) {
      this.captura = null;
      this.transacao = null;
      if (this.journal?.status === "aguardando_captura" && this.journal.cnfReq !== true) {
        this.journal = null;
        await this.persistirJournal();
      }
      this.estado = this.journal?.status === "aguardando_confirmacao" ? "aguardando_confirmacao" : "ociosa";
      return this.publicar(this.falha(PWRET.CANCEL, "Captura cancelada."));
    }
    const item = this.captura.item;
    let informado = "";
    if (item.tipo === PWDAT.MENU) {
      if (
        !Number.isInteger(indice) ||
        indice < 0 ||
        !Array.isArray(item.valores) ||
        indice >= item.valores.length ||
        !item.valores[indice]
      ) {
        return this.falha(PWRET.INVPARAM, "A opção escolhida não existe em vszValorMenu.");
      }
      informado = item.valores[indice];
    } else if (item.sensivel) {
      informado = texto(valor);
      if (!informado) return this.falha(PWRET.CANCEL, "A captura sensível foi cancelada.");
    } else {
      informado = texto(valor);
      if (!informado) return this.falha(PWRET.INVPARAM, "O valor capturado está vazio.");
    }
    this.ocupado = true;
    this.captura = null;
    try {
      const codigo = await this.biblioteca.addParam(item.identificador, informado);
      this.registrar("PW_iAddParam", codigo, { info: item.identificador, sensivel: item.sensivel === true });
      if (codigo !== PWRET.OK) return this.falha(codigo, "PW_iAddParam recusou o dado capturado.");
      return await this.executarAteParar();
    } finally {
      this.ocupado = false;
    }
  }

  async confirmar({ dispositivoId, motivo = "manual" }) {
    return this.fechar(dispositivoId, motivo === "automatica" ? PWCNF.CNF_AUTO : PWCNF.CNF_MANU_AUT, "confirmar");
  }

  async desfazer({ dispositivoId, motivo = "manual" }) {
    const codigo = {
      manual: PWCNF.REV_MANU_AUT,
      aborto: PWCNF.REV_ABORT,
      queda: PWCNF.REV_PWR_AUT,
      fiscal: PWCNF.REV_FISC_AUT,
      comunicacao: PWCNF.REV_COMM_AUT,
      mercadoria: PWCNF.REV_DISP_AUT,
    }[motivo];
    if (codigo === undefined || motivo === "impressao") {
      return {
        ok: false,
        pago: false,
        codigo: "PWCNF",
        mensagem:
          motivo === "impressao"
            ? "Falha de impressão não desfaz a transação. Use a reimpressão."
            : "Motivo de desfazimento sem código PWCNF correspondente.",
      };
    }
    return this.fechar(dispositivoId, codigo, "desfazer");
  }

  async pinpad({ dispositivoId, porta = 0 }) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    this.liberarCapturaExpirada();
    if (!this.inicializada) {
      return this.falha(PWRET.DLLNOTINIT, "PW_iInit ainda não retornou PWRET_OK.");
    }
    if (this.ocupado || this.estado === "em_transacao" || this.estado === "aguardando_captura") {
      return this.ocupada();
    }
    const teste = await this.biblioteca.ppCommTest(Number(porta) || 0);
    this.registrar("PW_iPPCommTest", teste.codigo);
    let evento = null;
    if (teste.codigo === PWRET.OK) {
      for (let volta = 0; volta < 8; volta += 1) {
        evento = await this.biblioteca.ppEventLoop();
        this.registrar("PW_iPPEventLoop", evento.codigo);
        if (evento.codigo !== PWRET.NOTHING && evento.codigo !== PWRET.DISPLAY) break;
      }
    }
    const aviso = texto(evento?.display) || texto(teste.mensagem);
    return {
      ok: teste.codigo === PWRET.OK && evento?.codigo === PWRET.OK,
      pago: false,
      codigo: teste.codigo,
      nome: nomeRetorno(teste.codigo),
      mensagem: aviso,
      porta: Number.isInteger(teste.porta) ? teste.porta : null,
      evento: evento ? nomeRetorno(evento.codigo) : null,
      cobranca: false,
    };
  }

  async ocioso(instante = new Date()) {
    if (!this.inicializada) return { ok: true, executou: false, motivo: "biblioteca" };
    if (this.ocupado) return { ok: true, executou: false, motivo: "concorrente" };
    if (this.estado !== "ociosa") return { ok: true, executou: false, motivo: "transacao" };
    if (!(this.proximaOciosidade instanceof Date) || instante.getTime() < this.proximaOciosidade.getTime()) {
      return { ok: true, executou: false, motivo: "aguardando" };
    }
    this.ocupado = true;
    try {
      const codigo = await this.biblioteca.idleProc();
      this.registrar("PW_iIdleProc", codigo);
      await this.lerOciosidade();
      return { ok: codigo === PWRET.OK, codigo, nome: nomeRetorno(codigo), executou: true, pago: false, proxima: this.proximaOciosidade };
    } finally {
      this.ocupado = false;
      this.programarOciosidade();
    }
  }

  programarOciosidade() {
    if (this.timerOciosidade) {
      clearTimeout(this.timerOciosidade);
      this.timerOciosidade = null;
    }
    if (!this.agendar || this.ocupado || this.estado !== "ociosa" || !(this.proximaOciosidade instanceof Date)) return;
    const atraso = Math.max(0, this.proximaOciosidade.getTime() - Date.now());
    this.timerOciosidade = this.agendar(() => {
      void this.ocioso();
    }, atraso);
  }

  liberarCapturaExpirada() {
    if (!this.captura || Date.now() < this.captura.expiraEm) return;
    this.captura = null;
    this.transacao = null;
    if (this.estado === "aguardando_captura") this.estado = "ociosa";
  }

  consultarCaptura() {
    this.liberarCapturaExpirada();
    if (!this.captura) return null;
    return {
      id: this.captura.id,
      solicitacaoId: this.captura.solicitacaoId,
      titulo: this.captura.item.prompt || "Informe o dado pedido pela biblioteca",
      opcoes: this.captura.item.opcoes,
      valores: this.captura.item.valores,
      tipo: this.captura.item.tipo,
      sensivel: this.captura.item.sensivel === true,
    };
  }

  publicar(resultado) {
    this.ultimo = resultado;
    return resultado;
  }

  foto() {
    return {
      estado: this.estado,
      inicializada: this.inicializada,
      pago: false,
      dll: DLL_ESPERADA,
      warsaw: false,
      pendencia: this.journal
        ? {
            status: this.journal.status,
            identificador: this.journal.identificador,
            reqNum: this.journal.reqNum,
            cnfReq: this.journal.cnfReq,
          }
        : null,
      captura: this.consultarCaptura(),
      ultimo: this.eventos.at(-1) ?? null,
    };
  }

  async abrirTransacao(operacao, dados) {
    const capacidades = calcularPwinfoAutcap();
    const nova = await this.biblioteca.newTransac(operacao);
    this.registrar("PW_iNewTransac", nova, { operacao });
    if (nova !== PWRET.OK) return this.falha(nova, "PW_iNewTransac recusou a operação.");
    const parametros = [
      [PWINFO.AUTNAME, "UltraPDV"],
      [PWINFO.AUTVER, VERSAO_CICLO],
      [PWINFO.AUTDEV, "UltraPDV"],
      [PWINFO.AUTCAP, capacidades],
    ];
    if (operacao === PWOPER.SALE) {
      parametros.push(
        [PWINFO.TOTAMNT, String(dados.valorCentavos)],
        [PWINFO.CURRENCY, this.moeda],
        [PWINFO.CURREXP, this.expoente],
        [PWINFO.FISCALREF, dados.identificador],
        [PWINFO.INSTALLMENTS, String(dados.parcelas)]
      );
    }
    if (dados.ponto) parametros.push([PWINFO.VIRTMERCH, dados.ponto]);
    if (dados.cnpj) parametros.push([PWINFO.MERCHCNPJCPF, dados.cnpj]);
    for (const [info, valor] of parametros) {
      const codigo = await this.biblioteca.addParam(info, valor);
      this.registrar("PW_iAddParam", codigo, { info, sensivel: INFOS_SENSIVEIS.has(info) });
      if (codigo !== PWRET.OK) return this.falha(codigo, "PW_iAddParam recusou um parâmetro obrigatório.");
    }
    this.transacao = {
      operacao,
      identificador: texto(dados.identificador),
      valorCentavos: dados.valorCentavos ?? null,
      modalidade: dados.modalidade ?? null,
    };
    return { ok: true };
  }

  async executarAteParar() {
    for (let volta = 0; volta < 12; volta += 1) {
      const execucao = await this.biblioteca.execTransac();
      this.registrar("PW_iExecTransac", execucao.codigo);
      await this.lerOciosidade();
      if (execucao.codigo === PWRET.NOTHING) continue;
      if (execucao.codigo === PWRET.MOREDATA) {
        await this.memorizarExecucao("aguardando_captura");
        const item = capturaPublica((execucao.captura ?? [])[0]);
        this.estado = "aguardando_captura";
        this.captura = {
          id: this.transacao?.identificador || "pgweb",
          solicitacaoId: `pgweb-${this.eventos.length}`,
          item,
          expiraEm: Date.now() + 120000,
        };
        return this.publicar({
          ok: true,
          pago: false,
          estado: this.estado,
          codigo: PWRET.MOREDATA,
          nome: "PWRET_MOREDATA",
          captura: this.consultarCaptura(),
        });
      }
      if (execucao.codigo !== PWRET.OK) {
        const lidos = await this.lerTupla();
        const mensagemHost = await this.biblioteca.getResult(PWINFO.RESULTMSG);
        const resultadoId = await this.biblioteca.getResult(PWINFO.RESULTID);
        this.registrar("PW_iGetResult", mensagemHost.codigo, { info: PWINFO.RESULTMSG });
        this.registrar("PW_iGetResult", resultadoId.codigo, { info: PWINFO.RESULTID });
        const textoHost = mensagemHost.codigo === PWRET.OK ? texto(mensagemHost.valor) : "";
        const idHost = resultadoId.codigo === PWRET.OK ? texto(resultadoId.valor) : "";
        if (lidos.cnfReq === "1") {
          this.journal = this.journalDe(lidos, "aguardando_confirmacao");
          this.estado = "aguardando_confirmacao";
        } else {
          this.journal = null;
          this.estado = "ociosa";
          this.transacao = null;
        }
        await this.persistirJournal();
        return this.publicar({
          ...this.falha(
            execucao.codigo,
            textoHost || texto(execucao.mensagem) || "PW_iExecTransac não concluiu a transação."
          ),
          mensagemHost: textoHost,
          resultadoId: idHost,
          confirmacaoChamada: false,
        });
      }
      return this.publicar(await this.coletarResultado());
    }
    return this.publicar(this.falha(PWRET.TIMEOUT, "PW_iExecTransac repetiu PWRET_NOTHING além do limite local."));
  }

  journalDe(lidos, status) {
    return {
      versao: 2,
      status,
      identificador: this.transacao?.identificador ?? "",
      valorCentavos: this.transacao?.valorCentavos ?? null,
      reqNum: lidos.reqNum,
      locRef: lidos.locRef,
      extRef: lidos.extRef,
      virtMerch: lidos.virtMerch,
      authSyst: lidos.authSyst,
      cnfReq: lidos.cnfReq === "1",
      registradoEm: agora(),
    };
  }

  async lerTupla() {
    const pedido = [
      ["cnfReq", PWINFO.CNFREQ],
      ["reqNum", PWINFO.REQNUM],
      ["locRef", PWINFO.AUTLOCREF],
      ["extRef", PWINFO.AUTEXTREF],
      ["virtMerch", PWINFO.VIRTMERCH],
      ["authSyst", PWINFO.AUTHSYST],
    ];
    const lidos = {};
    for (const [nome, info] of pedido) {
      const lido = await this.biblioteca.getResult(info);
      this.registrar("PW_iGetResult", lido.codigo, { info });
      lidos[nome] = lido.codigo === PWRET.OK ? texto(lido.valor) : "";
    }
    return lidos;
  }

  async memorizarExecucao(status) {
    const lidos = await this.lerTupla();
    this.journal = this.journalDe(lidos, status);
    await this.persistirJournal();
    return lidos;
  }

  async coletarResultado() {
    const pedido = [
      PWINFO.CNFREQ,
      PWINFO.REQNUM,
      PWINFO.AUTLOCREF,
      PWINFO.AUTEXTREF,
      PWINFO.VIRTMERCH,
      PWINFO.AUTHSYST,
      PWINFO.AUTHCODE,
      PWINFO.AUTRESPCODE,
      PWINFO.RESULTMSG,
      PWINFO.RESULTID,
      PWINFO.CARDTYPE,
      PWINFO.RCPTMERCH,
      PWINFO.RCPTCHOLDER,
    ];
    const lidos = {};
    for (const info of pedido) {
      const lido = await this.biblioteca.getResult(info);
      this.registrar("PW_iGetResult", lido.codigo, { info });
      lidos[info] = lido.codigo === PWRET.OK ? texto(lido.valor) : "";
    }
    await this.lerOciosidade();
    const cnfReq = lidos[PWINFO.CNFREQ] === "1";
    const aprovada = lidos[PWINFO.AUTRESPCODE] === "00" || lidos[PWINFO.AUTRESPCODE] === "0";
    this.journal = cnfReq
      ? {
          versao: 2,
          status: "aguardando_confirmacao",
          identificador: this.transacao?.identificador ?? "",
          valorCentavos: this.transacao?.valorCentavos ?? null,
          reqNum: lidos[PWINFO.REQNUM],
          locRef: lidos[PWINFO.AUTLOCREF],
          extRef: lidos[PWINFO.AUTEXTREF],
          virtMerch: lidos[PWINFO.VIRTMERCH],
          authSyst: lidos[PWINFO.AUTHSYST],
          cnfReq: true,
          registradoEm: agora(),
        }
      : null;
    if (this.transacao?.operacao === PWOPER.INSTALL && aprovada) this.pontoInstalado = true;
    this.estado = cnfReq ? "aguardando_confirmacao" : "ociosa";
    const resultado = {
      sucessoTransacao: aprovada,
      nsu: lidos[PWINFO.REQNUM],
      rede: lidos[PWINFO.AUTHSYST],
      finalizacao: lidos[PWINFO.AUTLOCREF],
      codigoAutorizacao: lidos[PWINFO.AUTHCODE],
      codigoFinalizacao: lidos[PWINFO.AUTEXTREF],
      confirmar: cnfReq,
      precisaConfirmacao: cnfReq,
      transacaoPendenteConfirmacao: cnfReq,
      mensagem: lidos[PWINFO.RESULTMSG],
      resultadoId: lidos[PWINFO.RESULTID],
      tipoCartao: lidos[PWINFO.CARDTYPE] === "1" ? 1 : lidos[PWINFO.CARDTYPE] === "2" ? 2 : null,
      comprovante1Via: lidos[PWINFO.RCPTMERCH],
      comprovante2Via: lidos[PWINFO.RCPTCHOLDER],
      valor: this.transacao?.valorCentavos ?? null,
      identificador: this.transacao?.identificador ?? "",
    };
    if (!cnfReq) this.transacao = null;
    await this.persistirJournal();
    return {
      ok: true,
      pago: false,
      estado: this.estado,
      codigo: PWRET.OK,
      nome: "PWRET_OK",
      resultado,
    };
  }

  async fechar(dispositivoId, status, acao) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    if (!this.journal || this.estado !== "aguardando_confirmacao") {
      return { ok: false, pago: false, codigo: "SEM_PENDENCIA", mensagem: "Não há transação pendente de confirmação." };
    }
    const referencias = ["reqNum", "locRef", "extRef", "virtMerch", "authSyst"];
    if (referencias.some((campo) => !texto(this.journal[campo]))) {
      return {
        ok: false,
        pago: false,
        codigo: "REFERENCIAS",
        mensagem: "PW_iConfirmation exige REQNUM, AUTLOCREF, AUTEXTREF, VIRTMERCH e AUTHSYST lidos da transação.",
      };
    }
    if (this.ocupado) return this.ocupada();
    this.ocupado = true;
    this.estado = acao === "confirmar" ? "confirmando" : "desfazendo";
    try {
      const codigo = await this.biblioteca.confirmation(status, {
        reqNum: this.journal.reqNum,
        locRef: this.journal.locRef,
        extRef: this.journal.extRef,
        virtMerch: this.journal.virtMerch,
        authSyst: this.journal.authSyst,
      });
      this.registrar("PW_iConfirmation", codigo, { status });
      if (codigo !== PWRET.OK) {
        this.estado = "aguardando_confirmacao";
        return this.falha(codigo, "PW_iConfirmation não atualizou o status.");
      }
      const espera = await this.biblioteca.waitConfirmation();
      this.registrar("PW_iWaitConfirmation", espera);
      if (espera !== PWRET.OK) {
        this.estado = "aguardando_confirmacao";
        return this.falha(espera, "PW_iWaitConfirmation não terminou.");
      }
      await this.lerOciosidade();
      const confirmada = acao === "confirmar";
      this.journal = null;
      this.transacao = null;
      this.estado = "ociosa";
      await this.persistirJournal();
      return this.publicar({
        ok: true,
        pago: confirmada,
        estado: "ociosa",
        codigo: PWRET.OK,
        nome: "PWRET_OK",
        confirmada,
        desfeita: !confirmada,
        status,
      });
    } finally {
      this.ocupado = false;
    }
  }

  async carregarJournal() {
    if (!this.arquivo || this.journal || this.erroJournal) return;
    let bruto = null;
    try {
      bruto = await this.lerArquivoJournal();
    } catch {
      this.erroJournal = "Não foi possível ler o journal TEF 2.0 deste computador.";
      return;
    }
    if (bruto === null || bruto.trim() === "null" || bruto.trim() === "") return;
    try {
      const lido = JSON.parse(bruto);
      const statusOk = lido?.status === "aguardando_confirmacao" || lido?.status === "aguardando_captura";
      if (lido?.versao !== 2 || !statusOk) {
        this.erroJournal = "O journal TEF 2.0 não tem o formato da confirmação pendente.";
        return;
      }
      this.journal = {
        versao: 2,
        status: lido.status,
        identificador: texto(lido.identificador).slice(0, 80),
        valorCentavos: Number.isInteger(lido.valorCentavos) ? lido.valorCentavos : null,
        reqNum: texto(lido.reqNum).slice(0, 40),
        locRef: texto(lido.locRef).slice(0, 40),
        extRef: texto(lido.extRef).slice(0, 40),
        virtMerch: texto(lido.virtMerch).slice(0, 40),
        authSyst: texto(lido.authSyst).slice(0, 40),
        cnfReq: lido.cnfReq === true,
        registradoEm: texto(lido.registradoEm).slice(0, 40),
      };
    } catch {
      this.erroJournal = "O journal TEF 2.0 está ilegível. Nenhuma cobrança nova foi iniciada.";
    }
  }

  async lerArquivoJournal() {
    try {
      return await readFile(this.arquivo, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      return await readFile(`${this.arquivo}.prev`, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async persistirJournal() {
    if (!this.arquivo) return;
    await mkdir(dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.${process.pid}.tmp`;
    const corpo = this.journal ? JSON.stringify(this.journal) : "null";
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(corpo, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const anterior = `${this.arquivo}.prev`;
    try {
      await rename(this.arquivo, anterior);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(tmp, this.arquivo);
    await rm(anterior, { force: true });
  }

  async lerOciosidade() {
    if (!this.inicializada) return;
    const lido = await this.biblioteca.getResult(PWINFO.IDLEPROCTIME);
    this.registrar("PW_iGetResult", lido.codigo, { info: PWINFO.IDLEPROCTIME });
    const quando = lido.codigo === PWRET.OK ? horarioIdle(texto(lido.valor)) : null;
    this.proximaOciosidade = quando;
    this.programarOciosidade();
  }

  async exigirPronta(dispositivoId) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    this.liberarCapturaExpirada();
    if (!this.inicializada) return this.falha(PWRET.DLLNOTINIT, "PW_iInit ainda não retornou PWRET_OK.");
    if (this.ocupado || this.estado === "aguardando_captura" || this.estado === "em_transacao") return this.ocupada();
    return null;
  }

  ocupada() {
    return {
      ok: false,
      pago: false,
      codigo: "OCUPADO",
      estado: this.estado,
      mensagem: `A sessão está em ${this.estado}. A causa não foi substituída por um erro genérico.`,
    };
  }

  falha(codigo, mensagem) {
    return {
      ok: false,
      pago: false,
      estado: this.estado,
      codigo,
      nome: Number.isInteger(codigo) ? nomeRetorno(codigo) : String(codigo),
      mensagem,
    };
  }
}
