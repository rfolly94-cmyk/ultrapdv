import fs from "node:fs/promises";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";
import { PWRET, SEQUENCIA_REFERENCIAS_PENDENTES } from "./tef-pgweb.mjs";

export function arquivoPendenciaTef(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-pendencia.json");
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function numero(valor) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

export const STATUS_JOURNAL_TEF = Object.freeze({
  PAGAMENTO_EM_ANDAMENTO: "pagamento_em_andamento",
  AGUARDANDO_DECISAO: "aguardando_decisao",
  RESULTADO_DESCONHECIDO: "resultado_desconhecido",
  SESSAO_TECNICA_INCOMPLETA: "sessao_tecnica_incompleta",
  SESSAO_NATIVA_PERDIDA: "sessao_nativa_perdida_sem_autorizacao",
  SESSAO_TECNICA_PERDIDA_ANTES_CAPTURA: "sessao_tecnica_perdida_antes_da_captura",
  SESSAO_ABERTA_SEM_EXECUCAO: "sessao_aberta_sem_execucao",
  RECONCILIACAO_PENDENTE: "reconciliacao_pendente",
  RESULTADO_TERMINAL: "resultado_terminal",
});

const PWRET_FROMHOST = -2596;
const PWRET_FROMHOST_POS = -2598;
const PWRET_FROMHOST_USR = -2597;

export function classificarSituacaoJournal(journal = {}) {
  if (journal.status === STATUS_JOURNAL_TEF.RESULTADO_TERMINAL) {
    return journal.reconciliacao?.situacao === "pendente" ? "falha_host" : "encerrada";
  }
  if (
    journal.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO ||
    journal.status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO ||
    journal.autorizacaoFinanceira === true ||
    journal.pagamentoRecebido === true ||
    journal.confirmacaoChamada === true ||
    journal.desfazimentoChamado === true
  ) {
    return "resultado_desconhecido";
  }
  if (journal.precisaConfirmacao === true || journal.status === STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO) {
    return "aguardando_confirmacao";
  }
  const retornoExec = journal.retornoExec == null ? null : Number(journal.retornoExec);
  if (
    journal.status === "execucao_iniciada" &&
    Number(journal.retornoNewTransac) === 0 &&
    retornoExec == null &&
    journal.desfazimentoChamado !== true &&
    journal.autorizacaoFinanceira !== true &&
    journal.pagamentoRecebido !== true &&
    journal.confirmacaoChamada !== true
  ) {
    return "legado_sem_resultado";
  }
  const capturaSemResultado = retornoExec === PWRET.MOREDATA;
  if (
    (journal.status === "execucao_iniciada" || journal.executada === true) &&
    Number(journal.retornoNewTransac) === 0 &&
    capturaSemResultado &&
    journal.desfazimentoChamado !== true
  ) {
    return "captura_pendente";
  }
  return "sessao_aberta";
}

export function evidenciasReconciliacaoValidas(evidencias = {}) {
  if (Number(evidencias.serverPndCodigo) !== PWRET.OK) return false;
  if (String(evidencias.serverPndValor ?? "") !== "0") return false;
  if (evidencias.transacaoLocalAberta === true) return false;
  if (evidencias.referenciasPresentes === true) return false;
  const tags = evidencias.pendentes;
  if (!Array.isArray(tags) || tags.length !== SEQUENCIA_REFERENCIAS_PENDENTES.length) return false;
  return SEQUENCIA_REFERENCIAS_PENDENTES.every((oficial, indice) => {
    const lida = tags[indice];
    return Boolean(lida)
      && lida.nome === oficial.nome
      && Number(lida.info) === oficial.info
      && Number(lida.codigo) === PWRET.OK
      && lida.vazio === true;
  });
}

export const OPERACAO_VENDA_PERDIDA = Object.freeze({
  identificador: "303624a2-2b4e-4c59-ab9b-ae8a89803eee",
  correlationId: "dc891000-31d5-4cb1-8d44-567c11d0abc9",
});

export const OPERACAO_CAPTURA_ILEGIVEL = Object.freeze({
  identificador: "c8d12ac4-f9e7-4960-8306-92c915abeced",
  correlationId: "e0f823c8-2746-4dba-9809-a21ba90efaf9",
});

export const OPERACAO_HOST_SEM_AUTORIZACAO = Object.freeze({
  identificador: "7be0ea57-9ae4-4502-a450-6d5117234ee2",
  correlationId: "089eef23-7baa-4d2d-ba77-ee5666e5a2b9",
});

export function montarJournalPagamento(dados = {}) {
  const agora = texto(dados.dataHoraInicio) || new Date().toISOString();
  return {
    versao: 1,
    status: STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO,
    identificador: texto(dados.identificador),
    valor: numero(dados.valor),
    dataHoraInicio: agora,
    correlationId: texto(dados.correlationId),
    reconciliacaoNecessaria: false,
    rede: "",
    nsu: "",
    finalizacao: "",
    registradoEm: texto(dados.registradoEm) || agora,
    confirmar: false,
    precisaConfirmacao: false,
  };
}

export function montarRegistroPendencia(dados = {}) {
  const registradoEm = texto(dados.registradoEm) || texto(dados.dataHoraInicio) || new Date().toISOString();
  return {
    versao: 1,
    status: STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
    identificador: texto(dados.identificador),
    valor: numero(dados.valor),
    dataHoraInicio: texto(dados.dataHoraInicio) || registradoEm,
    correlationId: texto(dados.correlationId),
    rede: texto(dados.rede),
    nsu: texto(dados.nsu),
    finalizacao: texto(dados.finalizacao),
    registradoEm,
    reconciliacaoNecessaria: dados.reconciliacaoNecessaria === true,
    confirmar: true,
    precisaConfirmacao: true,
  };
}

export function promoverJournalDecisao(journal = {}, resultado = {}) {
  return montarRegistroPendencia({
    identificador: texto(resultado.identificador) || journal.identificador,
    valor: numero(resultado.valor) ?? journal.valor,
    dataHoraInicio: journal.dataHoraInicio,
    correlationId: journal.correlationId,
    rede: resultado.rede,
    nsu: resultado.nsu,
    finalizacao: resultado.finalizacao || resultado.codigoFinalizacao,
    registradoEm: journal.registradoEm || journal.dataHoraInicio,
    reconciliacaoNecessaria: journal.reconciliacaoNecessaria === true,
  });
}

function journalOperacao(json) {
  const identificador = texto(json.identificador);
  const valor = numero(json.valor);
  const dataHoraInicio = texto(json.dataHoraInicio) || texto(json.registradoEm);
  const correlationId = texto(json.correlationId);
  if (!identificador || valor == null || valor <= 0 || !dataHoraInicio || !correlationId) {
    return null;
  }
  return {
    versao: 1,
    status: json.status,
    identificador,
    valor,
    dataHoraInicio,
    correlationId,
    reconciliacaoNecessaria: json.reconciliacaoNecessaria === true,
    rede: texto(json.rede),
    nsu: texto(json.nsu),
    finalizacao: texto(json.finalizacao),
    registradoEm: texto(json.registradoEm) || dataHoraInicio,
    confirmar: json.confirmar === true,
    precisaConfirmacao: json.precisaConfirmacao === true,
  };
}

function ambienteJournal(json) {
  const ambiente = texto(json?.ambiente);
  if (ambiente === "homologacao" || ambiente === "producao") return ambiente;
  const perfil = texto(json?.perfil);
  if (perfil.includes("homologacao")) return "homologacao";
  if (perfil.includes("producao")) return "producao";
  return "";
}

function interpretarJsonPendencia(textoBruto) {
  let json;
  try {
    json = JSON.parse(String(textoBruto ?? ""));
  } catch {
    return { ok: false, ilegivel: true };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, ilegivel: true };
  }
  if (json.status === STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO) {
    const registro = montarRegistroPendencia(json);
    if (!registro.rede || !registro.nsu || !registro.finalizacao) {
      return { ok: false, ilegivel: true };
    }
    return { ok: true, registro };
  }
  if (json.status === STATUS_JOURNAL_TEF.SESSAO_TECNICA_PERDIDA_ANTES_CAPTURA) {
    const valor = json.encerramento?.evidencias?.serverPndValor;
    const mesma =
      json.identificador === OPERACAO_CAPTURA_ILEGIVEL.identificador &&
      json.correlationId === OPERACAO_CAPTURA_ILEGIVEL.correlationId;
    if (
      !mesma ||
      valor !== "0" ||
      json.autorizacaoFinanceira === true ||
      json.pagamentoRecebido === true ||
      json.confirmacaoChamada === true ||
      json.desfazimentoChamado === true ||
      json.respostaEnviada === true ||
      json.retomavel !== false
    ) {
      return { ok: false, ilegivel: true };
    }
    return {
      ok: true,
      registro: null,
      encerrado: {
        status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_PERDIDA_ANTES_CAPTURA,
        correlationId: OPERACAO_CAPTURA_ILEGIVEL.correlationId,
        identificador: OPERACAO_CAPTURA_ILEGIVEL.identificador,
        serverPndValor: "0",
      },
    };
  }
  if (json.status === STATUS_JOURNAL_TEF.SESSAO_NATIVA_PERDIDA) {
    const valor = json.encerramento?.evidencias?.serverPndValor;
    const mesma =
      json.identificador === OPERACAO_VENDA_PERDIDA.identificador &&
      json.correlationId === OPERACAO_VENDA_PERDIDA.correlationId;
    if (
      !mesma ||
      valor !== "0" ||
      json.autorizacaoFinanceira === true ||
      json.pagamentoRecebido === true ||
      json.confirmacaoChamada === true ||
      json.desfazimentoChamado === true ||
      json.retomavel !== false
    ) {
      return { ok: false, ilegivel: true };
    }
    return {
      ok: true,
      registro: null,
      encerrado: {
        status: STATUS_JOURNAL_TEF.SESSAO_NATIVA_PERDIDA,
        correlationId: OPERACAO_VENDA_PERDIDA.correlationId,
        identificador: OPERACAO_VENDA_PERDIDA.identificador,
        serverPndValor: "0",
      },
    };
  }
  if (json.status === "sem_autorizacao") {
    const refs = json.referencias && typeof json.referencias === "object" ? json.referencias : {};
    if (
      json.sessaoNativa !== "encerrada" ||
      json.serverPndFinalValor !== "0" ||
      json.resultado !== "erro" ||
      json.autorizacaoFinanceira === true ||
      json.pagamentoRecebido === true ||
      json.confirmacaoChamada === true ||
      json.desfazimentoChamado === true ||
      json.retomavel !== false ||
      texto(refs.reqNum) ||
      texto(refs.locRef) ||
      texto(refs.extRef)
    ) {
      return { ok: false, ilegivel: true, codigo: "formato" };
    }
    return {
      ok: true,
      registro: null,
      encerrado: {
        status: "sem_autorizacao",
        correlationId: texto(json.correlationId),
        identificador: texto(json.identificador),
        serverPndValor: "0",
      },
    };
  }
  if (json.status === STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA) {
    const valor = json.encerramento?.evidencias?.serverPndValor;
    if (valor !== "0" || json.autorizacaoFinanceira === true || json.pagamentoRecebido === true) {
      return { ok: false, ilegivel: true };
    }
    return {
      ok: true,
      registro: null,
      encerrado: {
        status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA,
        correlationId: texto(json.correlationId),
        identificador: texto(json.identificador),
        serverPndValor: "0",
      },
    };
  }
  if (json.status === STATUS_JOURNAL_TEF.RECONCILIACAO_PENDENTE) {
    if (json.autorizacaoFinanceira === true || json.pagamentoRecebido === true || json.executada === true || json.confirmacaoChamada === true) {
      return { ok: false, ilegivel: true };
    }
    return {
      ok: true,
      registro: null,
      reconciliacaoPendente: true,
      identificador: texto(json.identificador),
      correlationId: texto(json.correlationId),
    };
  }
  if (json.status === STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO) {
    const identificador = texto(json.identificador);
    const correlationId = texto(json.correlationId);
    const valor = numero(json.valor);
    const dataHoraInicio = texto(json.dataHoraInicio);
    if (!identificador || !correlationId || valor == null || valor <= 0 || !dataHoraInicio) {
      return { ok: false, ilegivel: true };
    }
    const registro = {
      versao: 1,
      status: json.status,
      identificador,
      correlationId,
      valor,
      dataHoraInicio,
      etapa: texto(json.etapa),
      retornoNewTransac: json.retornoNewTransac == null ? null : Number(json.retornoNewTransac),
      executada: json.executada === true,
      autorizacaoFinanceira: false,
      pagamentoRecebido: false,
      confirmacaoChamada: false,
    };
    if (json.retornoNewTransac !== 0) {
      return { ok: true, registro: null, falhaTecnica: true };
    }
    return { ok: true, registro, abertaSemExecucao: true };
  }
  if (json.status === "falha_tecnica_antes_da_transacao") {
    if (
      json.retornoNewTransac === 0 ||
      json.executada === true ||
      json.autorizacaoFinanceira === true ||
      json.pagamentoRecebido === true ||
      json.confirmacaoChamada === true
    ) {
      return { ok: false, ilegivel: true };
    }
    return { ok: true, registro: null, falhaTecnica: true };
  }
  if (json.status === "execucao_iniciada") {
    if (json.autorizacaoFinanceira === true || json.pagamentoRecebido === true || json.confirmacaoChamada === true) {
      return { ok: false, ilegivel: true };
    }
    const retornoExec = json.retornoExec == null ? null : Number(json.retornoExec);
    if (
      json.retornoNewTransac === 0 &&
      retornoExec == null &&
      json.desfazimentoChamado !== true
    ) {
      return {
        ok: true,
        registro: null,
        execucaoIniciada: true,
        recuperavel: false,
        bloqueiaNovaCobranca: true,
        legadoSemResultadoTerminal: true,
        identificador: texto(json.identificador),
        correlationId: texto(json.correlationId),
      };
    }
    const semResultado =
      json.retornoNewTransac === 0 &&
      retornoExec === PWRET.MOREDATA &&
      json.desfazimentoChamado !== true;
    if (!semResultado) {
      return { ok: true, registro: null, execucaoIniciada: true, recuperavel: false };
    }
    return {
      ok: true,
      registro: {
        versao: 1,
        status: json.status,
        identificador: texto(json.identificador),
        correlationId: texto(json.correlationId),
        valor: numero(json.valor),
        dataHoraInicio: texto(json.dataHoraInicio),
        etapa: texto(json.etapa),
        retornoNewTransac: 0,
        retornoExec,
        executada: true,
        autorizacaoFinanceira: false,
        pagamentoRecebido: false,
        confirmacaoChamada: false,
        desfazimentoChamado: false,
      },
      execucaoIniciada: true,
      recuperavel: true,
    };
  }
  if (
    json.status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO ||
    json.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO
  ) {
    const registro = journalOperacao(json);
    if (!registro) {
      return { ok: false, ilegivel: true };
    }
    return { ok: true, registro };
  }
  if (json.status === STATUS_JOURNAL_TEF.RESULTADO_TERMINAL) {
    return interpretarResultadoTerminal(json);
  }
  return { ok: false, ilegivel: true };
}

export function interpretarPendencia(textoBruto) {
  let json = null;
  try {
    json = JSON.parse(String(textoBruto ?? ""));
  } catch {
    return { ok: false, ilegivel: true };
  }
  const resultado = interpretarJsonPendencia(textoBruto);
  if (!resultado || typeof resultado !== "object") return resultado;
  return {
    ...resultado,
    escopo: {
      empresaId: texto(json?.empresaId),
      terminalCodigo: texto(json?.terminalCodigo),
      dispositivoId: texto(json?.dispositivoId),
      ambiente: ambienteJournal(json),
    },
  };
}

export function journalPertenceAoPedido(lido = {}, pedido = {}) {
  const escopo = lido.escopo || {};
  if (pedido.empresaId && escopo.empresaId && escopo.empresaId !== pedido.empresaId) return false;
  if (pedido.terminalCodigo && escopo.terminalCodigo && escopo.terminalCodigo !== pedido.terminalCodigo) return false;
  if (pedido.dispositivoId && escopo.dispositivoId && escopo.dispositivoId !== pedido.dispositivoId) return false;
  if (
    pedido.ambiente &&
    (escopo.ambiente === "homologacao" || escopo.ambiente === "producao") &&
    escopo.ambiente !== pedido.ambiente
  ) {
    return false;
  }
  return true;
}

export async function anexarProvaReconciliacao(arquivo, registro, fsApi = fs) {
  if (!evidenciasReconciliacaoValidas(registro?.encerramento?.evidencias)) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  const linha = `${JSON.stringify({
    ...registro,
    journalOriginalPreservado: true,
    anexadoEm: new Date().toISOString(),
  })}\n`;
  await fsApi.appendFile(`${arquivo}.prova.jsonl`, linha);
  return { gravado: true, preservado: true, journalApagado: false, anexada: true };
}

export function encerramentoCapturaValido(registro = {}) {
  if (registro.capturaEmCurso !== true) return false;
  if (Number(registro.evento) !== PWRET.CANCEL) return false;
  if (Number(registro.retornoExec) !== PWRET.CANCEL) return false;
  if (registro.aborto != null && Number(registro.aborto) !== PWRET.OK) return false;
  if (registro.confirmacaoChamada === true || registro.autorizacaoFinanceira === true) return false;
  if (registro.desfazimentoChamado === true || registro.pagamentoRecebido === true) return false;
  return Boolean(texto(registro.identificador));
}

export async function registrarEncerramentoCaptura(arquivo, registro, fsApi = fs) {
  if (!arquivo || !encerramentoCapturaValido(registro)) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  const linha = `${JSON.stringify({
    tipo: "encerramento_captura",
    status: "captura_cancelada",
    identificador: texto(registro.identificador),
    correlationId: texto(registro.correlationId) || texto(registro.identificador),
    capturaEmCurso: true,
    aborto: registro.aborto == null ? null : PWRET.OK,
    evento: PWRET.CANCEL,
    retornoExec: PWRET.CANCEL,
    confirmacaoChamada: false,
    autorizacaoFinanceira: false,
    desfazimentoChamado: false,
    pagamentoRecebido: false,
    journalOriginalPreservado: true,
    registradoEm: new Date().toISOString(),
  })}\n`;
  await fsApi.appendFile(`${arquivo}.captura.jsonl`, linha);
  return { gravado: true, preservado: true, journalApagado: false };
}

async function encerramentoCapturaDoArquivo(arquivo, identificador, lido, fsApi) {
  let bruto = "";
  try {
    bruto = await fsApi.readFile(`${arquivo}.captura.jsonl`, "utf8");
  } catch {
    return null;
  }
  const linhas = bruto.split(/\r?\n/).filter(Boolean);
  for (let indice = linhas.length - 1; indice >= 0; indice -= 1) {
    let registro;
    try {
      registro = JSON.parse(linhas[indice]);
    } catch {
      continue;
    }
    if (texto(registro.identificador) !== identificador && texto(registro.correlationId) !== identificador) continue;
    if (!encerramentoCapturaValido(registro)) continue;
    return {
      ok: true,
      registro: null,
      escopo: lido.escopo,
      capturaEncerrada: true,
      bloqueiaNovaCobranca: true,
      recuperavel: false,
      classe: "cancelada",
      identificador,
    };
  }
  return null;
}

export async function aplicarProvaAnexa(arquivo, lido, fsApi = fs) {
  if (lido?.legadoSemResultadoTerminal === true) return lido;
  if (!lido?.execucaoIniciada && !lido?.abertaSemExecucao && !lido?.reconciliacaoPendente) return lido;
  const identificador = texto(lido.registro?.identificador || lido.identificador);
  if (!identificador) return lido;
  const captura = await encerramentoCapturaDoArquivo(arquivo, identificador, lido, fsApi);
  if (captura) return captura;
  let bruto = "";
  try {
    bruto = await fsApi.readFile(`${arquivo}.prova.jsonl`, "utf8");
  } catch (erro) {
    if (erro?.code === "ENOENT") return lido;
    return lido;
  }
  const linhas = bruto.split(/\r?\n/).filter(Boolean);
  for (let indice = linhas.length - 1; indice >= 0; indice -= 1) {
    let prova;
    try {
      prova = JSON.parse(linhas[indice]);
    } catch {
      continue;
    }
    if (texto(prova.identificador) !== identificador && texto(prova.correlationId) !== identificador) continue;
    if (prova.status !== STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA) continue;
    if (!evidenciasReconciliacaoValidas(prova.encerramento?.evidencias)) continue;
    return {
      ok: true,
      registro: null,
      escopo: lido.escopo,
      provaAnexa: true,
      encerrado: {
        status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA,
        identificador,
        serverPndValor: "0",
      },
    };
  }
  return lido;
}

export function encerrarSessaoTecnicaIncompleta(journal, evidencias = {}, agora = new Date().toISOString()) {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) {
    return { ok: false, codigo: "ausente" };
  }
  if (journal.status === STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA) {
    return { ok: true, repetida: true, registro: journal };
  }
  const add = Array.isArray(journal.addParam) ? journal.addParam : [];
  const corresponde =
    journal.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO &&
    journal.operacao === "PWOPER_SALE" &&
    journal.perfil === "conector-homologacao" &&
    journal.transacaoIniciada === true &&
    Number(journal.retornoInit) === 0 &&
    Number(journal.retornoNewTransac) === 0 &&
    journal.retornoExec == null &&
    journal.pagamentoRecebido !== true &&
    journal.confirmacaoChamada !== true &&
    journal.desfazimentoChamado !== true &&
    !texto(journal.nsu) &&
    !texto(journal.rede) &&
    !texto(journal.finalizacao) &&
    add.length === 1 &&
    add[0]?.info === "USINGPINPAD" &&
    Number(add[0]?.codigo) === -2499 &&
    journal.identificacaoPosErro?.prova !== true &&
    evidencias.perfil === "conector-homologacao" &&
    Number(evidencias.serverPndCodigo) === 0 &&
    evidencias.serverPndValor === "0";
  if (!corresponde) return { ok: false, codigo: "nao_corresponde" };
  const anterior = structuredClone(journal);
  return {
    ok: true,
    repetida: false,
    registro: {
      ...anterior,
      status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA,
      confirmar: false,
      precisaConfirmacao: false,
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      desfazimentoChamado: false,
      autorizacaoFinanceira: false,
      historico: [anterior],
      encerramento: {
        statusAnterior: STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO,
        status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA,
        em: agora,
        motivo:
          "Sessão técnica incompleta. PW_iExecTransac não foi chamado e não houve autorização financeira. SERVERPND retornou 0 no perfil de homologação.",
        autorizacaoFinanceira: false,
        perfil: "conector-homologacao",
        evidencias: {
          retornoInit: 0,
          retornoNewTransac: 0,
          retornoExec: null,
          addParam: "USINGPINPAD",
          addParamCodigo: -2499,
          serverPndCodigo: 0,
          serverPndValor: "0",
          pndReqNum: Number(journal.identificacaoPosErro?.pndReqNum),
          pndLocRef: Number(journal.identificacaoPosErro?.pndLocRef),
          pndExtRef: Number(journal.identificacaoPosErro?.pndExtRef),
        },
      },
    },
  };
}

export function encerrarCapturaIlegivel(journal, evidencias = {}, agora = new Date().toISOString()) {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) {
    return { ok: false, codigo: "ausente" };
  }
  if (journal.status === STATUS_JOURNAL_TEF.SESSAO_TECNICA_PERDIDA_ANTES_CAPTURA) {
    return { ok: true, repetida: true, registro: journal };
  }
  const solicitacao = journal.solicitacaoInicial ?? {};
  const referencias = journal.referencias && typeof journal.referencias === "object" ? journal.referencias : {};
  const corresponde =
    journal.status === "resultado_desconhecido" &&
    journal.identificador === OPERACAO_CAPTURA_ILEGIVEL.identificador &&
    journal.correlationId === OPERACAO_CAPTURA_ILEGIVEL.correlationId &&
    journal.perfil === "conector-homologacao" &&
    journal.operacao === "PWOPER_SALE" &&
    journal.valorCentavos === 100 &&
    journal.pagamentoRecebido !== true &&
    journal.confirmacaoChamada !== true &&
    journal.desfazimentoChamado !== true &&
    journal.autorizacaoFinanceira !== true &&
    journal.respostaEnviada === false &&
    journal.retomavel === false &&
    journal.sessaoNativa === "encerrada" &&
    Number(journal.retornoInit) === 0 &&
    Number(journal.retornoNewTransac) === 0 &&
    Array.isArray(journal.execucoes) &&
    journal.execucoes.length === 1 &&
    Number(journal.execucoes[0]) === -2497 &&
    journal.serverPndValor === "0" &&
    Number(solicitacao.identificador) === 54 &&
    Number(solicitacao.tipo) === 1 &&
    Array.isArray(solicitacao.opcoes) &&
    solicitacao.opcoes.length === 0 &&
    Object.keys(referencias).length === 0 &&
    evidencias.perfil === "conector-homologacao" &&
    evidencias.sessaoAtiva === false &&
    evidencias.operacaoConcorrente === false &&
    Number(evidencias.init) === 0 &&
    Number(evidencias.serverPndCodigo) === 0 &&
    evidencias.serverPndValor === "0";
  if (!corresponde) return { ok: false, codigo: "nao_corresponde" };
  const anterior = structuredClone(journal);
  return {
    ok: true,
    repetida: false,
    registro: {
      ...anterior,
      status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_PERDIDA_ANTES_CAPTURA,
      retomavel: false,
      sessaoNativa: "encerrada",
      respostaEnviada: false,
      confirmar: false,
      precisaConfirmacao: false,
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      desfazimentoChamado: false,
      autorizacaoFinanceira: false,
      historico: [...(Array.isArray(anterior.historico) ? anterior.historico : []), anterior],
      encerramento: {
        statusAnterior: "resultado_desconhecido",
        status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_PERDIDA_ANTES_CAPTURA,
        em: agora,
        motivo:
          "A sessão terminou com o menu 0x36 ainda sem valor lido. Não houve captura, autorização, confirmação nem desfazimento. SERVERPND retornou 0.",
        confirmacao: false,
        desfazimento: false,
        cancelamentoFinanceiro: false,
        evidencias: {
          retornoInit: 0,
          retornoNewTransac: 0,
          retornoExec: -2497,
          serverPndCodigo: 0,
          serverPndValor: "0",
          sessaoAtiva: false,
          operacaoConcorrente: false,
        },
      },
    },
  };
}

export function encerrarSessaoNativaPerdida(journal, evidencias = {}, agora = new Date().toISOString()) {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) {
    return { ok: false, codigo: "ausente" };
  }
  if (journal.status === STATUS_JOURNAL_TEF.SESSAO_NATIVA_PERDIDA) {
    return { ok: true, repetida: true, registro: journal };
  }
  const solicitacao = Array.isArray(journal.solicitacoes) ? journal.solicitacoes[0] : null;
  const referencias = journal.referencias && typeof journal.referencias === "object" ? journal.referencias : {};
  const corresponde =
    journal.status === "aguardando_captura" &&
    journal.identificador === OPERACAO_VENDA_PERDIDA.identificador &&
    journal.correlationId === OPERACAO_VENDA_PERDIDA.correlationId &&
    journal.perfil === "conector-homologacao" &&
    journal.operacao === "PWOPER_SALE" &&
    journal.valorCentavos === 100 &&
    journal.transacaoIniciada === true &&
    journal.pagamentoRecebido !== true &&
    journal.confirmacaoChamada !== true &&
    journal.desfazimentoChamado !== true &&
    journal.autorizacaoFinanceira !== true &&
    journal.retomavel === false &&
    journal.sessaoNativa === "encerrada" &&
    Number(journal.retornoInit) === 0 &&
    Number(journal.retornoNewTransac) === 0 &&
    Number(journal.retornoExec) === -2497 &&
    journal.serverPndValor === "0" &&
    Number(journal.serverPndCodigo) === 0 &&
    journal.serverPndConsulta?.valor === "0" &&
    Number(journal.serverPndConsulta?.codigo) === 0 &&
    Number(journal.serverPndConsulta?.init) === 0 &&
    solicitacao?.tipo === 1 &&
    solicitacao?.info === 54 &&
    Object.keys(referencias).length === 0 &&
    evidencias.perfil === "conector-homologacao" &&
    evidencias.sessaoAtiva === false &&
    evidencias.operacaoConcorrente === false &&
    Number(evidencias.init) === 0 &&
    Number(evidencias.serverPndCodigo) === 0 &&
    evidencias.serverPndValor === "0";
  if (!corresponde) return { ok: false, codigo: "nao_corresponde" };
  const anterior = structuredClone(journal);
  return {
    ok: true,
    repetida: false,
    registro: {
      ...anterior,
      status: STATUS_JOURNAL_TEF.SESSAO_NATIVA_PERDIDA,
      retomavel: false,
      sessaoNativa: "encerrada",
      confirmar: false,
      precisaConfirmacao: false,
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      desfazimentoChamado: false,
      autorizacaoFinanceira: false,
      historico: [anterior],
      encerramento: {
        statusAnterior: "aguardando_captura",
        status: STATUS_JOURNAL_TEF.SESSAO_NATIVA_PERDIDA,
        em: agora,
        motivo:
          "A sessão nativa terminou durante o menu e não pode ser retomada pelo journal. Não houve autorização, confirmação, desfazimento nem cancelamento financeiro. SERVERPND retornou 0.",
        confirmacao: false,
        desfazimento: false,
        cancelamentoFinanceiro: false,
        evidencias: {
          retornoInit: 0,
          retornoNewTransac: 0,
          retornoExec: -2497,
          serverPndCodigo: 0,
          serverPndValor: "0",
          sessaoAtiva: false,
          operacaoConcorrente: false,
        },
      },
    },
  };
}

const STATUS_ETAPA_PROTEGIDO = new Set([
  STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO,
  STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO,
  STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
  "aguardando_confirmacao",
  "aguardando_captura",
]);

export async function gravarEtapaAntesDaExecucao(arquivo, dados = {}, fsApi = fs) {
  let anterior = null;
  try {
    anterior = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
  } catch (erro) {
    if (erro?.code !== "ENOENT") return { gravado: false, preservado: true, journalApagado: false };
  }
  const correlationId = texto(dados.correlationId || dados.identificador);
  const identificador = texto(dados.identificador || correlationId);
  const valor = numero(dados.valor) ?? numero(anterior?.valor);
  if (!identificador || !correlationId || valor == null || valor <= 0) {
    return { gravado: false, preservado: true, journalApagado: false, codigo: "incompleto" };
  }
  if (
    anterior?.status === STATUS_JOURNAL_TEF.RESULTADO_TERMINAL &&
    anterior?.reconciliacao?.situacao === "pendente"
  ) {
    return { gravado: false, preservado: true, journalApagado: false, codigo: "reconciliacao" };
  }
  if (
    anterior &&
    (STATUS_ETAPA_PROTEGIDO.has(anterior.status) || anterior.status === "execucao_iniciada")
  ) {
    return { gravado: false, preservado: true, journalApagado: false, codigo: "outra" };
  }
  if (
    anterior &&
    texto(anterior.correlationId) &&
    texto(anterior.correlationId) !== correlationId &&
    anterior.status === STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO
  ) {
    return { gravado: false, preservado: true, journalApagado: false, codigo: "outra" };
  }
  const historico = [];
  if (anterior && texto(anterior.correlationId) && texto(anterior.correlationId) !== correlationId) {
    const copia = { ...anterior };
    delete copia.historico;
    historico.push(copia);
  } else if (Array.isArray(anterior?.historico)) {
    historico.push(...anterior.historico);
  }
  const transacaoAberta = dados.retornoNewTransac === 0;
  const registro = {
    versao: 1,
    status: transacaoAberta ? STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO : "falha_tecnica_antes_da_transacao",
    identificador,
    correlationId,
    valor,
    dataHoraInicio: texto(anterior?.dataHoraInicio) || texto(dados.dataHoraInicio) || new Date().toISOString(),
    etapa: texto(dados.etapa) || texto(anterior?.etapa) || "antes_de_PW_iNewTransac",
    retornoNewTransac:
      dados.retornoNewTransac === undefined ? (anterior?.retornoNewTransac ?? null) : dados.retornoNewTransac,
    executada: dados.executada === true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    perfil: "conector-homologacao",
    operacao: "PWOPER_SALE",
    ...(texto(dados.empresaId) ? { empresaId: texto(dados.empresaId) } : {}),
    ...(texto(dados.terminalCodigo) ? { terminalCodigo: texto(dados.terminalCodigo) } : {}),
    ...(texto(dados.dispositivoId) ? { dispositivoId: texto(dados.dispositivoId) } : {}),
    ...(dados.ambiente === "homologacao" || dados.ambiente === "producao" ? { ambiente: dados.ambiente } : {}),
    prova1817: evidenciasReconciliacaoValidas(anterior?.encerramento?.evidencias),
    ...(evidenciasReconciliacaoValidas(anterior?.encerramento?.evidencias)
      ? { encerramento: { evidencias: anterior.encerramento.evidencias } }
      : {}),
    historico,
  };
  await gravarPendenciaTef(arquivo, registro, fsApi);
  return { gravado: true, preservado: true, journalApagado: false, registro };
}

export function encerrarSessaoAbertaSemExecucao(journal = {}, evidencias = {}, agora = new Date().toISOString()) {
  const corresponde =
    Number(journal.retornoNewTransac) === 0 &&
    journal.executada !== true &&
    journal.retornoExec == null &&
    journal.autorizacaoFinanceira !== true &&
    journal.pagamentoRecebido !== true &&
    journal.confirmacaoChamada !== true &&
    journal.desfazimentoChamado !== true &&
    evidencias.bloqueioFinanceiro !== true &&
    evidenciasReconciliacaoValidas(evidencias);
  if (!corresponde) return { ok: false, codigo: "nao_corresponde", journalApagado: false };
  return {
    ok: true,
    journalApagado: false,
    registro: {
      versao: 1,
      status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA,
      identificador: texto(journal.identificador) || "sessao-1817-homologacao",
      correlationId: texto(journal.correlationId) || texto(journal.identificador) || "sessao-1817-homologacao",
      valor: numero(journal.valor),
      dataHoraInicio: texto(journal.dataHoraInicio) || agora,
      perfil: "conector-homologacao",
      operacao: "PWOPER_SALE",
      confirmar: false,
      precisaConfirmacao: false,
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      desfazimentoChamado: false,
      autorizacaoFinanceira: false,
      executada: false,
      prova1817: true,
      encerramento: {
        statusAnterior: journal.status || STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO,
        status: STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA,
        em: agora,
        motivo:
          "PW_iGetResult(PWINFO_SERVERPND) retornou PWRET_OK e 0. As cinco referências pendentes retornaram PWRET_OK vazias. Não havia transação local aberta. PW_iConfirmation não foi chamada.",
        confirmacao: false,
        desfazimento: false,
        evidencias: {
          retornoNewTransac: 0,
          retornoExec: null,
          serverPndCodigo: PWRET.OK,
          serverPndValor: "0",
          referenciasPresentes: false,
          transacaoLocalAberta: false,
          pendentes: SEQUENCIA_REFERENCIAS_PENDENTES.map((oficial) => ({
            nome: oficial.nome,
            info: oficial.info,
            codigo: PWRET.OK,
            vazio: true,
          })),
        },
      },
    },
  };
}

export function montarFalhaReconciliacao1817(journal = {}, leitura = {}, agora = new Date().toISOString()) {
  return {
    versao: 1,
    status: STATUS_JOURNAL_TEF.RECONCILIACAO_PENDENTE,
    identificador: texto(journal.identificador) || "sessao-1817-homologacao",
    correlationId: texto(journal.correlationId) || texto(journal.identificador) || "sessao-1817-homologacao",
    retornoNewTransac: Number(journal.retornoNewTransac) === 0 ? 0 : journal.retornoNewTransac ?? null,
    executada: false,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    prova1817: false,
    perfil: "conector-homologacao",
    operacao: "PWOPER_SALE",
    leitura: {
      em: agora,
      codigo: texto(leitura.codigo),
      tag: texto(leitura.tag),
      retorno: Number.isInteger(Number(leitura.retorno)) ? Number(leitura.retorno) : null,
      nomeRetorno: texto(leitura.nomeRetorno),
      mensagem: texto(leitura.mensagem),
    },
  };
}

export async function persistirReconciliacao1817(arquivo, registro, fsApi = fs) {
  let anteriorTexto = null;
  let anterior = null;
  try {
    anteriorTexto = await fsApi.readFile(arquivo, "utf8");
    anterior = JSON.parse(anteriorTexto);
  } catch (erro) {
    if (erro?.code !== "ENOENT") throw erro;
  }
  const protegido = anterior && (
    STATUS_ETAPA_PROTEGIDO.has(anterior.status) ||
    anterior.status === STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO ||
    anterior.status === "execucao_iniciada"
  );
  if (protegido) return { gravado: false, preservado: true, journalApagado: false };
  if (registro?.prova1817 !== true && evidenciasReconciliacaoValidas(anterior?.encerramento?.evidencias)) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  if (anteriorTexto) {
    await fsApi.appendFile(`${arquivo}.historico.jsonl`, `${anteriorTexto.trim()}\n`);
  }
  const historico = [];
  if (Array.isArray(anterior?.historico)) historico.push(...anterior.historico);
  if (anterior) {
    const copia = { ...anterior };
    delete copia.historico;
    historico.push(copia);
  }
  await gravarPendenciaTef(arquivo, { ...registro, historico, journalApagado: false }, fsApi);
  return { gravado: true, preservado: Boolean(anterior), journalApagado: false };
}

export async function registrarConsultaRecuperacao(arquivo, consulta = {}, fsApi = fs) {
  if (!arquivo) return { gravado: false, journalApagado: false };
  const linha = `${JSON.stringify({
    tipo: "consulta_recuperacao",
    liberaCaptura: false,
    situacao: texto(consulta.situacao),
    tag: texto(consulta.tag),
    retorno: Number.isInteger(consulta.retorno) ? consulta.retorno : null,
    nomeRetorno: texto(consulta.nomeRetorno),
    vazio: consulta.vazio === true,
    confirmacaoChamada: false,
    novaCobranca: false,
    journalApagado: false,
    registradoEm: new Date().toISOString(),
  })}\n`;
  await fsApi.appendFile(`${arquivo}.consulta.jsonl`, linha);
  return { gravado: true, journalApagado: false };
}

export async function registrarProvaSemApagarJournal(arquivo, registro, fsApi = fs) {
  let anterior = null;
  try {
    anterior = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
  } catch (erro) {
    if (erro?.code !== "ENOENT") throw erro;
  }
  const preservar =
    anterior?.status === "execucao_iniciada" ||
    anterior?.status === STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO ||
    anterior?.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO ||
    anterior?.status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO;
  if (preservar) return anexarProvaReconciliacao(arquivo, registro, fsApi);
  return persistirReconciliacao1817(arquivo, registro, fsApi);
}

export async function marcarExecucaoIniciada(arquivo, dados = {}, fsApi = fs) {
  let anterior = null;
  try {
    anterior = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
  } catch (erro) {
    if (erro?.code !== "ENOENT") return { gravado: false, preservado: true, journalApagado: false };
  }
  if (!anterior || anterior.status !== STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO) {
    return { gravado: false, preservado: true, journalApagado: false, codigo: "ausente" };
  }
  if (texto(anterior.correlationId) !== texto(dados.correlationId)) {
    return { gravado: false, preservado: true, journalApagado: false, codigo: "outra" };
  }
  const registro = {
    ...anterior,
    status: "execucao_iniciada",
    etapa: "PW_iExecTransac",
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
  };
  await gravarPendenciaTef(arquivo, registro, fsApi);
  return { gravado: true, preservado: true, journalApagado: false, registro };
}

export async function lerProvaEtapaVenda(arquivo, fsApi = fs) {
  try {
    const json = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
    return {
      existe: true,
      prova1817: evidenciasReconciliacaoValidas(json?.encerramento?.evidencias),
      aberta: json?.status === STATUS_JOURNAL_TEF.SESSAO_ABERTA_SEM_EXECUCAO && Number(json?.retornoNewTransac) === 0 && json?.executada !== true,
      executada: json?.executada === true,
    };
  } catch (erro) {
    if (erro?.code === "ENOENT") return { existe: false, prova1817: false, aberta: false, executada: false };
    return { existe: true, prova1817: false, aberta: false, executada: false, ilegivel: true };
  }
}

export async function lerPendenciaTef(arquivo, fsApi = fs) {
  let bruto;
  try {
    bruto = await fsApi.readFile(arquivo, "utf8");
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return { ok: true, registro: null };
    }
    if (erro?.code === "EPERM" || erro?.code === "EACCES") {
      return { ok: false, ilegivel: false, codigo: "permissao" };
    }
    return { ok: false, ilegivel: true, codigo: "leitura" };
  }
  return interpretarPendencia(bruto);
}

function textoCurto(valor, limite) {
  return texto(valor).replace(/[\r\n\u0000]/g, " ").trim().slice(0, limite);
}

function cnfReqNormalizado(valor) {
  const lido = textoCurto(valor, 8);
  return lido === "0" || lido === "1" ? lido : "";
}

function resultadoIdNormalizado(valor) {
  const lido = textoCurto(valor, 32);
  return /^[A-Za-z0-9-]{0,32}$/.test(lido) ? lido : "";
}

export function descreverResultadoTerminal(dados = {}) {
  const retorno = Number(dados.retornoExec);
  const informada = texto(dados.classe);
  let classe = "desconhecido";
  if (informada === "aprovada" && retorno === PWRET.OK) classe = "aprovada";
  else if (informada === "cancelada" && retorno === PWRET.CANCEL) classe = "cancelada";
  else if (informada === "recusa" && (retorno === PWRET_FROMHOST_POS || retorno === PWRET_FROMHOST_USR)) classe = "recusa";
  else if (retorno === PWRET_FROMHOST) classe = "falha_informada_pelo_host";
  const confirmacaoChamada = classe === "aprovada" && dados.confirmacaoChamada === true;
  const pagamentoRecebido = confirmacaoChamada && dados.pagamentoRecebido === true;
  const reconciliacao = pagamentoRecebido
    ? { situacao: "confirmada", efeitoFinanceiro: "recebido", cancelamento: false, estorno: false, ausenciaDeCobrancaComprovada: false }
    : { situacao: "pendente", efeitoFinanceiro: "nao_comprovado", cancelamento: false, estorno: false, ausenciaDeCobrancaComprovada: false };
  return {
    retorno: Number.isInteger(retorno) ? retorno : null,
    classe,
    confirmacaoChamada,
    pagamentoRecebido,
    reconciliacao,
    bloqueiaNovaCobranca: reconciliacao.situacao === "pendente",
  };
}

function interpretarResultadoTerminal(json) {
  const identificador = texto(json.identificador);
  const correlationId = texto(json.correlationId);
  const host = json.host && typeof json.host === "object" ? json.host : null;
  const reconciliacao = json.reconciliacao && typeof json.reconciliacao === "object" ? json.reconciliacao : null;
  const retorno = Number(host?.retorno);
  const descricao = descreverResultadoTerminal({
    retornoExec: retorno,
    classe: host?.classe,
    confirmacaoChamada: json.confirmacaoChamada === true,
    pagamentoRecebido: json.pagamentoRecebido === true,
  });
  if (
    !identificador ||
    !correlationId ||
    !host ||
    !reconciliacao ||
    descricao.retorno == null ||
    descricao.classe !== texto(host.classe) ||
    reconciliacao.situacao !== descricao.reconciliacao.situacao ||
    json.desfazimentoChamado === true ||
    json.autorizacaoFinanceira === true ||
    (json.pagamentoRecebido === true && descricao.pagamentoRecebido !== true) ||
    (json.confirmacaoChamada === true && descricao.confirmacaoChamada !== true) ||
    reconciliacao.cancelamento === true ||
    reconciliacao.estorno === true ||
    reconciliacao.ausenciaDeCobrancaComprovada === true
  ) {
    return { ok: false, ilegivel: true };
  }
  if (descricao.bloqueiaNovaCobranca) {
    return {
      ok: true,
      registro: null,
      bloqueiaNovaCobranca: true,
      recuperavel: false,
      resultadoTerminal: true,
      identificador,
      correlationId,
      classe: descricao.classe,
      mensagemHost: textoCurto(host.mensagem, 180),
      retornoExec: descricao.retorno,
    };
  }
  return {
    ok: true,
    registro: null,
    bloqueiaNovaCobranca: false,
    recuperavel: false,
    resultadoTerminal: true,
    identificador,
    correlationId,
    encerrado: { status: descricao.reconciliacao.situacao, identificador, correlationId },
  };
}

function mesmoResultadoTerminal(anterior, descricao, resultadoId, mensagem, cnfReq) {
  const host = anterior?.host ?? {};
  return (
    anterior?.status === STATUS_JOURNAL_TEF.RESULTADO_TERMINAL &&
    Number(host.retorno) === descricao.retorno &&
    texto(host.classe) === descricao.classe &&
    texto(host.resultadoId) === resultadoId &&
    texto(host.mensagem) === mensagem &&
    texto(host.cnfReq) === cnfReq &&
    anterior.confirmacaoChamada === descricao.confirmacaoChamada &&
    anterior.pagamentoRecebido === descricao.pagamentoRecebido &&
    anterior.reconciliacao?.situacao === descricao.reconciliacao.situacao
  );
}

export async function persistirResultadoTerminal(arquivo, dados = {}, fsApi = fs) {
  const identificador = texto(dados.identificador || dados.correlationId);
  const correlationId = texto(dados.correlationId || identificador);
  const descricao = descreverResultadoTerminal(dados);
  if (!arquivo || !identificador || !correlationId || descricao.retorno == null) {
    return { gravado: false, preservado: true, journalApagado: false, idempotente: false };
  }
  let anterior = null;
  try {
    anterior = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
  } catch (erro) {
    if (erro?.code !== "ENOENT") return { gravado: false, preservado: true, journalApagado: false, idempotente: false };
  }
  if (anterior && texto(anterior.correlationId) && texto(anterior.correlationId) !== correlationId) {
    return { gravado: false, preservado: true, journalApagado: false, idempotente: false, codigo: "outra" };
  }
  const resultadoId = resultadoIdNormalizado(dados.resultadoId);
  const mensagem = textoCurto(dados.mensagemHost, 180);
  const cnfReq = cnfReqNormalizado(dados.cnfReq);
  if (mesmoResultadoTerminal(anterior, descricao, resultadoId, mensagem, cnfReq)) {
    return {
      gravado: false,
      preservado: true,
      journalApagado: false,
      idempotente: true,
      bloqueiaNovaCobranca: descricao.bloqueiaNovaCobranca,
      registro: anterior,
    };
  }
  if (
    anterior?.status === STATUS_JOURNAL_TEF.RESULTADO_TERMINAL &&
    anterior?.reconciliacao?.situacao === "pendente" &&
    descricao.bloqueiaNovaCobranca !== true
  ) {
    return { gravado: false, preservado: true, journalApagado: false, idempotente: false, codigo: "divergente" };
  }
  const historico = [];
  if (Array.isArray(anterior?.historico)) historico.push(...anterior.historico);
  if (anterior) {
    const copia = { ...anterior };
    delete copia.historico;
    historico.push(copia);
  }
  const registro = {
    versao: 1,
    status: STATUS_JOURNAL_TEF.RESULTADO_TERMINAL,
    identificador,
    correlationId,
    ...(texto(dados.empresaId) || texto(anterior?.empresaId) ? { empresaId: texto(dados.empresaId) || texto(anterior?.empresaId) } : {}),
    ...(texto(dados.terminalCodigo) || texto(anterior?.terminalCodigo) ? { terminalCodigo: texto(dados.terminalCodigo) || texto(anterior?.terminalCodigo) } : {}),
    ...(texto(dados.dispositivoId) || texto(anterior?.dispositivoId) ? { dispositivoId: texto(dados.dispositivoId) || texto(anterior?.dispositivoId) } : {}),
    ...(anterior?.ambiente === "homologacao" || anterior?.ambiente === "producao" ? { ambiente: anterior.ambiente } : {}),
    ...(numero(anterior?.valor) != null ? { valor: numero(anterior?.valor) } : {}),
    ...(texto(anterior?.dataHoraInicio) ? { dataHoraInicio: texto(anterior.dataHoraInicio) } : {}),
    etapa: "resultado_terminal",
    retornoNewTransac: anterior?.retornoNewTransac === 0 ? 0 : anterior?.retornoNewTransac ?? null,
    retornoExec: descricao.retorno,
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: descricao.pagamentoRecebido,
    confirmacaoChamada: descricao.confirmacaoChamada,
    desfazimentoChamado: false,
    perfil: texto(anterior?.perfil) || "conector-homologacao",
    operacao: "PWOPER_SALE",
    host: {
      retorno: descricao.retorno,
      classe: descricao.classe,
      resultadoId,
      mensagem,
      cnfReq,
    },
    reconciliacao: descricao.reconciliacao,
    historico,
    journalApagado: false,
  };
  await gravarPendenciaTef(arquivo, registro, fsApi);
  await fsApi.appendFile(
    `${arquivo}.auditoria.jsonl`,
    `${JSON.stringify({
      tipo: "resultado_terminal",
      identificador,
      correlationId,
      statusAnterior: texto(anterior?.status),
      retornoExec: descricao.retorno,
      classe: descricao.classe,
      resultadoId,
      cnfReq,
      confirmacaoChamada: descricao.confirmacaoChamada,
      pagamentoRecebido: descricao.pagamentoRecebido,
      reconciliacao: descricao.reconciliacao.situacao,
      journalOriginalPreservado: Boolean(anterior),
      registradoEm: new Date().toISOString(),
    })}\n`
  );
  return {
    gravado: true,
    preservado: Boolean(anterior),
    journalApagado: false,
    idempotente: false,
    bloqueiaNovaCobranca: descricao.bloqueiaNovaCobranca,
    registro,
  };
}

export async function gravarPendenciaTef(arquivo, registro, fsApi = fs) {
  const pasta = path.dirname(arquivo);
  await fsApi.mkdir(pasta, { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  const json = `${JSON.stringify(registro, null, 2)}\n`;
  const handle = await fsApi.open(temporario, "w");
  try {
    await handle.writeFile(json, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsApi.rename(temporario, arquivo);
  } catch (erro) {
    if (erro?.code !== "EEXIST" && erro?.code !== "EPERM") {
      throw erro;
    }
    const antigo = `${arquivo}.antigo`;
    await fsApi.rename(arquivo, antigo);
    await fsApi.rename(temporario, arquivo);
    await fsApi.unlink(antigo).catch(() => {});
  }
}

export async function removerPendenciaTef(arquivo, fsApi = fs) {
  try {
    await fsApi.unlink(arquivo);
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      throw erro;
    }
  }
}
