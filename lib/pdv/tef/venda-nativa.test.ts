import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./motor";
import { encaixeFinalizacaoExistente, SessaoVendaNativa } from "./venda-nativa";
import { bibliotecaVendaNativa } from "../../../print-agent/src/tef-venda-nativa.mjs";
import { escreverMenuPwGetData } from "../../../print-agent/src/tef-getdata.mjs";
import { PWCNF, PWINFO, PWOPER, PWRET } from "../../../tef-2/fase-1/contrato.mjs";

const pedido = {
  vendaId: "venda-1",
  valorCentavos: 2590,
  idempotencyKey: "idem-venda-1",
  modalidade: "debito" as const,
};

function koffi() {
  return {
    struct() {
      return {};
    },
    array() {
      return "array";
    },
  };
}

function dll(roteiro = "aprovada") {
  const resultados = new Map<number, string>();
  let etapa = 0;
  let confirmacoes = 0;
  const funcoes = {
    operacoes: [] as number[],
    params: [] as Array<[number, string]>,
    confirmacoes: [] as number[],
    PW_iInit() {
      return 0;
    },
    PW_iSetEnvironment() {
      return 0;
    },
    PW_iNewTransac(operacao: number) {
      funcoes.operacoes.push(operacao);
      etapa = 0;
      return 0;
    },
    PW_iAddParam(info: number, valor: string) {
      funcoes.params.push([info, valor]);
      return 0;
    },
    PW_iExecTransac(capturas: Buffer, quantidade: number[]) {
      if (roteiro === "rede") return PWRET.TIMEOUT;
      if (etapa === 0) {
        etapa = 1;
        escreverMenuPwGetData(capturas, 0, {
          identificador: PWINFO.CURRENCY,
          prompt: "Modalidade",
          textos: ["A vista"],
          valores: ["1"],
        });
        quantidade[0] = 1;
        return PWRET.MOREDATA;
      }
      resultados.set(PWINFO.CNFREQ, "1");
      resultados.set(PWINFO.REQNUM, "1001");
      resultados.set(PWINFO.AUTLOCREF, "LOC-1");
      resultados.set(PWINFO.AUTEXTREF, "EXT-1");
      resultados.set(PWINFO.VIRTMERCH, "7711001");
      resultados.set(PWINFO.AUTHSYST, "SIMULADO");
      quantidade[0] = 0;
      return PWRET.OK;
    },
    PW_iGetResult(info: number, saida: Buffer) {
      saida.fill(0);
      const valor = resultados.get(info);
      if (valor) saida.write(valor, "latin1");
      return valor ? PWRET.OK : PWRET.NODATA;
    },
    PW_iConfirmation(status: number) {
      funcoes.confirmacoes.push(status);
      confirmacoes += 1;
      if (roteiro === "falha" && confirmacoes === 1) return PWRET.INVCALL;
      return PWRET.OK;
    },
    PW_iWaitConfirmation() {
      return PWRET.OK;
    },
  };
  return funcoes;
}

function sessao(pasta: string, transporte: ReturnType<typeof dll>, empresaId = "empresa-a", terminalCodigo = "caixa-1") {
  return new SessaoVendaNativa({
    autorizado: { empresaId, terminalCodigo, dispositivoId: "disp-1" },
    biblioteca: bibliotecaVendaNativa(transporte, { koffi: koffi() }),
    arquivoJournal: path.join(pasta, `${empresaId}-journal.json`),
    arquivoLivro: path.join(pasta, "livro.json"),
  });
}

async function autorizar(venda: SessaoVendaNativa, transporte: ReturnType<typeof dll>) {
  await venda.iniciar();
  const captura = await venda.vender(pedido);
  assert.equal(captura.situacao, "aguardando_captura");
  assert.equal(captura.pagamentoRecebido, false);
  assert.equal(transporte.operacoes[0], PWOPER.SALE);
  assert.equal(transporte.params.some((item) => item[0] === 0x7f01), false);
  assert.equal(transporte.params.some((item) => item[0] === 0x7f02), false);
  assert.equal(transporte.params.some((item) => item[0] === PWINFO.TOTAMNT && item[1] === "2590"), true);
  const autorizada = await venda.responder({
    solicitacaoId: captura.solicitacaoId,
    indice: 0,
    idempotencyKey: pedido.idempotencyKey,
  });
  assert.equal(autorizada.status, "autorizada");
  assert.equal(autorizada.pagamentoAprovado, false);
  assert.equal(autorizada.pagamentoRecebido, false);
  assert.equal(autorizada.registro?.nsu, "1001");
  assert.equal(autorizada.registro?.autorizacao, "LOC-1");
  assert.equal(autorizada.registro?.finalizacao, "EXT-1");
  assert.equal(autorizada.registro?.rede, "SIMULADO");
  assert.equal(encaixeFinalizacaoExistente(autorizada.registro), null);
  return autorizada;
}

test("autorização seguida de confirmação não marca o pagamento recebido", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-nativa-"));
  try {
    const transporte = dll();
    const venda = sessao(pasta, transporte);
    await autorizar(venda, transporte);
    const confirmada = await venda.confirmar(pedido.idempotencyKey);
    assert.equal(confirmada.status, "confirmada");
    assert.equal(confirmada.transacaoConfirmada, true);
    assert.equal(confirmada.pagamentoAprovado, false);
    assert.equal(confirmada.pagamentoRecebido, false);
    assert.equal(confirmada.registro?.nsu, "1001");
    assert.equal(encaixeFinalizacaoExistente(confirmada.registro), null);
    assert.equal(transporte.confirmacoes[0], PWCNF.CNF_MANU_AUT);
    assert.equal(transporte.operacoes.length, 1);
    assert.equal(ABI_COMPROVADO, false);
    assert.equal(LAYOUT_HOMOLOGADO, false);
    const fonte = readFileSync(fileURLToPath(new URL("./venda-nativa.ts", import.meta.url)), "utf8");
    assert.equal(fonte.includes("rpc_finalizar_venda"), false);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("falha depois da autorização, desfazimento e queda de rede preservam a conciliação", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-nativa-"));
  try {
    const falha = dll("falha");
    const venda = sessao(pasta, falha);
    await autorizar(venda, falha);
    const interrompida = await venda.confirmar(pedido.idempotencyKey);
    assert.equal(interrompida.ok, false);
    assert.equal(interrompida.status, "desfazimento_pendente");
    assert.equal(interrompida.pagamentoRecebido, false);
    assert.equal(interrompida.registro?.nsu, "1001");
    assert.equal(encaixeFinalizacaoExistente(interrompida.registro), null);

    const desfaz = dll();
    const outra = sessao(path.join(pasta, "desfaz"), desfaz);
    await autorizar(outra, desfaz);
    const desfeita = await outra.desfazer(pedido.idempotencyKey, "desfazer_manual");
    assert.equal(desfeita.status, "desfeita");
    assert.equal(desfeita.pagamentoRecebido, false);
    assert.equal(desfeita.registro?.nsu, "1001");
    assert.equal(desfaz.confirmacoes[0], PWCNF.REV_MANU_AUT);

    const rede = dll("rede");
    const queda = sessao(path.join(pasta, "rede"), rede);
    await queda.iniciar();
    const timeout = await queda.vender(pedido);
    assert.equal(timeout.status, "timeout");
    assert.equal(timeout.pagamentoRecebido, false);
    assert.equal(rede.confirmacoes.length, 0);
    assert.equal(rede.operacoes.length, 1);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("reinício recupera a autorização e outra empresa não confirma", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-nativa-"));
  try {
    const origem = dll();
    const venda = sessao(pasta, origem);
    await autorizar(venda, origem);
    const retomada = sessao(pasta, dll());
    await retomada.iniciar();
    const confirmada = await retomada.confirmar(pedido.idempotencyKey);
    assert.equal(confirmada.status, "confirmada");
    assert.equal(confirmada.registro?.nsu, "1001");
    assert.equal(confirmada.pagamentoRecebido, false);
    const outra = sessao(pasta, dll(), "empresa-b", "caixa-2");
    const invasao = await outra.confirmar(pedido.idempotencyKey);
    assert.equal(invasao.codigo, "EMPRESA_DIVERGENTE");
    assert.equal(invasao.registro, null);
    assert.equal(confirmada.registro?.status, "confirmada");
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("transação desconhecida, terminal ocupado e repetição não abrem outra venda", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-venda-nativa-"));
  try {
    const transporte = dll();
    const venda = sessao(pasta, transporte);
    await autorizar(venda, transporte);
    const antes = transporte.confirmacoes.length;
    const desconhecida = await venda.confirmar("idem-ausente");
    assert.equal(desconhecida.codigo, "TRANSACAO_DESCONHECIDA");
    assert.equal(desconhecida.status, "desconhecida");
    assert.equal(desconhecida.pagamentoRecebido, false);
    assert.equal(transporte.confirmacoes.length, antes);
    const ocupada = await venda.vender({ ...pedido, idempotencyKey: "idem-2", vendaId: "venda-2" });
    assert.equal(ocupada.codigo, "PENDENTE");
    assert.equal(ocupada.registro, null);
    assert.equal(transporte.operacoes.length, 1);
    const confirmada = await venda.confirmar(pedido.idempotencyKey);
    assert.equal(confirmada.status, "confirmada");
    const repetida = await venda.vender(pedido);
    assert.equal(repetida.repetida, true);
    assert.equal(repetida.registro?.nsu, "1001");
    assert.equal(repetida.pagamentoRecebido, false);
    assert.equal(transporte.operacoes.length, 1);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
