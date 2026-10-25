import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./motor";
import {
  aceiteNaFinalizacao,
  VendaPgwebPdv,
  type PedidoVendaPgweb,
} from "./venda-pgweb";
import { PWCNF, PWINFO, PWOPER, PWRET } from "../../../tef-2/fase-1/contrato.mjs";
import { criarSimuladorFase1 } from "../../../tef-2/fase-1/simulador.mjs";

const PAN = /\d{13,19}/;

const pedido: PedidoVendaPgweb = {
  vendaId: "venda-1",
  valorCentavos: 2590,
  idempotencyKey: "idem-venda-1",
  modalidade: "debito",
};

function observar(biblioteca: ReturnType<typeof criarSimuladorFase1>) {
  const addParam = biblioteca.addParam.bind(biblioteca);
  const novo = biblioteca.newTransac.bind(biblioteca);
  const observado = biblioteca as ReturnType<typeof criarSimuladorFase1> & {
    parametros: Array<[number, string]>;
    operacoes: number[];
  };
  observado.parametros = [];
  observado.operacoes = [];
  observado.addParam = async (info: number, valor: string) => {
    observado.parametros.push([info, valor]);
    return addParam(info, valor);
  };
  observado.newTransac = async (operacao: number) => {
    observado.operacoes.push(operacao);
    return novo(operacao);
  };
  return observado;
}

async function sessao(
  roteiro: string,
  arquivo: string,
  empresaId = "empresa-a",
  terminalCodigo = "caixa-1",
  biblioteca = observar(criarSimuladorFase1(roteiro))
) {
  const venda = new VendaPgwebPdv({
    autorizado: { empresaId, terminalCodigo, dispositivoId: "disp-1" },
    biblioteca,
    arquivo,
  });
  const inicio = await venda.iniciar();
  return { venda, biblioteca, inicio };
}

test("venda aprovada e confirmada fica vinculada sem aprovar o pagamento no PDV", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-pgweb-"));
  try {
    const { venda, biblioteca } = await sessao("aprovada", path.join(pasta, "journal.json"));
    const captura = await venda.vender(pedido);
    assert.equal(captura.pagamentoAprovado, false);
    assert.equal(captura.cobrancaReal, false);
    assert.equal(captura.situacao, "aguardando_captura");
    assert.match(captura.mensagem, /não está aprovado/);
    assert.equal(captura.mensagem.includes("Pagamento aprovado"), false);
    assert.equal(biblioteca.operacoes[0], PWOPER.SALE);
    assert.equal(
      biblioteca.parametros.some((item) => item[0] === PWINFO.TOTAMNT && item[1] === "2590"),
      true
    );
    const autorizada = await venda.responder({ solicitacaoId: captura.solicitacaoId, indice: 0 });
    assert.equal(autorizada.situacao, "autorizada");
    assert.equal(autorizada.transacaoConfirmada, false);
    assert.equal(autorizada.pagamentoAprovado, false);
    assert.equal(autorizada.vendaId, "venda-1");
    assert.equal(autorizada.valorCentavos, 2590);
    assert.equal(autorizada.conciliacao.reqNum, "1001");
    assert.equal(autorizada.conciliacao.locRef, "LOC-1");
    assert.equal(autorizada.conciliacao.extRef, "EXT-1");
    assert.equal(autorizada.conciliacao.authSyst, "SIMULADO");
    assert.match(autorizada.mensagem, /ainda não foi confirmada/);
    const confirmada = await venda.confirmar();
    assert.equal(confirmada.transacaoConfirmada, true);
    assert.equal(confirmada.pagamentoAprovado, false);
    assert.equal(confirmada.situacao, "confirmada");
    assert.equal(aceiteNaFinalizacao(confirmada), null);
    assert.match(confirmada.mensagem, /motor definitivo permanece bloqueado/);
    assert.equal(confirmada.mensagem.includes("Pagamento aprovado"), false);
    assert.equal(
      biblioteca.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iConfirmation"),
      true
    );
    assert.equal(PAN.test(JSON.stringify(confirmada)), false);
    assert.equal(ABI_COMPROVADO, false);
    assert.equal(LAYOUT_HOMOLOGADO, false);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("venda recusada, cancelamento e falha de comunicação não aprovam pagamento", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-pgweb-"));
  try {
    const recusada = await sessao("recusada", path.join(pasta, "recusada.json"));
    const recusa = await recusada.venda.vender(pedido);
    assert.equal(recusa.situacao, "recusada");
    assert.equal(recusa.pagamentoAprovado, false);
    assert.equal(recusa.transacaoConfirmada, false);
    assert.equal(
      recusada.biblioteca.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iConfirmation"),
      false
    );

    const cancelada = await sessao("aprovada", path.join(pasta, "cancelada.json"));
    const captura = await cancelada.venda.vender(pedido);
    const cancelamento = await cancelada.venda.responder({
      solicitacaoId: captura.solicitacaoId,
      cancelar: true,
    });
    assert.equal(cancelamento.situacao, "cancelada");
    assert.equal(cancelamento.codigo, PWRET.CANCEL);
    assert.equal(cancelamento.pagamentoAprovado, false);
    assert.equal(
      cancelada.biblioteca.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iConfirmation"),
      false
    );

    const biblioteca = observar(criarSimuladorFase1("aprovada"));
    biblioteca.execTransac = async () => {
      (biblioteca.chamadas as unknown[]).push("PW_iExecTransac");
      return { codigo: PWRET.PPCOMERR, quantidade: 0, captura: [] };
    };
    const falha = await sessao("aprovada", path.join(pasta, "falha.json"), "empresa-a", "caixa-1", biblioteca);
    const comunicacao = await falha.venda.vender(pedido);
    assert.equal(comunicacao.situacao, "falha_comunicacao");
    assert.equal(comunicacao.codigo, PWRET.PPCOMERR);
    assert.equal(comunicacao.pagamentoAprovado, false);
    assert.equal(comunicacao.transacaoConfirmada, false);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("queda antes da confirmação recupera, desfaz e bloqueia outra venda", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-pgweb-"));
  const arquivo = path.join(pasta, "journal.json");
  try {
    const origem = await sessao("queda", arquivo);
    const captura = await origem.venda.vender(pedido);
    const autorizada = await origem.venda.responder({ solicitacaoId: captura.solicitacaoId, indice: 0 });
    assert.equal(autorizada.situacao, "autorizada");
    assert.equal(autorizada.pagamentoAprovado, false);

    const retomada = await sessao("queda", arquivo);
    assert.equal(retomada.inicio.situacao, "pendente");
    assert.equal(retomada.inicio.conciliacao.reqNum, "1001");
    assert.equal(retomada.inicio.pagamentoAprovado, false);
    const repetida = await retomada.venda.vender({ ...pedido, idempotencyKey: "idem-outra" });
    assert.equal(repetida.codigo, "PENDENTE");
    assert.equal(retomada.biblioteca.operacoes.length, 0);
    const desfeita = await retomada.venda.desfazer("queda");
    assert.equal(desfeita.situacao, "desfeita");
    assert.equal(desfeita.pagamentoAprovado, false);
    assert.equal(desfeita.transacaoConfirmada, false);
    assert.equal(
      retomada.biblioteca.chamadas.some(
        (item) => Array.isArray(item) && item[0] === "PW_iConfirmation" && item[1] === PWCNF.REV_PWR_AUT
      ),
      true
    );
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("transação pendente é confirmada na recuperação e a mesma chave não cobra de novo", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-pgweb-"));
  const arquivo = path.join(pasta, "journal.json");
  try {
    const origem = await sessao("queda", arquivo);
    const captura = await origem.venda.vender(pedido);
    await origem.venda.responder({ solicitacaoId: captura.solicitacaoId, indice: 0 });
    const retomada = await sessao("queda", arquivo);
    const confirmada = await retomada.venda.confirmar();
    assert.equal(confirmada.transacaoConfirmada, true);
    assert.equal(confirmada.pagamentoAprovado, false);
    assert.equal(aceiteNaFinalizacao(confirmada), null);
    const deNovo = await retomada.venda.vender(pedido);
    assert.equal(deNovo.repetida, true);
    assert.equal(deNovo.pagamentoAprovado, false);
    assert.match(deNovo.mensagem, /Nenhuma nova cobrança/);
    assert.equal(retomada.biblioteca.operacoes.length, 0);
    const gravado = await readFile(arquivo, "utf8");
    assert.equal(gravado.includes("4111111111111111"), false);
    assert.equal(gravado.includes("idem-venda-1"), true);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("duplo clique ocupa a sessão e não abre outra PWOPER_SALE", async () => {
  const biblioteca = observar(criarSimuladorFase1("timeout"));
  let soltar: (valor?: unknown) => void = () => {};
  (biblioteca as { espera: Promise<unknown> | null }).espera = new Promise((resolver) => {
    soltar = resolver;
  });
  const venda = new VendaPgwebPdv({
    autorizado: { empresaId: "empresa-a", terminalCodigo: "caixa-1", dispositivoId: "disp-1" },
    biblioteca,
  });
  await venda.iniciar();
  const primeira = venda.vender(pedido);
  await new Promise((resolver) => setImmediate(resolver));
  const segunda = await venda.vender(pedido);
  assert.equal(segunda.codigo, "OCUPADO");
  assert.equal(segunda.pagamentoAprovado, false);
  assert.match(segunda.mensagem, /segunda solicitação não iniciou/);
  assert.equal(biblioteca.operacoes.length, 1);
  soltar();
  const encerrou = await primeira;
  assert.equal(encerrou.situacao, "falha_comunicacao");
  assert.equal(encerrou.pagamentoAprovado, false);
});

test("duas empresas no mesmo computador não compartilham a transação pendente", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-pgweb-"));
  const arquivo = path.join(pasta, "journal.json");
  try {
    const empresaA = await sessao("queda", arquivo, "empresa-a", "caixa-1");
    const captura = await empresaA.venda.vender(pedido);
    await empresaA.venda.responder({ solicitacaoId: captura.solicitacaoId, indice: 0 });
    const antes = await readFile(arquivo, "utf8");
    const empresaB = await sessao("queda", arquivo, "empresa-b", "caixa-2");
    assert.equal(empresaB.inicio.codigo, "EMPRESA_DIVERGENTE");
    assert.equal(empresaB.inicio.conciliacao.reqNum, "");
    assert.equal(empresaB.inicio.vendaId, "");
    const vendaB = await empresaB.venda.vender({ ...pedido, vendaId: "venda-b", idempotencyKey: "idem-b" });
    assert.equal(vendaB.codigo, "EMPRESA_DIVERGENTE");
    assert.equal(vendaB.pagamentoAprovado, false);
    assert.equal(empresaB.biblioteca.operacoes.length, 0);
    const confirmacaoB = await empresaB.venda.confirmar();
    assert.equal(confirmacaoB.codigo, "EMPRESA_DIVERGENTE");
    assert.equal(
      empresaB.biblioteca.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iConfirmation"),
      false
    );
    assert.equal(await readFile(arquivo, "utf8"), antes);
    const confirmacaoA = await empresaA.venda.confirmar();
    assert.equal(confirmacaoA.transacaoConfirmada, true);
    assert.equal(confirmacaoA.empresaId, "empresa-a");
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("PinPad ocupado não inicia PWOPER_SALE e a DLL real continua bloqueada", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-pgweb-"));
  try {
    const { venda, biblioteca } = await sessao("aprovada", path.join(pasta, "journal.json"));
    const ocupado = await venda.vender({ ...pedido, pinpadOcupado: true });
    assert.equal(ocupado.codigo, "PINPAD_OCUPADO");
    assert.equal(ocupado.pagamentoAprovado, false);
    assert.equal(ocupado.transacaoConfirmada, false);
    assert.match(ocupado.mensagem, /PinPad está ocupado/);
    assert.equal(biblioteca.operacoes.length, 0);
    assert.throws(
      () =>
        new VendaPgwebPdv({
          autorizado: { empresaId: "empresa-a", terminalCodigo: "caixa-1", dispositivoId: "disp-1" },
          biblioteca: { real: true },
        }),
      /PGWebLib/
    );
    const fluxo = await readFile(
      fileURLToPath(new URL("./fluxo-cliente.ts", import.meta.url)),
      "utf8"
    );
    assert.ok(fluxo.indexOf("cobrancaRealBloqueada") < fluxo.indexOf("decidirInicializacaoPascal"));
    assert.equal(fluxo.includes("/tef/inicializar"), false);
    assert.equal(fluxo.includes("venda-pgweb"), false);
    const versao = JSON.parse(
      await readFile(fileURLToPath(new URL("../../../print-agent/version.json", import.meta.url)), "utf8")
    );
    assert.equal(versao.version, "1.3.40");
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
