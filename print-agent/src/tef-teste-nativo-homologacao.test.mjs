import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, PWINFO } from "./tef-pgweb.mjs";
import {
  FRASE_CONFIRMACAO,
  avaliarTesteNativoHomologacao,
  classificarServidor,
  decidirRecuperacaoTecnica,
  executarTesteNativoHomologacao,
  interpretarRetornoNativo,
  pedidoTecnicoPadrao,
  processoResidente,
  registrarContinuidade,
} from "./tef-teste-nativo-homologacao.mjs";

const PERFIL = "C:\\Users\\caixa\\AppData\\Local\\UltraPDV\\conector-homologacao";
const DIRETORIO = `${PERFIL}\\TEF\\Homologacao\\PGWeb`;
const JOURNAL = `${PERFIL}\\tef-journal-teste-nativo.json`;

function entrada(extra = {}) {
  return {
    perfil: PERFIL,
    diretorio: DIRETORIO,
    journal: JOURNAL,
    pontoInstalado: true,
    servidor: "homologacao",
    journalPendente: false,
    sessoes: [],
    layoutConferido: true,
    confirmacao: FRASE_CONFIRMACAO,
    pedido: pedidoTecnicoPadrao(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    ),
    ...extra,
  };
}

test("o motor definitivo permanece bloqueado e a confirmação é obrigatória", async () => {
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  const semFrase = avaliarTesteNativoHomologacao(entrada({ confirmacao: "" }));
  assert.equal(semFrase.pronto, false);
  assert.equal(semFrase.codigo, "confirmacao");
  assert.equal(semFrase.pagamentoRecebido, false);
  assert.equal(semFrase.podeFinalizar, false);
  const spy = { chamadas: [], async newTransac() { this.chamadas.push("PW_iNewTransac"); return 0; } };
  const retido = await executarTesteNativoHomologacao(entrada({ confirmacao: "", executar: true }), spy);
  assert.equal(retido.executado, false);
  assert.deepEqual(spy.chamadas, []);
});

test("produção, pendência e idempotência repetida impedem o teste", () => {
  assert.equal(classificarServidor(`host ${"pos-transac.pgweb.io"}`), "producao");
  assert.equal(classificarServidor("servidor hmg"), "homologacao");
  assert.equal(classificarServidor("C:\\UltraPDV\\conector-homologacao"), "desconhecido");
  assert.equal(
    classificarServidor("arquivo lab.exemplo:31735", { homologacao: "lab.exemplo:31735" }),
    "homologacao"
  );
  assert.equal(avaliarTesteNativoHomologacao(entrada({ servidor: "producao" })).codigo, "servidor");
  assert.equal(
    avaliarTesteNativoHomologacao(entrada({ perfil: "C:\\ProgramData\\UltraPDV" })).codigo,
    "perfil"
  );
  assert.equal(avaliarTesteNativoHomologacao(entrada({ journalPendente: true })).codigo, "pendencia");
  assert.equal(
    avaliarTesteNativoHomologacao(
      entrada({
        sessoes: [{ status: "iniciada", idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
      })
    ).codigo,
    "idempotencia"
  );
  assert.equal(decidirRecuperacaoTecnica({ status: "desconhecida" }).acao, "parar");
  assert.equal(decidirRecuperacaoTecnica({ reqNum: "1", locRef: "2", extRef: "3" }).confirmar, false);
});

test("PW_iNewTransac igual a zero não autoriza pagamento nem finaliza venda", async () => {
  const leitura = interpretarRetornoNativo("PW_iNewTransac", 0);
  assert.equal(leitura.transacaoIniciada, true);
  assert.equal(leitura.pagamentoAprovado, false);
  assert.equal(leitura.pagamentoRecebido, false);
  assert.equal(leitura.podeFinalizar, false);
  const spy = {
    chamadas: [],
    async newTransac() {
      this.chamadas.push("PW_iNewTransac");
      return 0;
    },
    async addParam() {
      this.chamadas.push("PW_iAddParam");
      return 0;
    },
    async execTransac() {
      this.chamadas.push("PW_iExecTransac");
      return { codigo: -2497, captura: [{ bTipoDeDado: 3, szPrompt: "Insira o cartao" }] };
    },
    async confirmation() {
      this.chamadas.push("PW_iConfirmation");
      return 0;
    },
  };
  const resultado = await executarTesteNativoHomologacao(entrada({ executar: true }), spy);
  assert.equal(resultado.codigo, "captura");
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.podeFinalizar, false);
  assert.equal(spy.chamadas.includes("PW_iNewTransac"), true);
  assert.equal(spy.chamadas.includes("PW_iAddParam"), true);
  assert.equal(spy.chamadas.includes("PW_iExecTransac"), true);
  assert.equal(spy.chamadas.includes("PW_iConfirmation"), false);
  const servidor = readFileSync(fileURLToPath(new URL("./server.mjs", import.meta.url)), "utf8");
  const versao = JSON.parse(readFileSync(fileURLToPath(new URL("../version.json", import.meta.url)), "utf8"));
  assert.equal(servidor.includes("tef-teste-nativo-homologacao"), false);
  assert.equal(versao.version, "1.3.40");
});

function transporteContinuo(passos) {
  const fila = [...passos];
  return {
    chamadas: [],
    parametros: [],
    async newTransac() {
      this.chamadas.push("PW_iNewTransac");
      return 0;
    },
    async addParam(info, valor) {
      this.chamadas.push("PW_iAddParam");
      this.parametros.push([info, valor]);
      return 0;
    },
    async execTransac() {
      this.chamadas.push("PW_iExecTransac");
      return fila.shift();
    },
    async confirmation() {
      this.chamadas.push("PW_iConfirmation");
      return 0;
    },
  };
}

const menuAdquirente = {
  wIdentificador: 0x36,
  bTipoDeDado: 1,
  bNumOpcoesMenu: 3,
  szPrompt: "Adquirente",
  vszTextoMenu: ["C6 PAY", "REDE", "PIX C6 BANK"],
  vszValorMenu: ["C6", "REDE", "PIX"],
};

test("menu respondido segue na mesma transação com o valor de vszValorMenu", async () => {
  const sessao = (await import("./tef-teste-nativo-homologacao.mjs")).criarSessaoContinua();
  const { responderContinuidadeNativa } = await import("./tef-teste-nativo-homologacao.mjs");
  const transporte = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: 0, captura: [] },
  ]);
  const inicio = await executarTesteNativoHomologacao(entrada({ executar: true, sessao }), transporte);
  assert.equal(inicio.codigo, "captura");
  assert.deepEqual(inicio.solicitacao.opcoes, ["C6 PAY", "REDE", "PIX C6 BANK"]);
  assert.equal(inicio.solicitacao.identificador, 0x36);
  const seguida = await responderContinuidadeNativa(sessao, { indice: 0 });
  assert.equal(seguida.codigo, "executada");
  assert.equal(seguida.pagamentoRecebido, false);
  assert.equal(seguida.confirmacaoChamada, false);
  assert.deepEqual(transporte.parametros.at(-1), [0x36, "C6"]);
  assert.equal(transporte.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
  assert.equal(transporte.chamadas.filter((chamada) => chamada === "PW_iExecTransac").length, 2);
  assert.equal(transporte.chamadas.includes("PW_iConfirmation"), false);
});

test("menu pode abrir outro menu, um campo digitado ou o PinPad sem nova transação", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  const outroMenu = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0x3b, bTipoDeDado: 1, vszTextoMenu: ["A vista"], vszValorMenu: ["1"] }] },
  ]);
  const sessaoMenu = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoMenu }), outroMenu);
  const segundo = await modulo.responderContinuidadeNativa(sessaoMenu, { indice: 1 });
  assert.equal(segundo.solicitacao.identificador, 0x3b);
  assert.equal(outroMenu.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);

  const digitado = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0x2f, bTipoDeDado: 2, szPrompt: "Dado" }] },
    { codigo: 0, captura: [] },
  ]);
  const sessaoDado = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoDado }), digitado);
  await modulo.responderContinuidadeNativa(sessaoDado, { indice: 2 });
  const campo = await modulo.responderContinuidadeNativa(sessaoDado, { valor: "ABC123" });
  assert.equal(campo.codigo, "executada");
  assert.deepEqual(digitado.parametros.at(-1), [0x2f, "ABC123"]);
  assert.equal(digitado.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);

  const pinpad = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 3, szPrompt: "Aproxime ou insira" }] },
  ]);
  const sessaoPin = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoPin }), pinpad);
  const pedidoPin = await modulo.responderContinuidadeNativa(sessaoPin, { indice: 0 });
  assert.equal(pedidoPin.solicitacao.pinpad, true);
  const inventado = await modulo.responderContinuidadeNativa(sessaoPin, { valor: "1234" });
  assert.equal(inventado.codigo, "PINPAD");
  assert.equal(pinpad.parametros.some((item) => item[1] === "1234"), false);
  assert.equal(pinpad.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
});

test("cancelamento, resposta duplicada, queda do processo e outra cobrança não repetem a transação", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  const cancelamento = transporteContinuo([{ codigo: -2497, captura: [menuAdquirente] }]);
  const sessaoCancelada = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoCancelada }), cancelamento);
  const cancelada = await modulo.responderContinuidadeNativa(sessaoCancelada, { cancelar: true });
  assert.equal(cancelada.codigo, "cancelada");
  assert.equal(cancelada.confirmacaoChamada, false);
  assert.equal(cancelamento.chamadas.includes("PW_iConfirmation"), false);
  assert.equal(cancelamento.parametros.length, 9);

  const duplicada = transporteContinuo([{ codigo: -2497, captura: [menuAdquirente] }, { codigo: 0, captura: [] }]);
  const sessaoDuplicada = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoDuplicada }), duplicada);
  sessaoDuplicada.respondidaId = sessaoDuplicada.capturaId;
  const repetida = await modulo.responderContinuidadeNativa(sessaoDuplicada, { indice: 0 });
  assert.equal(repetida.codigo, "DUPLICADA");
  assert.equal(duplicada.parametros.length, 9);

  const perda = transporteContinuo([{ codigo: -2497, captura: [menuAdquirente] }]);
  const sessaoPerdida = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoPerdida }), perda);
  sessaoPerdida.viva = false;
  const perdida = await modulo.responderContinuidadeNativa(sessaoPerdida, { indice: 0 });
  assert.equal(perdida.codigo, "SESSAO_PERDIDA");
  assert.equal(modulo.retomavelPorJournal(), false);
  assert.equal(perda.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);

  const sessaoOcupada = modulo.criarSessaoContinua();
  sessaoOcupada.viva = true;
  const segunda = await executarTesteNativoHomologacao(
    entrada({ executar: true, sessao: sessaoOcupada }),
    cancelamento
  );
  assert.equal(segunda.codigo, "ocupada");
  assert.equal(segunda.executado, false);
  assert.equal(cancelamento.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
  assert.equal(
    avaliarTesteNativoHomologacao(entrada({ journalStatus: "aguardando_captura" })).codigo,
    "pendencia"
  );
  assert.equal(decidirRecuperacaoTecnica({ status: "aguardando_captura", retornoExec: -2497 }).acao, "bloquear");
  assert.equal(decidirRecuperacaoTecnica({ status: "aguardando_captura", retornoExec: -2497 }).confirmar, false);
  const fonte = readFileSync(fileURLToPath(new URL("./tef-teste-nativo-homologacao.mjs", import.meta.url)), "utf8");
  assert.equal(fonte.includes("process.exit"), false);
});

test("NOTHING e DISPLAY repetem a mesma execução e a chave encerrada não volta", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  const transporte = transporteContinuo([
    { codigo: -2493, captura: [] },
    { codigo: -2495, captura: [] },
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2493, captura: [] },
    { codigo: -2495, captura: [] },
    { codigo: -2497, captura: [{ wIdentificador: 0x16, bTipoDeDado: 1, vszTextoMenu: ["Sim"], vszValorMenu: ["1"] }] },
  ]);
  const sessao = modulo.criarSessaoContinua();
  const inicio = await executarTesteNativoHomologacao(entrada({ executar: true, sessao }), transporte);
  assert.equal(inicio.codigo, "captura");
  assert.equal(inicio.solicitacao.identificador, 0x36);
  const memoria = registrarContinuidade(
    { referencias: {}, pagamentoRecebido: false },
    { em: "2026-10-18T13:05:00.000Z", codigo: -2497, tipo: 1, info: 0x36 }
  );
  assert.equal(memoria.pagamentoRecebido, false);
  assert.equal(memoria.confirmacaoChamada, false);
  assert.equal(memoria.eventos[0].info, 0x36);
  const seguinte = await modulo.responderContinuidadeNativa(sessao, { indice: 0 });
  assert.equal(seguinte.solicitacao.identificador, 0x16);
  assert.equal(processoResidente(sessao).encerrar, false);
  assert.equal(processoResidente(sessao).viva, true);
  assert.equal(processoResidente(sessao).novas, 1);
  assert.equal(transporte.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
  assert.equal(transporte.chamadas.includes("PW_iConfirmation"), false);
  const chave = "dc891000-31d5-4cb1-8d44-567c11d0abc9";
  const repetida = avaliarTesteNativoHomologacao(
    entrada({
      chavesEncerradas: [chave],
      pedido: pedidoTecnicoPadrao("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", chave),
    })
  );
  assert.equal(repetida.codigo, "repetida");
  assert.equal(repetida.executado, undefined);
  const spy = { chamadas: [], async newTransac() { this.chamadas.push("PW_iNewTransac"); return 0; } };
  const bloqueada = await executarTesteNativoHomologacao(
    entrada({
      executar: true,
      chavesEncerradas: [chave],
      pedido: pedidoTecnicoPadrao("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", chave),
    }),
    spy
  );
  assert.deepEqual(spy.chamadas, []);
  assert.equal(bloqueada.codigo, "repetida");
});

test("o processo residente recebe o menu, o PinPad e o fim sem outra transação", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  const transporte = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 3, szPrompt: "Aproxime ou insira" }] },
    { codigo: 0, captura: [] },
  ]);
  transporte.ppGetCard = async () => {
    transporte.chamadas.push("PW_iPPGetCard");
    return 0;
  };
  transporte.ppEventLoop = async () => {
    transporte.chamadas.push("PW_iPPEventLoop");
    return { codigo: -2495, display: "Insira o cartao" };
  };
  let eventos = 0;
  const loopOriginal = transporte.ppEventLoop;
  transporte.ppEventLoop = async () => {
    eventos += 1;
    if (eventos === 1) return loopOriginal();
    transporte.chamadas.push("PW_iPPEventLoop");
    return { codigo: 0, display: "" };
  };
  transporte.getResult = async () => ({ codigo: 0, valor: "" });
  transporte.confirmation = async () => {
    transporte.chamadas.push("PW_iConfirmation");
    return 0;
  };
  const sessao = modulo.criarSessaoContinua();
  const inicio = await executarTesteNativoHomologacao(entrada({ executar: true, sessao }), transporte);
  assert.equal(inicio.codigo, "captura");
  const pedido = modulo.pedidoParaOperador(sessao);
  assert.equal(pedido.identificador, 0x36);
  assert.deepEqual(pedido.opcoes, ["C6 PAY", "REDE", "PIX C6 BANK"]);
  const conduzida = await modulo.conduzirProcessoResidente(sessao, {
    aguardarResposta: async (atual) => ({ capturaId: atual.capturaId, indice: 0 }),
  });
  assert.equal(conduzida.encerrar, false);
  assert.equal(conduzida.codigo, "executada");
  assert.equal(conduzida.pagamentoRecebido, false);
  assert.equal(conduzida.confirmacaoChamada, false);
  assert.equal(conduzida.confirmacao.chamar, false);
  assert.equal(conduzida.confirmacao.codigo, "REFERENCIAS");
  assert.deepEqual(transporte.parametros.at(-1), [0x36, "C6"]);
  assert.equal(transporte.parametros.some((item) => item[1] === "1234" || item[1] === "C6 PAY"), false);
  assert.equal(transporte.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
  assert.equal(transporte.chamadas.includes("PW_iPPGetCard"), true);
  assert.equal(transporte.chamadas.includes("PW_iPPEventLoop"), true);
  assert.equal(transporte.chamadas.includes("PW_iConfirmation"), false);
  assert.equal(modulo.processoResidente(sessao).encerrar, false);
});

test("timeout, queda, cancelamento e resposta antiga não continuam a venda", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  async function preparar() {
    const transporte = transporteContinuo([{ codigo: -2497, captura: [menuAdquirente] }]);
    const sessao = modulo.criarSessaoContinua();
    await executarTesteNativoHomologacao(entrada({ executar: true, sessao }), transporte);
    return { transporte, sessao };
  }
  const prazo = await preparar();
  const timeout = await modulo.conduzirProcessoResidente(prazo.sessao, {
    aguardarResposta: async (pedido) => ({ capturaId: pedido.capturaId, timeout: true }),
  });
  assert.equal(timeout.codigo, "TIMEOUT");
  assert.equal(timeout.retomavel, false);
  assert.equal(prazo.transporte.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
  assert.equal(prazo.transporte.parametros.length, 9);

  const queda = await preparar();
  const desconexao = await modulo.conduzirProcessoResidente(queda.sessao, {
    aguardarResposta: async () => {
      throw new Error("conexao");
    },
  });
  assert.equal(desconexao.codigo, "DESCONEXAO");
  assert.equal(desconexao.confirmacaoChamada, false);
  assert.equal(queda.transporte.chamadas.includes("PW_iConfirmation"), false);

  const cancelamento = await preparar();
  const cancelada = await modulo.conduzirProcessoResidente(cancelamento.sessao, {
    aguardarResposta: async (pedido) => ({ capturaId: pedido.capturaId, cancelar: true }),
  });
  assert.equal(cancelada.codigo, "cancelada");
  assert.equal(cancelada.confirmacaoChamada, false);

  const antiga = await preparar();
  const divergente = await modulo.conduzirProcessoResidente(antiga.sessao, {
    aguardarResposta: async () => ({ capturaId: 99, indice: 0 }),
  });
  assert.equal(divergente.codigo, "DIVERGENTE");
  assert.equal(antiga.transporte.parametros.length, 9);
  assert.equal(antiga.sessao.viva, true);

  const pinpad = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 3, szPrompt: "Aproxime ou insira" }] },
  ]);
  pinpad.ppGetCard = async () => 0;
  pinpad.ppEventLoop = async () => ({ codigo: -2484, display: "" });
  pinpad.ppAbort = async () => {
    pinpad.chamadas.push("PW_iPPAbort");
    return 0;
  };
  const sessaoPin = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoPin }), pinpad);
  const perdida = await modulo.conduzirProcessoResidente(sessaoPin, {
    aguardarResposta: async (pedido) => ({ capturaId: pedido.capturaId, indice: 1 }),
    maximoEventos: 2,
  });
  assert.equal(perdida.codigo, "DESCONEXAO");
  assert.equal(perdida.retomavel, false);
  assert.equal(pinpad.chamadas.includes("PW_iPPAbort"), false);
  assert.equal(pinpad.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);

  const encerrada = modulo.criarSessaoContinua();
  encerrada.correlationId = "dc891000-31d5-4cb1-8d44-567c11d0abc9";
  encerrada.viva = true;
  encerrada.captura = { identificador: 1, tipo: 1, opcoes: ["A"], valores: ["A"] };
  encerrada.transporte = pinpad;
  const repetida = await modulo.conduzirProcessoResidente(encerrada, {
    aguardarResposta: async () => ({ capturaId: 1, indice: 0 }),
  });
  assert.equal(repetida.codigo, "REPETIDA");
});

test("chip, retirada, cancelamento, timeout e retorno do host permanecem na mesma transação", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  const transporte = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 3, szPrompt: "Aproxime ou insira" }] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 9, szPrompt: "" }] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 13, szPrompt: "" }] },
    { codigo: -2596, captura: [] },
  ]);
  const eventos = {
    PW_iPPGetCard: [{ codigo: -2495, display: "AGUARDE O CARTAO" }, { codigo: 0, display: "SELECIONADO: MAESTRO" }],
    PW_iPPGoOnChip: [{ codigo: 0, display: "" }],
    PW_iPPRemoveCard: [{ codigo: -2495, display: "[NA A258] ERRO INTERNO" }, { codigo: 0, display: "" }],
  };
  let capturaAtual = "";
  for (const metodo of ["ppGetCard", "ppGoOnChip", "ppFinishChip", "ppRemoveCard"]) {
    transporte[metodo] = async () => {
      const nome = metodo === "ppGetCard" ? "PW_iPPGetCard" : metodo === "ppGoOnChip" ? "PW_iPPGoOnChip" : metodo === "ppFinishChip" ? "PW_iPPFinishChip" : "PW_iPPRemoveCard";
      transporte.chamadas.push(nome);
      capturaAtual = nome;
      return 0;
    };
  }
  transporte.ppEventLoop = async () => {
    transporte.chamadas.push("PW_iPPEventLoop");
    const fila = eventos[capturaAtual];
    return fila.shift();
  };
  transporte.getResult = async (info) => {
    transporte.chamadas.push(`PW_iGetResult:${info}`);
    if (info === PWINFO.RESULTMSG) return { codigo: 0, valor: "[NA A258] ERRO INTERNO" };
    if (info === PWINFO.RESULTID) return { codigo: 0, valor: "258" };
    return { codigo: -2496, valor: "" };
  };
  const sessao = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao }), transporte);
  const resultado = await modulo.conduzirProcessoResidente(sessao, {
    aguardarResposta: async (pedido) => ({ capturaId: pedido.capturaId, indice: 0 }),
  });
  assert.equal(resultado.codigo, "erro");
  assert.equal(resultado.retornoExec, -2596);
  assert.equal(resultado.mensagemHost, "[NA A258] ERRO INTERNO");
  assert.equal(resultado.resultadoId, "258");
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.confirmacaoChamada, false);
  const ordem = transporte.chamadas;
  assert.equal(ordem.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
  assert.ok(ordem.indexOf("PW_iPPGetCard") < ordem.indexOf("PW_iPPGoOnChip"));
  assert.ok(ordem.indexOf("PW_iPPGoOnChip") < ordem.indexOf("PW_iPPRemoveCard"));
  assert.equal(ordem.includes("PW_iPPFinishChip"), false);
  assert.equal(ordem.includes("PW_iConfirmation"), false);
  assert.ok(ordem.indexOf("PW_iPPRemoveCard") < ordem.lastIndexOf("PW_iExecTransac"));
  assert.ok(ordem.lastIndexOf("PW_iExecTransac") < ordem.indexOf(`PW_iGetResult:${PWINFO.RESULTMSG}`));

  const cancelamento = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 3, szPrompt: "Aproxime ou insira" }] },
    { codigo: -2491, captura: [] },
  ]);
  cancelamento.ppGetCard = async () => 0;
  cancelamento.ppEventLoop = async () => ({ codigo: -2491, display: "" });
  const sessaoCancelada = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoCancelada }), cancelamento);
  const cancelada = await modulo.conduzirProcessoResidente(sessaoCancelada, {
    aguardarResposta: async (pedido) => ({ capturaId: pedido.capturaId, indice: 0 }),
  });
  assert.equal(cancelada.codigo, "transacao_cancelada");
  assert.equal(cancelada.retornoExec, -2491);
  assert.equal(cancelada.transacaoEncerrada, true);
  assert.equal(cancelamento.chamadas.filter((chamada) => chamada === "PW_iExecTransac").length, 3);
  assert.equal(cancelamento.chamadas.includes("PW_iConfirmation"), false);

  const prazo = transporteContinuo([
    { codigo: -2497, captura: [menuAdquirente] },
    { codigo: -2497, captura: [{ wIdentificador: 0, bTipoDeDado: 9, szPrompt: "" }] },
  ]);
  prazo.ppGoOnChip = async () => 0;
  prazo.ppEventLoop = async () => ({ codigo: -2490, display: "" });
  prazo.ppAbort = async () => {
    prazo.chamadas.push("PW_iPPAbort");
    return 0;
  };
  const sessaoPrazo = modulo.criarSessaoContinua();
  await executarTesteNativoHomologacao(entrada({ executar: true, sessao: sessaoPrazo }), prazo);
  const esgotado = await modulo.conduzirProcessoResidente(sessaoPrazo, {
    aguardarResposta: async (pedido) => ({ capturaId: pedido.capturaId, indice: 0 }),
  });
  assert.equal(esgotado.codigo, "TIMEOUT");
  assert.equal(prazo.chamadas.includes("PW_iPPAbort"), false);
  assert.equal(prazo.chamadas.filter((chamada) => chamada === "PW_iNewTransac").length, 1);
});

test("MOREDATA de chip offline continua com PW_iPPGoOnChip na mesma transação", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  const chamadas = [];
  const transporte = {
    async ppGetCard() {
      chamadas.push("PW_iPPGetCard");
      return 0;
    },
    async ppGoOnChip() {
      chamadas.push("PW_iPPGoOnChip");
      return 0;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: 0 };
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      const vez = chamadas.filter((item) => item === "PW_iExecTransac").length;
      if (vez === 1) {
        return {
          codigo: -2497,
          captura: [{ wIdentificador: 0, bTipoDeDado: 9, szPrompt: "PROCESSANDO", vszTextoMenu: [], vszValorMenu: [] }],
        };
      }
      return {
        codigo: -2497,
        captura: [{
          wIdentificador: 0x29,
          bTipoDeDado: 1,
          bNumOpcoesMenu: 1,
          szPrompt: "PRODUTO",
          vszTextoMenu: ["A vista"],
          vszValorMenu: ["1"],
        }],
      };
    },
    async newTransac() {
      chamadas.push("PW_iNewTransac");
      return 0;
    },
  };
  const sessao = modulo.criarSessaoContinua();
  sessao.viva = true;
  sessao.novas = 1;
  sessao.captura = { identificador: 0, tipo: 3, pinpad: true, prompt: "cartao", opcoes: [], valores: [] };
  sessao.transporte = transporte;
  const resultado = await modulo.continuarCapturasPinpad(sessao);
  assert.equal(chamadas.includes("PW_iPPGetCard"), true);
  assert.equal(chamadas.includes("PW_iPPGoOnChip"), true);
  assert.equal(chamadas.includes("PW_iNewTransac"), false);
  assert.equal(resultado.codigo, "captura");
  assert.equal(sessao.captura.pinpad, false);
  assert.equal(sessao.captura.valores[0], "1");
});
