import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  atenderMenuConector,
  avaliarJournalMenu,
  esquecerMenuConector,
  FRASE_MENU_CONECTOR,
  recuperarSessaoAbertaSemExecucao,
  seguirCapturaPinpad,
  sessaoVendaEmMemoria,
} from "./tef-menu-conector.mjs";
import { PWINFO, PWRET } from "./tef-pgweb.mjs";
import {
  continuarCapturasPinpad,
  criarSessaoContinua,
  retomavelPorJournal,
  transacaoResidenteAtiva,
} from "./tef-teste-nativo-homologacao.mjs";

function nomes(chamadas) {
  return chamadas.map((item) => (Array.isArray(item) ? item[0] : item));
}

function sessaoChip(transporte, tipo) {
  const sessao = criarSessaoContinua();
  sessao.viva = true;
  sessao.novas = 1;
  sessao.capturaId = 1;
  sessao.captura = {
    identificador: 0,
    tipo,
    pinpad: true,
    prompt: tipo === 9 ? "PROCESSANDO" : "cartao",
    opcoes: [],
    valores: [],
  };
  sessao.transporte = transporte;
  return sessao;
}

test("PWDAT_CARDINF segue para PWDAT_CARDOFF com GoOnChip, EventLoop e a mesma ExecTransac", async () => {
  const chamadas = [];
  let execucoes = 0;
  const transporte = {
    async ppGetCard(indice) {
      chamadas.push(["PW_iPPGetCard", indice]);
      return 0;
    },
    async ppGoOnChip(indice) {
      chamadas.push(["PW_iPPGoOnChip", indice]);
      return 0;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: PWRET.OK };
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      execucoes += 1;
      if (execucoes === 1) {
        return {
          codigo: PWRET.MOREDATA,
          captura: [{ wIdentificador: 0, bTipoDeDado: 9, szPrompt: "PROCESSANDO", vszTextoMenu: [], vszValorMenu: [] }],
        };
      }
      return {
        codigo: PWRET.MOREDATA,
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
    async confirmation() {
      chamadas.push("PW_iConfirmation");
      return 0;
    },
    async ppAbort() {
      chamadas.push("PW_iPPAbort");
      return 0;
    },
  };
  const resultado = await continuarCapturasPinpad(sessaoChip(transporte, 3));
  const ordem = nomes(chamadas);
  assert.deepEqual(ordem, [
    "PW_iPPGetCard",
    "PW_iPPEventLoop",
    "PW_iExecTransac",
    "PW_iPPGoOnChip",
    "PW_iPPEventLoop",
    "PW_iExecTransac",
  ]);
  assert.deepEqual(chamadas[0], ["PW_iPPGetCard", 0]);
  assert.deepEqual(chamadas[3], ["PW_iPPGoOnChip", 0]);
  assert.equal(ordem.includes("PW_iNewTransac"), false);
  assert.equal(ordem.includes("PW_iConfirmation"), false);
  assert.equal(ordem.includes("PW_iPPAbort"), false);
  assert.equal(resultado.codigo, "captura");
  assert.equal(resultado.solicitacao.tipo, 1);
  assert.equal(resultado.solicitacao.valores[0], "1");
  assert.equal(resultado.pagamentoRecebido, false);
});

test("cancelamento durante o chip encerra a transação com ExecTransac CANCEL e sem confirmação", async () => {
  const chamadas = [];
  const transporte = {
    async ppGoOnChip(indice) {
      chamadas.push(["PW_iPPGoOnChip", indice]);
      return 0;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: PWRET.CANCEL };
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      return { codigo: PWRET.CANCEL };
    },
    async newTransac() {
      chamadas.push("PW_iNewTransac");
      return 0;
    },
    async confirmation() {
      chamadas.push("PW_iConfirmation");
      return 0;
    },
    async ppAbort() {
      chamadas.push("PW_iPPAbort");
      return 0;
    },
  };
  const resultado = await continuarCapturasPinpad(sessaoChip(transporte, 9));
  assert.deepEqual(nomes(chamadas), ["PW_iPPGoOnChip", "PW_iPPEventLoop", "PW_iExecTransac"]);
  assert.equal(resultado.codigo, "transacao_cancelada");
  assert.equal(resultado.retornoExec, PWRET.CANCEL);
  assert.equal(resultado.evento, PWRET.CANCEL);
  assert.equal(resultado.transacaoEncerrada, true);
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.confirmacaoChamada, false);
  assert.equal(chamadas.includes("PW_iPPAbort"), false);
  assert.equal(chamadas.includes("PW_iNewTransac"), false);
  assert.equal(chamadas.includes("PW_iConfirmation"), false);
});

test("retorno desconhecido do chip preserva a captura e não confirma nem abre outra transação", async () => {
  const chamadas = [];
  const sessao = sessaoChip({
    async ppGoOnChip() {
      chamadas.push("PW_iPPGoOnChip");
      return 0;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: PWRET.INVPARAM };
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      return { codigo: PWRET.OK };
    },
    async newTransac() {
      chamadas.push("PW_iNewTransac");
      return 0;
    },
    async confirmation() {
      chamadas.push("PW_iConfirmation");
      return 0;
    },
    async ppAbort() {
      chamadas.push("PW_iPPAbort");
      return 0;
    },
  }, 9);
  const resultado = await continuarCapturasPinpad(sessao);
  assert.deepEqual(chamadas, ["PW_iPPGoOnChip", "PW_iPPEventLoop"]);
  assert.equal(resultado.codigo, "PINPAD");
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.confirmacaoChamada, false);
  assert.equal(transacaoResidenteAtiva(sessao), true);
  assert.equal(sessao.captura.tipo, 9);
});

test("reinício durante a captura não retoma o chip nem libera o journal sem prova", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-chip-reinicio-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const journal = {
    versao: 1,
    status: "execucao_iniciada",
    identificador: "captura-chip-reinicio",
    correlationId: "captura-chip-reinicio",
    valor: 100,
    dataHoraInicio: "2026-10-21T12:35:50.239Z",
    etapa: "PW_iExecTransac",
    retornoNewTransac: 0,
    retornoExec: PWRET.MOREDATA,
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    perfil: "conector-homologacao",
    operacao: "PWOPER_SALE",
  };
  await writeFile(arquivo, `${JSON.stringify(journal)}\n`);
  const avaliacao = await avaliarJournalMenu([arquivo]);
  assert.equal(avaliacao.seguir, false);
  assert.equal(retomavelPorJournal(), false);
  assert.equal(sessaoVendaEmMemoria("empresa-reinicio", "caixa-reinicio").ativa, false);
  const chamadas = [];
  const recuperacao = await recuperarSessaoAbertaSemExecucao({
    journal,
    arquivo,
    empresaId: "empresa-reinicio",
    terminalCodigo: "caixa-reinicio",
    transporte: {
      async getResult(info) {
        chamadas.push(["PW_iGetResult", info]);
        return { codigo: PWRET.TRNNOTINIT, valor: "" };
      },
      async ppGoOnChip() {
        chamadas.push("PW_iPPGoOnChip");
        return 0;
      },
      async ppAbort() {
        chamadas.push("PW_iPPAbort");
        return 0;
      },
      async newTransac() {
        chamadas.push("PW_iNewTransac");
        return 0;
      },
      async confirmation() {
        chamadas.push("PW_iConfirmation");
        return 0;
      },
    },
  });
  assert.equal(recuperacao.ok, false);
  assert.equal(recuperacao.novaCobranca, false);
  assert.equal(recuperacao.confirmacaoChamada, false);
  assert.equal(recuperacao.journalApagado, false);
  assert.deepEqual(nomes(chamadas), ["PW_iGetResult"]);
  assert.equal(chamadas[0][1], PWINFO.SERVERPND);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).status, "execucao_iniciada");
});

test("um F2 conduz o chip e a repetição conserva a mesma transação", async () => {
  esquecerMenuConector();
  const chamadas = [];
  let etapa = 0;
  const transporte = {
    novas: 0,
    async newTransac() {
      chamadas.push("PW_iNewTransac");
      transporte.novas += 1;
      return 0;
    },
    async addParam() {
      chamadas.push("PW_iAddParam");
      return 0;
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      etapa += 1;
      if (etapa === 1) {
        return {
          codigo: PWRET.MOREDATA,
          captura: [{ wIdentificador: 0, bTipoDeDado: 3, szPrompt: "cartao", vszTextoMenu: [], vszValorMenu: [] }],
        };
      }
      if (etapa === 2) {
        return {
          codigo: PWRET.MOREDATA,
          captura: [{ wIdentificador: 0, bTipoDeDado: 9, szPrompt: "PROCESSANDO", vszTextoMenu: [], vszValorMenu: [] }],
        };
      }
      return {
        codigo: PWRET.MOREDATA,
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
    async ppGetCard(indice) {
      chamadas.push(["PW_iPPGetCard", indice]);
      return 0;
    },
    async ppGoOnChip(indice) {
      chamadas.push(["PW_iPPGoOnChip", indice]);
      return 0;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: PWRET.OK };
    },
    async confirmation() {
      chamadas.push("PW_iConfirmation");
      return 0;
    },
  };
  const pedido = {
    ambiente: "homologacao",
    empresaId: "empresa-chip",
    terminalCodigo: "caixa-chip",
    frase: FRASE_MENU_CONECTOR,
    journal: { seguir: true },
    simulacao: true,
    transporte,
  };
  const aberto = await atenderMenuConector({ ...pedido, acao: "iniciar" });
  assert.equal(aberto.fase, "pinpad");
  assert.equal(aberto.novas, 1);
  const seguida = await seguirCapturaPinpad("empresa-chip", "caixa-chip");
  assert.equal(seguida.fase, "menu");
  assert.equal(seguida.menu.opcoes[0].valor, "1");
  assert.equal(seguida.novaCobranca, false);
  assert.equal(seguida.pagamentoRecebido, false);
  assert.equal(chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(chamadas.includes("PW_iConfirmation"), false);
  assert.ok(nomes(chamadas).indexOf("PW_iPPGetCard") < nomes(chamadas).indexOf("PW_iPPGoOnChip"));
  const repetida = await atenderMenuConector({
    ...pedido,
    acao: "iniciar",
    transporte: { async newTransac() { chamadas.push("PW_iNewTransac"); return 0; } },
  });
  assert.equal(repetida.novas, 1);
  assert.equal(chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(await seguirCapturaPinpad("empresa-chip", "caixa-chip"), null);
  const memoria = sessaoVendaEmMemoria("empresa-chip", "caixa-chip");
  assert.equal(memoria.ativa, true);
  assert.equal(memoria.pinpad, false);
  assert.equal(memoria.novas, 1);
  const servidor = await readFile(new URL("./server.mjs", import.meta.url), "utf8");
  const venda = servidor.slice(servidor.indexOf('url.pathname === "/tef/venda"'));
  const memoriaFonte = venda.indexOf("sessaoVendaEmMemoria(");
  const recuperacao = venda.indexOf("recuperarSessaoAbertaSemExecucao(");
  const nova = venda.indexOf("executarTransacaoHomologacao(");
  assert.ok(memoriaFonte > 0 && memoriaFonte < recuperacao && memoriaFonte < nova);
  esquecerMenuConector();
});
