import { prepararTipoGetDataInstalacao } from "./tef-instalacao-homologacao.mjs";
import { lerCapturasPwGetData, TAMANHO_PW_GETDATA } from "./tef-getdata.mjs";

const PWRET_NODATA = -2496;
const PWRET_INVPARAM = -2499;
const PWRET_DLLNOTINIT = -2487;
const PWINFO_USINGPINPAD = 0x7f01;
const PWINFO_PPCOMMPORT = 0x7f02;
const INFOS_SENSIVEIS = new Set([0x1c, 0xc1, 0xc2, 0xc8, 0xf5, 0xf6]);
const PARAMETROS_SOMENTE_INSTALACAO = new Set([PWINFO_USINGPINPAD, PWINFO_PPCOMMPORT]);

const cachesPorKoffi = new WeakMap();

export function interpretarServerPnd(codigo, valor) {
  const texto = String(valor ?? "").replace(/\0/g, "").trim();
  if (Number(codigo) === PWRET_NODATA || texto === "0") {
    return { estado: "ausente", confirmar: false, desfazer: false, bloqueio: false };
  }
  if (Number(codigo) === 0 && texto === "1") {
    return { estado: "remota", confirmar: false, desfazer: false, bloqueio: true };
  }
  return { estado: "indeterminado", confirmar: false, desfazer: false, bloqueio: true };
}

export function decidirConfirmacaoNativa(journal) {
  const refs = journal?.referencias && typeof journal.referencias === "object" ? journal.referencias : {};
  const campos = ["reqNum", "locRef", "extRef", "virtMerch", "authSyst"];
  const completas = campos.every((campo) => String(refs[campo] ?? "").trim().length > 0);
  if (!completas || journal?.autorizacaoFinanceira !== true) {
    return { chamar: false, confirmar: false, desfazer: false, codigo: "REFERENCIAS" };
  }
  return { chamar: false, confirmar: false, desfazer: false, codigo: "MANUAL" };
}

export function classificarPendenciaNativa(journal) {
  if (!journal) return { acao: "seguir", confirmar: false, desfazer: false, motivo: "", retomavel: false };
  if (journal.status === "aguardando_captura") {
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "captura_pendente", retomavel: false };
  }
  if (journal.status === "sessao_tecnica_perdida_antes_da_captura") {
    const valor = journal.encerramento?.evidencias?.serverPndValor ?? journal.serverPndValor;
    const servidor = interpretarServerPnd(0, valor);
    const prova = journal.autorizacaoFinanceira === true || journal.pagamentoRecebido === true || journal.respostaEnviada === true;
    if (servidor.estado === "ausente" && !prova && journal.retomavel === false) {
      return { acao: "seguir", confirmar: false, desfazer: false, motivo: "captura_ilegivel", retomavel: false };
    }
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "captura_ilegivel", retomavel: false };
  }
  if (journal.status === "sessao_nativa_perdida_sem_autorizacao") {
    const valor = journal.encerramento?.evidencias?.serverPndValor ?? journal.serverPndValor;
    const servidor = interpretarServerPnd(0, valor);
    const prova =
      journal.autorizacaoFinanceira === true ||
      journal.pagamentoRecebido === true ||
      Boolean(journal.referencias?.reqNum);
    if (servidor.estado === "ausente" && !prova && journal.retomavel === false) {
      return { acao: "seguir", confirmar: false, desfazer: false, motivo: "sessao_nativa_perdida", retomavel: false };
    }
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "sessao_nativa_perdida", retomavel: false };
  }
  if (journal.status === "resultado_desconhecido") {
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "resultado_desconhecido", retomavel: false };
  }
  if (journal.status === "aguardando_confirmacao" || journal.status === "aguardando_decisao") {
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "confirmacao", retomavel: false };
  }
  if (journal.status === "sem_autorizacao") {
    const valor = journal.serverPndFinalValor ?? journal.serverPndValor;
    const servidor = interpretarServerPnd(0, valor);
    const refs = journal.referencias && typeof journal.referencias === "object" ? journal.referencias : {};
    const prova =
      journal.autorizacaoFinanceira === true ||
      journal.pagamentoRecebido === true ||
      Boolean(String(refs.reqNum ?? "").trim());
    if (servidor.estado === "remota") {
      return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "pendencia_remota", retomavel: false };
    }
    if (journal.resultado == null || journal.resultado === "" || journal.resultado === "desconhecido") {
      return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "resultado_desconhecido", retomavel: false };
    }
    if (
      journal.sessaoNativa === "encerrada" &&
      servidor.estado === "ausente" &&
      !prova &&
      journal.confirmacaoChamada !== true &&
      journal.desfazimentoChamado !== true &&
      journal.retomavel === false &&
      journal.resultado === "erro"
    ) {
      return { acao: "seguir", confirmar: false, desfazer: false, motivo: "sem_autorizacao_encerrada", retomavel: false };
    }
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "sem_autorizacao", retomavel: false };
  }
  if (journal.status === "sessao_tecnica_incompleta") {
    const valor = journal.encerramento?.evidencias?.serverPndValor;
    const servidor = interpretarServerPnd(0, valor);
    const prova = Boolean(journal.reqNum && journal.locRef && journal.extRef) || journal.autorizacaoFinanceira === true;
    if (servidor.estado === "ausente" && !prova && journal.pagamentoRecebido !== true) {
      return { acao: "seguir", confirmar: false, desfazer: false, motivo: "sessao_tecnica_incompleta" };
    }
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: servidor.estado };
  }
  const evidencia = journal.identificacaoPosErro ?? {};
  const servidor = interpretarServerPnd(
    evidencia.serverPndValor === "0" || evidencia.serverPndValor === "1" ? 0 : evidencia.serverPndPresente === true ? 0 : PWRET_NODATA,
    evidencia.serverPndValor
  );
  const prova = Boolean(journal.reqNum && journal.locRef && journal.extRef);
  if (journal.transacaoIniciada === true && journal.retornoExec == null) {
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: "sessao_incompleta" };
  }
  if (servidor.bloqueio) {
    return { acao: "bloquear", confirmar: false, desfazer: false, motivo: servidor.estado };
  }
  if (!prova) return { acao: "parar", confirmar: false, desfazer: false, motivo: "sem_prova" };
  return { acao: "aguardar", confirmar: false, desfazer: false, motivo: "prova" };
}

function tipoUmaVez(koffi) {
  let cache = cachesPorKoffi.get(koffi);
  if (!cache) {
    cache = {};
    cachesPorKoffi.set(koffi, cache);
    prepararTipoGetDataInstalacao(koffi, cache);
  }
  return cache.tipo;
}

function diretorioDeHomologacao(diretorio) {
  const normal = String(diretorio ?? "").toLowerCase();
  return normal.includes("homologacao") && !normal.includes("producao") && !normal.includes("\\paygo\\");
}

export function bibliotecaVendaNativa(funcoes, opcoes = {}) {
  if (!funcoes || typeof funcoes !== "object") {
    throw Object.assign(new Error("A venda nativa precisa de um transporte de funções."), {
      code: "TRANSPORTE_AUSENTE",
    });
  }
  if (!opcoes.koffi || typeof opcoes.koffi.struct !== "function") {
    throw Object.assign(new Error("O tipo da captura precisa ser registrado uma vez."), {
      code: "TIPO_AUSENTE",
    });
  }
  tipoUmaVez(opcoes.koffi);
  const handles = {
    init: funcoes.PW_iInit,
    setEnvironment: funcoes.PW_iSetEnvironment,
    newTransac: funcoes.PW_iNewTransac,
    addParam: funcoes.PW_iAddParam,
    exec: funcoes.PW_iExecTransac,
    getResult: funcoes.PW_iGetResult,
    confirmation: funcoes.PW_iConfirmation,
    waitConfirmation: funcoes.PW_iWaitConfirmation,
    idleProc: funcoes.PW_iIdleProc,
    ppEventLoop: funcoes.PW_iPPEventLoop,
    ppAbort: funcoes.PW_iPPAbort,
    ppGetCard: funcoes.PW_iPPGetCard,
    ppGetData: funcoes.PW_iPPGetData,
    ppGetPIN: funcoes.PW_iPPGetPIN,
    ppGoOnChip: funcoes.PW_iPPGoOnChip,
    ppFinishChip: funcoes.PW_iPPFinishChip,
    ppConfirmData: funcoes.PW_iPPConfirmData,
    ppRemoveCard: funcoes.PW_iPPRemoveCard,
    ppGenericCMD: funcoes.PW_iPPGenericCMD,
    ppPositiveConfirmation: funcoes.PW_iPPPositiveConfirmation,
    ppTestKey: funcoes.PW_iPPTestKey,
    ppCommTest: funcoes.PW_iPPCommTest,
  };

  async function chamar(handle, args) {
    if (typeof handle !== "function") return PWRET_DLLNOTINIT;
    return handle(...args);
  }

  return {
    real: opcoes.oficial === true,
    async init(diretorio) {
      if (!diretorioDeHomologacao(diretorio)) return PWRET_INVPARAM;
      return chamar(handles.init, [diretorio]);
    },
    async setEnvironment(codigo) {
      return chamar(handles.setEnvironment, [codigo]);
    },
    async newTransac(operacao) {
      return chamar(handles.newTransac, [operacao]);
    },
    async addParam(info, valor) {
      if (INFOS_SENSIVEIS.has(Number(info)) || PARAMETROS_SOMENTE_INSTALACAO.has(Number(info))) {
        return PWRET_INVPARAM;
      }
      return chamar(handles.addParam, [info, valor]);
    },
    async execTransac(quantidade) {
      const capacidade = Number(quantidade);
      const memoria = Buffer.alloc(Number.isInteger(capacidade) && capacidade > 0 ? capacidade * TAMANHO_PW_GETDATA : 0);
      const informada = [capacidade];
      const codigo = await chamar(handles.exec, [memoria, informada]);
      const lidas = lerCapturasPwGetData(memoria, capacidade, Number(informada[0]));
      return {
        codigo,
        quantidade: lidas.quantidade,
        captura: lidas.capturas,
        leitura: lidas.codigo,
      };
    },
    async getResult(info) {
      if (INFOS_SENSIVEIS.has(Number(info))) return { codigo: PWRET_NODATA, valor: "" };
      const saida = Buffer.alloc(4096);
      const codigo = await chamar(handles.getResult, [info, saida, saida.length]);
      return { codigo, valor: saida.toString("latin1").split("\0")[0] };
    },
    async confirmation(status, tupla) {
      return chamar(handles.confirmation, [
        status,
        tupla?.reqNum ?? "",
        tupla?.locRef ?? "",
        tupla?.extRef ?? "",
        tupla?.virtMerch ?? "",
        tupla?.authSyst ?? "",
      ]);
    },
    async waitConfirmation() {
      return chamar(handles.waitConfirmation, []);
    },
    async idleProc() {
      return chamar(handles.idleProc, []);
    },
    async ppEventLoop() {
      const display = Buffer.alloc(128);
      const codigo = await chamar(handles.ppEventLoop, [display, display.length]);
      return { codigo, display: display.toString("latin1").split("\0")[0] };
    },
    async ppAbort() {
      return chamar(handles.ppAbort, []);
    },
    async ppGetCard(indice) {
      return chamar(handles.ppGetCard, [indice ?? 0]);
    },
    async ppGetData(indice) {
      return chamar(handles.ppGetData, [indice ?? 0]);
    },
    async ppGetPIN(indice) {
      return chamar(handles.ppGetPIN, [indice ?? 0]);
    },
    async ppGoOnChip(indice) {
      return chamar(handles.ppGoOnChip, [indice ?? 0]);
    },
    async ppFinishChip(indice) {
      return chamar(handles.ppFinishChip, [indice ?? 0]);
    },
    async ppConfirmData(indice) {
      return chamar(handles.ppConfirmData, [indice ?? 0]);
    },
    async ppRemoveCard() {
      return chamar(handles.ppRemoveCard, []);
    },
    async ppGenericCMD(indice) {
      return chamar(handles.ppGenericCMD, [indice ?? 0]);
    },
    async ppPositiveConfirmation(indice) {
      return chamar(handles.ppPositiveConfirmation, [indice ?? 0]);
    },
    async ppTestKey(indice) {
      return chamar(handles.ppTestKey, [indice ?? 0]);
    },
    async ppCommTest() {
      return chamar(handles.ppCommTest, []);
    },
  };
}

export function abrirVendaOficial() {
  throw Object.assign(
    new Error("A PGWebLib oficial não é carregada nesta etapa. Nenhuma venda foi iniciada."),
    { code: "VENDA_REAL_BLOQUEADA" }
  );
}
