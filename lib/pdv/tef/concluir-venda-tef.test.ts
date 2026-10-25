import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ambienteServidor,
  avaliarConclusaoTefF2,
  concluirParcelasTef,
  evidenciaAtual,
  impedeFechamentoPagamento,
  liberacaoConformeDocumentacao,
  posidDoAmbiente,
  type EvidenciaExecucaoTef,
  type TransporteConclusaoTef,
} from "./concluir-venda-tef";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, PGWEB2_PRODUCAO } from "./motor";

const evidenciaLiberada: EvidenciaExecucaoTef = {
  abi: true,
  layout: true,
  producaoLiberada: false,
  abortComprovado: true,
  eventoComprovado: true,
  confirmacaoComprovada: true,
  esperaConfirmacaoComprovada: true,
};

const evidenciaProducao: EvidenciaExecucaoTef = { ...evidenciaLiberada, producaoLiberada: true };

function transporte(roteiro: {
  codigo?: number;
  falha?: "inicio" | "execucao" | "confirmacao";
  instrucao?: string;
  menu?: string[];
  refs?: Partial<Record<number, string>>;
  recusaComprovada?: boolean;
  simulado?: boolean;
}) {
  const chamadas: string[] = [];
  const params: Array<[number, string]> = [];
  const refs: Record<number, string> = {
    0x32: "11",
    0x44: "22",
    0x45: "33",
    0x36: "44",
    0x35: "SETIS",
    ...roteiro.refs,
  };
  const biblioteca: TransporteConclusaoTef = {
    simulado: roteiro.simulado === true,
    async newTransac() {
      chamadas.push("PW_iNewTransac");
      if (roteiro.falha === "inicio") throw new Error("queda");
      return 0;
    },
    async addParam(info, valor) {
      chamadas.push("PW_iAddParam");
      params.push([info, valor]);
      return 0;
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      if (roteiro.falha === "execucao") throw new Error("queda");
      return {
        codigo: roteiro.codigo ?? 0,
        instrucao: roteiro.instrucao,
        menu: roteiro.menu,
        recusaComprovada: roteiro.recusaComprovada,
      };
    },
    async ppAbort() {
      chamadas.push("PW_iPPAbort");
      return 0;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: -2491 };
    },
    async getResult(info) {
      chamadas.push("PW_iGetResult");
      return { valor: refs[info] ?? "" };
    },
    async confirmation() {
      chamadas.push("PW_iConfirmation");
      if (roteiro.falha === "confirmacao") return -2490;
      return 0;
    },
    async waitConfirmation() {
      chamadas.push("PW_iWaitConfirmation");
      return 0;
    },
  };
  return { biblioteca, chamadas, params };
}

const parcela = {
  formaPagamentoId: "debito",
  modalidade: "debito" as const,
  valorCentavos: 2590,
  idempotencyKey: "f2-debito",
};

test("a evidência real mantém a cobrança do F2 fechada", async () => {
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, true);
  const liberacao = liberacaoConformeDocumentacao("producao");
  assert.equal(liberacao.cobrancaRealBloqueada, true);
  assert.equal(liberacao.ativacaoExplicita, false);
  assert.equal(liberacaoConformeDocumentacao("homologacao").ativacaoExplicita, false);
  const atual = evidenciaAtual();
  assert.equal(atual.abi, true);
  assert.equal(atual.layout, true);
  assert.equal(atual.producaoLiberada, true);
  const producaoAtual = avaliarConclusaoTefF2({ ambiente: "producao" });
  assert.equal(producaoAtual.podeCobrar, true);
  assert.equal(producaoAtual.mensagem, "");
  const bloqueio = avaliarConclusaoTefF2({ ambiente: "homologacao" });
  assert.equal(bloqueio.podeCobrar, true);
  assert.equal(bloqueio.mensagem.includes("PWL_Type.h"), false);
  assert.equal(atual.abortComprovado, true);
  assert.equal(atual.eventoComprovado, true);
  assert.equal(atual.confirmacaoComprovada, true);
  assert.equal(atual.esperaConfirmacaoComprovada, true);
  assert.equal(bloqueio.cartaoManual, false);
  const producao = avaliarConclusaoTefF2({ ambiente: "producao", evidencia: evidenciaLiberada });
  assert.equal(producao.podeCobrar, false);
  assert.match(producao.mensagem, /ponto de captura/);
  const { biblioteca, chamadas } = transporte({});
  const resultado = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    parcelas: [parcela],
    transporte: biblioteca,
  });
  assert.equal(resultado.comandoEnviado, true);
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.podeFinalizar, false);
  assert.equal(resultado.fiscal.emitirNfce, false);
  assert.equal(chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(chamadas.includes("PW_iConfirmation"), true);
  assert.equal(chamadas.includes("PW_iWaitConfirmation"), true);
  const divergente = transporte({});
  const parado = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: { ...evidenciaLiberada, abi: false, layout: false },
    parcelas: [{ ...parcela, idempotencyKey: "f2-contrato" }],
    transporte: divergente.biblioteca,
  });
  assert.equal(parado.comandoEnviado, false);
  assert.deepEqual(divergente.chamadas, []);
});

test("débito, crédito parcelado e pagamento misto confirmam cada valor uma vez", async () => {
  const debito = transporte({ instrucao: "Insira ou aproxime o cartão." });
  const vendaDebito = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    parcelas: [parcela],
    transporte: debito.biblioteca,
  });
  assert.equal(vendaDebito.operacoes[0]?.estado, "confirmada");
  assert.equal(vendaDebito.pagamentoRecebido, false);
  assert.equal(vendaDebito.fiscal.emitirNfce, false);
  assert.equal(vendaDebito.posid, "ponto_homologacao");
  assert.deepEqual(vendaDebito.instrucoes, ["Insira ou aproxime o cartão."]);
  assert.equal(debito.params.some((item) => item[0] === 0x23 && item[1] === "2590"), true);
  assert.equal(debito.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(debito.chamadas.includes("PW_iConfirmation"), true);
  assert.equal(debito.chamadas.includes("PW_iWaitConfirmation"), true);

  const credito = transporte({ menu: ["À vista", "Parcelado"] });
  const vendaCredito = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    parcelas: [{ ...parcela, formaPagamentoId: "credito", modalidade: "credito", valorCentavos: 9000, idempotencyKey: "f2-credito", parcelasCredito: 3 }],
    transporte: credito.biblioteca,
  });
  assert.equal(vendaCredito.operacoes[0]?.modalidade, "credito");
  assert.equal(credito.params.some((item) => item[0] === 0x24 && item[1] === "3"), true);
  assert.equal(credito.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);

  const misto = transporte({});
  const memoria = new Map();
  const vendaMista = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    memoria,
    parcelas: [
      { ...parcela, valorCentavos: 1000, idempotencyKey: "misto-cartao" },
      { formaPagamentoId: "dinheiro", modalidade: null, valorCentavos: 500, idempotencyKey: "misto-dinheiro" },
    ],
    transporte: misto.biblioteca,
  });
  assert.equal(vendaMista.operacoes.length, 1);
  assert.equal(vendaMista.operacoes[0]?.valorCentavos, 1000);
  const deNovo = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    memoria,
    parcelas: [{ ...parcela, valorCentavos: 1000, idempotencyKey: "misto-cartao" }],
    transporte: misto.biblioteca,
  });
  assert.equal(misto.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(deNovo.operacoes[0]?.estado, "confirmada");
});

test("recusa, cancelamento, timeout, queda e confirmação falha não recebem pagamento", async () => {
  const recusa = transporte({ codigo: -2598 });
  const recusada = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    parcelas: [parcela],
    transporte: recusa.biblioteca,
  });
  assert.equal(recusada.estado, "recusada");
  assert.equal(recusada.pagamentoRecebido, false);
  assert.equal(recusa.chamadas.includes("PW_iConfirmation"), false);

  const cancelamento = transporte({});
  const cancelada = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    parcelas: [{ ...parcela, idempotencyKey: "f2-cancelar" }],
    transporte: cancelamento.biblioteca,
    cancelar: true,
  });
  assert.equal(cancelada.estado, "cancelada");
  assert.equal(cancelamento.chamadas.includes("PW_iPPAbort"), true);
  assert.equal(cancelamento.chamadas.includes("PW_iPPEventLoop"), true);
  assert.equal(cancelada.pagamentoRecebido, false);

  const timeout = transporte({ codigo: -2490 });
  const memoria = new Map();
  const expirada = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    memoria,
    parcelas: [{ ...parcela, idempotencyKey: "f2-timeout" }],
    transporte: timeout.biblioteca,
  });
  assert.equal(expirada.estado, "resultado_desconhecido");
  assert.equal(expirada.fiscal.concluirVenda, false);
  assert.equal(expirada.cobrarDeNovo, false);
  const repetida = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    memoria,
    parcelas: [{ ...parcela, idempotencyKey: "f2-timeout" }],
    transporte: transporte({}).biblioteca,
  });
  assert.equal(repetida.comandoEnviado, false);
  assert.match(repetida.mensagem, /pendente/);

  const queda = transporte({ falha: "execucao" });
  const caiu = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    parcelas: [{ ...parcela, idempotencyKey: "f2-queda" }],
    transporte: queda.biblioteca,
  });
  assert.equal(caiu.estado, "resultado_desconhecido");
  assert.equal(caiu.operacoes[0]?.journalApagado, false);
  assert.equal(caiu.cartaoManual, false);

  const semConfirmacao = transporte({ falha: "confirmacao" });
  const pendente = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    parcelas: [{ ...parcela, idempotencyKey: "f2-confirma" }],
    transporte: semConfirmacao.biblioteca,
  });
  assert.equal(pendente.estado, "resultado_desconhecido");
  assert.equal(pendente.pagamentoRecebido, false);
  assert.equal(semConfirmacao.chamadas.includes("PW_iWaitConfirmation"), false);
});

test("o segundo F2 não abre outra transação e a produção sem liberação não cobra", async () => {
  let liberar: () => void = () => {};
  const espera = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  const base = transporte({});
  const biblioteca = base.biblioteca;
  let inicios = 0;
  const original = biblioteca.newTransac;
  biblioteca.newTransac = async () => {
    inicios += 1;
    await espera;
    return original();
  };
  const memoria = new Map();
  const primeira = concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    memoria,
    parcelas: [parcela],
    transporte: biblioteca,
  });
  await new Promise((resolver) => setImmediate(resolver));
  const segunda = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "homologacao",
    evidencia: evidenciaLiberada,
    memoria,
    parcelas: [parcela],
    transporte: biblioteca,
  });
  assert.match(segunda.mensagem, /repetição não iniciou/);
  assert.equal(inicios, 1);
  liberar();
  await primeira;

  const producao = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "producao",
    ambienteNavegador: "homologacao",
    evidencia: evidenciaProducao,
    parcelas: [parcela],
    transporte: transporte({}).biblioteca,
  });
  assert.equal(producao.comandoEnviado, false);
  assert.match(producao.mensagem, /navegador não escolhe/);
  assert.equal(posidDoAmbiente("producao"), "ponto_captura");
  assert.equal(posidDoAmbiente("homologacao"), "ponto_homologacao");
});

test("produção liberada emite NFC-e e a falha fiscal preserva a referência", async () => {
  const sucesso = transporte({ simulado: false });
  const nota = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "producao",
    evidencia: evidenciaProducao,
    parcelas: [parcela],
    transporte: sucesso.biblioteca,
    fiscal: async () => ({ ok: true }),
  });
  assert.equal(nota.pagamentoRecebido, true);
  assert.equal(nota.fiscal.emitirNfce, true);
  assert.equal(nota.fiscal.baixarEstoque, true);
  assert.equal(nota.posid, "ponto_captura");

  const falha = transporte({ simulado: false });
  const preservada = await concluirParcelasTef({
    empresaId: "empresa-a",
    ambienteServidor: "producao",
    evidencia: evidenciaProducao,
    parcelas: [{ ...parcela, idempotencyKey: "f2-fiscal" }],
    transporte: falha.biblioteca,
    fiscal: async () => ({ ok: false }),
  });
  assert.equal(preservada.pagamentoRecebido, true);
  assert.equal(preservada.fiscal.emitirNfce, false);
  assert.equal(preservada.fiscal.preservarRecuperacao, true);
  assert.equal(preservada.fiscal.cobrarDeNovo, false);
  assert.equal(preservada.operacoes[0]?.estado, "confirmada");
  assert.equal(impedeFechamentoPagamento("aguardando_confirmacao"), true);
  assert.equal(impedeFechamentoPagamento("confirmada"), false);
  assert.equal(ambienteServidor({ servidor: "homologacao", navegador: "producao" }).ok, false);
});

test("o F2 comercial consulta a evidência real e não usa o menu de teste", () => {
  const raiz = path.resolve(import.meta.dirname, "../../..");
  const shell = readFileSync(path.join(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  const motor = readFileSync(path.join(raiz, "lib/pdv/tef/motor.ts"), "utf8");
  const conector = readFileSync(path.join(raiz, "print-agent/src/tef-pgweb.mjs"), "utf8");
  assert.match(shell, /avaliarConclusaoTefF2/);
  assert.match(shell, /evidenciaAtual\(\)/);
  assert.equal(shell.includes("<TefMenuHomologacao"), false);
  assert.match(shell, /A cobrança TEF foi desativada/);
  assert.equal(shell.slice(shell.indexOf("function concluirVenda("), shell.indexOf("finalizarVendaPdv(")).includes("TefMenuHomologacao"), false);
  assert.equal(shell.includes("function concluirVenda("), true);
  assert.equal(shell.includes("function finalizar()"), false);
  assert.equal(shell.includes("onClick={concluirVenda}"), true);
  assert.match(shell, /onClick=\{\(\) => concluirAtalhoTef\(formaCreditoTef\.id\)\}/);
  const tecla = shell.slice(shell.indexOf('event.key === "F2"'));
  assert.match(tecla, /concluirVenda\(\)/);
  const conclusao = shell.slice(shell.indexOf("function concluirVenda("), shell.indexOf("finalizarVendaPdv("));
  const bloqueio = conclusao.indexOf("if (!conclusaoTef.podeCobrar)");
  const pinpad = conclusao.indexOf("executarVendaPinpad");
  assert.ok(bloqueio > 0);
  assert.ok(pinpad > bloqueio);
  assert.match(conclusao.slice(bloqueio, pinpad), /return/);
  assert.match(conclusao, /tefLockRef\.current/);
  assert.match(motor, /PGWEB2_PRODUCAO = true/);
  assert.match(conector, /PGWEB2_PRODUCAO = true/);
  assert.match(motor, /ABI_COMPROVADO = false/);
  assert.match(motor, /LAYOUT_HOMOLOGADO = false/);
});
