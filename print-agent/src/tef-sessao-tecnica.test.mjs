import assert from "node:assert/strict";
import test from "node:test";

import { classificarPendenciaNativa, decidirConfirmacaoNativa } from "./tef-venda-nativa.mjs";
import {
  OPERACAO_CAPTURA_ILEGIVEL,
  OPERACAO_HOST_SEM_AUTORIZACAO,
  OPERACAO_VENDA_PERDIDA,
  STATUS_JOURNAL_TEF,
  encerrarCapturaIlegivel,
  encerrarSessaoNativaPerdida,
  encerrarSessaoTecnicaIncompleta,
  interpretarPendencia,
} from "./tef-pendencia.mjs";

const EVIDENCIA = { perfil: "conector-homologacao", serverPndCodigo: 0, serverPndValor: "0" };

function tentativa() {
  return {
    versao: 1,
    status: "resultado_desconhecido",
    identificador: "fe127fa8-a791-429e-a583-381593b6eabe",
    valor: 0.01,
    dataHoraInicio: "2026-10-18T02:04:14.185Z",
    correlationId: "f5bfa328-9c44-4278-a2a7-a297db695e2c",
    rede: "",
    nsu: "",
    finalizacao: "",
    operacao: "PWOPER_SALE",
    perfil: "conector-homologacao",
    transacaoIniciada: true,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    retornoInit: 0,
    retornoNewTransac: 0,
    addParam: [{ info: "USINGPINPAD", codigo: -2499, nome: "PWRET_INVPARAM" }],
    identificacaoPosErro: {
      pndReqNum: -2496,
      pndLocRef: -2496,
      pndExtRef: -2496,
      serverPndPresente: true,
      prova: false,
    },
  };
}

test("o encerramento preserva a tentativa e deixa de bloquear somente esse estado", () => {
  const fechado = encerrarSessaoTecnicaIncompleta(tentativa(), EVIDENCIA, "2026-10-18T09:20:00.000Z");
  assert.equal(fechado.ok, true);
  assert.equal(fechado.registro.status, STATUS_JOURNAL_TEF.SESSAO_TECNICA_INCOMPLETA);
  assert.equal(fechado.registro.historico[0].status, "resultado_desconhecido");
  assert.equal(fechado.registro.historico[0].retornoNewTransac, 0);
  assert.equal(fechado.registro.historico[0].retornoExec, undefined);
  assert.equal(fechado.registro.encerramento.evidencias.serverPndValor, "0");
  assert.equal(fechado.registro.autorizacaoFinanceira, false);
  const repetido = encerrarSessaoTecnicaIncompleta(fechado.registro, EVIDENCIA);
  assert.equal(repetido.repetida, true);
  assert.equal(repetido.registro.historico.length, 1);
  const lido = interpretarPendencia(JSON.stringify(fechado.registro));
  assert.equal(lido.ok, true);
  assert.equal(lido.registro, null);
  assert.equal(lido.encerrado.serverPndValor, "0");
  assert.equal(classificarPendenciaNativa(fechado.registro).acao, "seguir");
  assert.equal(classificarPendenciaNativa(fechado.registro).confirmar, false);
  assert.equal(classificarPendenciaNativa(fechado.registro).desfazer, false);
});

test("autorização, pendência remota e outra tentativa não são encerradas", () => {
  const comNsu = tentativa();
  comNsu.nsu = "123";
  assert.equal(encerrarSessaoTecnicaIncompleta(comNsu, EVIDENCIA).ok, false);
  const remota = tentativa();
  assert.equal(
    encerrarSessaoTecnicaIncompleta(remota, { ...EVIDENCIA, serverPndValor: "1" }).ok,
    false
  );
  assert.equal(
    classificarPendenciaNativa({
      status: "resultado_desconhecido",
      identificacaoPosErro: { serverPndValor: "1" },
    }).motivo,
    "remota"
  );
  const concorrente = classificarPendenciaNativa({
    status: "iniciada",
    transacaoIniciada: true,
    reqNum: "1",
    locRef: "2",
    extRef: "3",
  });
  assert.equal(concorrente.acao, "bloquear");
  assert.equal(concorrente.confirmar, false);
});

test("a venda de um real só encerra como sessão perdida sem autorização", () => {
  const journal = {
    versao: 1,
    status: "aguardando_captura",
    perfil: "conector-homologacao",
    operacao: "PWOPER_SALE",
    valorCentavos: 100,
    identificador: OPERACAO_VENDA_PERDIDA.identificador,
    correlationId: OPERACAO_VENDA_PERDIDA.correlationId,
    transacaoIniciada: true,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    autorizacaoFinanceira: false,
    retornoInit: 0,
    retornoNewTransac: 0,
    retornoExec: -2497,
    serverPndCodigo: 0,
    serverPndValor: "0",
    retomavel: false,
    sessaoNativa: "encerrada",
    solicitacoes: [{ indice: 0, tipo: 1, info: 54, prompt: "" }],
    referencias: {},
    serverPndConsulta: { codigo: 0, valor: "0", init: 0 },
  };
  const evidencias = {
    perfil: "conector-homologacao",
    sessaoAtiva: false,
    operacaoConcorrente: false,
    init: 0,
    serverPndCodigo: 0,
    serverPndValor: "0",
  };
  const fechado = encerrarSessaoNativaPerdida(journal, evidencias, "2026-10-18T13:05:00.000Z");
  assert.equal(fechado.ok, true);
  assert.equal(fechado.registro.status, STATUS_JOURNAL_TEF.SESSAO_NATIVA_PERDIDA);
  assert.equal(fechado.registro.historico[0].status, "aguardando_captura");
  assert.equal(fechado.registro.historico[0].retornoExec, -2497);
  assert.equal(fechado.registro.correlationId, OPERACAO_VENDA_PERDIDA.correlationId);
  assert.equal(fechado.registro.confirmacaoChamada, false);
  assert.equal(fechado.registro.desfazimentoChamado, false);
  assert.equal(fechado.registro.encerramento.confirmacao, false);
  assert.equal(fechado.registro.encerramento.cancelamentoFinanceiro, false);
  const lido = interpretarPendencia(JSON.stringify(fechado.registro));
  assert.equal(lido.ok, true);
  assert.equal(lido.registro, null);
  assert.equal(lido.encerrado.correlationId, OPERACAO_VENDA_PERDIDA.correlationId);
  assert.equal(classificarPendenciaNativa(fechado.registro).acao, "seguir");
  assert.equal(classificarPendenciaNativa(fechado.registro).confirmar, false);
  assert.equal(classificarPendenciaNativa(fechado.registro).desfazer, false);
  assert.equal(classificarPendenciaNativa(fechado.registro).retomavel, false);
  assert.equal(decidirConfirmacaoNativa(fechado.registro).chamar, false);
  assert.equal(decidirConfirmacaoNativa(fechado.registro).codigo, "REFERENCIAS");
  assert.equal(
    decidirConfirmacaoNativa({
      autorizacaoFinanceira: true,
      referencias: { reqNum: "1", locRef: "2", extRef: "3", virtMerch: "4", authSyst: "5" },
    }).chamar,
    false
  );
  const outra = structuredClone(journal);
  outra.correlationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  assert.equal(encerrarSessaoNativaPerdida(outra, evidencias).ok, false);
  const repetido = encerrarSessaoNativaPerdida(fechado.registro, evidencias);
  assert.equal(repetido.repetida, true);
  assert.equal(repetido.registro.historico.length, 1);
});

test("a captura ilegível só encerra a operação conhecida e preserva o histórico", () => {
  const journal = {
    status: "resultado_desconhecido",
    identificador: OPERACAO_CAPTURA_ILEGIVEL.identificador,
    correlationId: OPERACAO_CAPTURA_ILEGIVEL.correlationId,
    perfil: "conector-homologacao",
    operacao: "PWOPER_SALE",
    valorCentavos: 100,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    autorizacaoFinanceira: false,
    respostaEnviada: false,
    retomavel: false,
    sessaoNativa: "encerrada",
    retornoInit: 0,
    retornoNewTransac: 0,
    execucoes: [-2497],
    serverPndValor: "0",
    solicitacaoInicial: { identificador: 54, tipo: 1, opcoes: [] },
    referencias: {},
    tentativaAnterior: { status: "sessao_nativa_perdida_sem_autorizacao" },
  };
  const evidencias = {
    perfil: "conector-homologacao",
    sessaoAtiva: false,
    operacaoConcorrente: false,
    init: 0,
    serverPndCodigo: 0,
    serverPndValor: "0",
  };
  const fechado = encerrarCapturaIlegivel(journal, evidencias, "2026-10-18T14:20:00.000Z");
  assert.equal(fechado.ok, true);
  assert.equal(fechado.registro.status, STATUS_JOURNAL_TEF.SESSAO_TECNICA_PERDIDA_ANTES_CAPTURA);
  assert.equal(fechado.registro.historico[0].status, "resultado_desconhecido");
  assert.equal(fechado.registro.historico[0].execucoes[0], -2497);
  assert.equal(fechado.registro.tentativaAnterior.status, "sessao_nativa_perdida_sem_autorizacao");
  assert.equal(fechado.registro.confirmacaoChamada, false);
  assert.equal(fechado.registro.desfazimentoChamado, false);
  assert.equal(fechado.registro.respostaEnviada, false);
  const lido = interpretarPendencia(JSON.stringify(fechado.registro));
  assert.equal(lido.ok, true);
  assert.equal(lido.registro, null);
  assert.equal(lido.encerrado.correlationId, OPERACAO_CAPTURA_ILEGIVEL.correlationId);
  assert.equal(classificarPendenciaNativa(fechado.registro).acao, "seguir");
  assert.equal(classificarPendenciaNativa(fechado.registro).confirmar, false);
  assert.equal(classificarPendenciaNativa(fechado.registro).desfazer, false);
  const outra = structuredClone(journal);
  outra.identificador = OPERACAO_VENDA_PERDIDA.identificador;
  assert.equal(encerrarCapturaIlegivel(outra, evidencias).ok, false);
  assert.equal(encerrarCapturaIlegivel(fechado.registro, evidencias).repetida, true);
});

test("a recusa do host sem autorização encerra só a operação conhecida", () => {
  const journal = {
    status: "sem_autorizacao",
    identificador: OPERACAO_HOST_SEM_AUTORIZACAO.identificador,
    correlationId: OPERACAO_HOST_SEM_AUTORIZACAO.correlationId,
    sessaoNativa: "encerrada",
    serverPndFinalValor: "0",
    resultado: "erro",
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    retomavel: false,
    referencias: {},
  };
  const lido = interpretarPendencia(JSON.stringify(journal));
  assert.equal(lido.ok, true);
  assert.equal(lido.registro, null);
  assert.equal(lido.encerrado.correlationId, OPERACAO_HOST_SEM_AUTORIZACAO.correlationId);
  assert.equal(classificarPendenciaNativa(journal).acao, "seguir");
  assert.equal(classificarPendenciaNativa(journal).confirmar, false);
  const aberta = { ...journal, retomavel: true };
  assert.equal(interpretarPendencia(JSON.stringify(aberta)).ok, false);
  assert.equal(classificarPendenciaNativa(aberta).acao, "bloquear");
});
