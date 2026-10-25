import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { accessSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditarTiposSdk,
  avaliarCapacidadeComprovacao,
  avaliarComprovacaoFisica,
  coletarRetornosComprovacao,
  FRASE_COMPROVACAO_FISICA,
  persistirEvidenciaComprovacao,
  VALOR_MAXIMO_COMPROVACAO_CENTAVOS,
} from "./tef-comprovacao-fisica.mjs";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, PGWEB2_PRODUCAO, PWRET } from "./tef-pgweb.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dispositivo = "33333333-3333-4333-8333-333333333333";

function biblioteca(extras = {}) {
  const chamadas = [];
  return {
    chamadas,
    residente: true,
    homologacao: true,
    origem: "conector",
    async ppAbort() {
      chamadas.push("PW_iPPAbort");
      return extras.abort ?? PWRET.OK;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: extras.evento ?? PWRET.CANCEL, display: "cancelado" };
    },
    async confirmation(status, refs) {
      chamadas.push(["PW_iConfirmation", status, refs]);
      return extras.confirmacao ?? PWRET.OK;
    },
    async waitConfirmation() {
      chamadas.push("PW_iWaitConfirmation");
      return extras.espera ?? PWRET.OK;
    },
  };
}

function pedido(extra = {}) {
  return {
    ambiente: "homologacao",
    frase: FRASE_COMPROVACAO_FISICA,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
    dispositivoId: dispositivo,
    posid: "ponto-lab",
    valorCentavos: VALOR_MAXIMO_COMPROVACAO_CENTAVOS,
    biblioteca: biblioteca(),
    com7Exclusiva: true,
    portaPinpadOcupada: false,
    journal: { seguir: true },
    ...extra,
  };
}

test("o kit não traz PWL_Type.h e o header Linux não comprova o ABI Windows", () => {
  assert.throws(() => accessSync(path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924/PWL_Type.h")));
  assert.throws(() => accessSync(path.join(raiz, "tef-2/headers-referencia/PWL_Type.h")));
  const headerLinux = "Plataforma Linux\nunsigned long Uint32";
  const auditoria = auditarTiposSdk({ kitPresente: false, headerLinux });
  assert.equal(auditoria.headerLinuxOficial, true);
  assert.equal(auditoria.headerLinuxUsadoComoProva, false);
  assert.equal(auditoria.documentacaoOficialComprovaAbi, false);
  assert.equal(auditoria.compativelComDllWindows, false);
  assert.equal(auditoria.abiComprovado, false);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, false);
});

test("a comprovação física não exige layout e recusa produção, valor e sessão incompleta", () => {
  const valida = avaliarComprovacaoFisica(pedido());
  assert.equal(valida.ok, true);
  assert.equal(valida.layoutExigido, false);
  assert.equal(valida.pagamentoRecebido, false);
  assert.equal(valida.podeFinalizar, false);
  assert.equal(valida.nfcEEmitida, false);
  assert.equal(avaliarComprovacaoFisica(pedido({ ambiente: "producao" })).falhas.includes("producao"), true);
  assert.equal(avaliarComprovacaoFisica(pedido({ valorCentavos: 101 })).falhas.includes("valor"), true);
  assert.equal(avaliarComprovacaoFisica(pedido({ frase: "outra" })).falhas.includes("autorizacao"), true);
  assert.equal(avaliarComprovacaoFisica(pedido({ biblioteca: { homologacao: true } })).falhas.includes("sessao"), true);
  assert.equal(avaliarComprovacaoFisica(pedido({ evidenciaExistente: { encerrado: false } })).falhas.includes("recuperacao"), true);
});

test("sem execução explícita nenhuma função nativa é chamada", async () => {
  const lib = biblioteca();
  const resultado = await coletarRetornosComprovacao(pedido({ biblioteca: lib, executar: false }));
  assert.equal(resultado.executado, false);
  assert.deepEqual(lib.chamadas, []);
  assert.equal(resultado.pagamentoRecebido, false);
});

test("retornos simulados e referências do payload não habilitam flags", async () => {
  const lib = biblioteca();
  const semCaptura = await coletarRetornosComprovacao(pedido({
    biblioteca: lib,
    executar: true,
    simulado: false,
    referencias: { reqNum: "1", locRef: "2", extRef: "3", virtMerch: "4", authSyst: "5" },
  }));
  assert.equal(semCaptura.executado, false);
  assert.equal(semCaptura.retornos.motivo, "sem_captura");
  assert.deepEqual(lib.chamadas, []);
  const cancelamento = await coletarRetornosComprovacao(pedido({
    biblioteca: lib,
    executar: true,
    simulado: false,
    capturaEmCurso: true,
  }));
  const capacidadeCancelamento = avaliarCapacidadeComprovacao(cancelamento);
  assert.equal(capacidadeCancelamento.abortColetado, true);
  assert.equal(capacidadeCancelamento.eventoColetado, true);
  assert.equal(capacidadeCancelamento.confirmacaoColetada, false);
  assert.equal(capacidadeCancelamento.layoutHomologado, false);
  assert.equal(capacidadeCancelamento.abiComprovado, false);
  const confirmacao = await coletarRetornosComprovacao(pedido({
    biblioteca: lib,
    executar: true,
    simulado: false,
    referenciasOrigem: "pw_iGetResult",
    referencias: { reqNum: "1", locRef: "2", extRef: "3", virtMerch: "4", authSyst: "5" },
  }));
  const capacidadeConfirmacao = avaliarCapacidadeComprovacao(confirmacao);
  assert.equal(capacidadeConfirmacao.confirmacaoColetada, true);
  assert.equal(capacidadeConfirmacao.esperaColetada, true);
  assert.equal(capacidadeConfirmacao.layoutHomologado, false);
  assert.equal(capacidadeConfirmacao.producaoLiberada, false);
  assert.equal(confirmacao.pagamentoRecebido, false);
  assert.equal(confirmacao.nfcEEmitida, false);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, false);
});

test("confirmação sem referência lida da DLL não chama PW_iConfirmation nem PW_iPPAbort", async () => {
  const lib = biblioteca();
  const resultado = await coletarRetornosComprovacao(pedido({
    biblioteca: lib,
    executar: true,
    referencias: { reqNum: "1", locRef: "2", extRef: "3", virtMerch: "4", authSyst: "5" },
  }));
  assert.equal(resultado.retornos.motivo, "sem_captura");
  assert.equal(lib.chamadas.includes("PW_iPPAbort"), false);
  assert.equal(lib.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iConfirmation"), false);
  assert.equal(lib.chamadas.includes("PW_iWaitConfirmation"), false);
});

test("o journal de comprovação não substitui um arquivo existente", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-comprovacao-"));
  const arquivo = path.join(pasta, "tef-journal-comprovacao-fisica.json");
  const fsApi = {
    async readFile(alvo, modo) {
      return readFile(alvo, modo);
    },
    async writeFile(alvo, conteudo, opcoes) {
      const { writeFile } = await import("node:fs/promises");
      return writeFile(alvo, conteudo, opcoes);
    },
    async mkdir(alvo, opcoes) {
      const { mkdir } = await import("node:fs/promises");
      return mkdir(alvo, opcoes);
    },
  };
  try {
    const primeiro = await persistirEvidenciaComprovacao(arquivo, { idempotencyKey: "prova-1", executado: true }, fsApi);
    assert.equal(primeiro.gravado, true);
    assert.equal(primeiro.journalApagado, false);
    const segundo = await persistirEvidenciaComprovacao(arquivo, { idempotencyKey: "prova-2", executado: true }, fsApi);
    assert.equal(segundo.gravado, false);
    assert.equal(segundo.preservado, true);
    const gravado = JSON.parse(await readFile(arquivo, "utf8"));
    assert.equal(gravado.idempotencyKey, "prova-1");
    assert.equal(gravado.pagamentoRecebido, false);
    assert.equal(gravado.nfcEEmitida, false);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
