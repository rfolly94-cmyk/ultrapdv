import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  decidirPortaDoComputador,
  gravarPortaPinpad,
  interpretarPortasSeriais,
  lerPortaPinpad,
  listarPortasSeriaisWindows,
} from "./tef-porta-computador.mjs";
import {
  concederAutorizacaoOperacao,
  concluirExecucaoReservaPorta,
  esquecerMenuConector,
  exclusivaCom7,
  reservarOperacaoCom7,
} from "./tef-menu-conector.mjs";

test("as portas do Windows são lidas sem abrir a COM do PinPad", async () => {
  const portas = await listarPortasSeriaisWindows({
    ler: async () => "\\Device\\Serial0    REG_SZ    COM4\r\n\\Device\\Serial1    REG_SZ    COM15\r\nCOM256",
  });
  assert.deepEqual(portas, [4, 15]);
});

test("a porta descoberta fica no computador e não muda durante a transação", () => {
  assert.deepEqual(interpretarPortasSeriais("COM3\nCOM12 COM3 COM256"), [3, 12]);
  assert.equal(decidirPortaDoComputador({ portaSalva: 3, portaDescoberta: 8 }).porta, 8);
  assert.equal(decidirPortaDoComputador({ portaSalva: 3, portaDescoberta: 8, transacaoAtiva: true }).porta, 3);
  assert.equal(decidirPortaDoComputador({ portaSalva: 3, portaDescoberta: 8, transacaoAtiva: true }).trocou, false);
  assert.equal(decidirPortaDoComputador({}).motivo, "automatica");
});

test("a porta confirmada é gravada fora da configuração da empresa", async () => {
  const pasta = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-porta-"));
  const arquivo = path.join(pasta, "pinpad-porta.json");
  const gravada = await gravarPortaPinpad(arquivo, { portaSalva: null, portaDescoberta: 8, transacaoAtiva: false });
  assert.equal(gravada.ok, true);
  assert.equal(gravada.nome, "COM8");
  const lida = await lerPortaPinpad(arquivo);
  assert.equal(lida?.porta, 8);
  const bloqueada = await gravarPortaPinpad(arquivo, { portaSalva: 8, portaDescoberta: 4, transacaoAtiva: true });
  assert.equal(bloqueada.ok, false);
  assert.equal(bloqueada.porta, 8);
  const texto = await readFile(arquivo, "utf8");
  assert.equal(texto.includes("empresa"), false);
  const outro = path.join(pasta, "outro-computador", "pinpad-porta.json");
  const segunda = await gravarPortaPinpad(outro, { portaSalva: null, portaDescoberta: 5, transacaoAtiva: false });
  assert.equal(segunda.ok, true);
  assert.equal((await lerPortaPinpad(arquivo))?.porta, 8);
  assert.equal((await lerPortaPinpad(outro))?.porta, 5);
  await rm(pasta, { recursive: true, force: true });
});

test("reserva abandonada libera o PinPad e resultado desconhecido permanece", () => {
  esquecerMenuConector();
  const pedido = {
    ambiente: "homologacao",
    empresaId: "empresa-a",
    terminalCodigo: "caixa-1",
    valorCentavos: 100,
    idempotencyKey: "op-porta",
  };
  assert.equal(concederAutorizacaoOperacao(pedido, { servidor: true }).ok, true);
  assert.equal(reservarOperacaoCom7(pedido).ok, true);
  assert.equal(exclusivaCom7("empresa-a", "caixa-1"), true);
  concluirExecucaoReservaPorta();
  assert.equal(exclusivaCom7("empresa-a", "caixa-1"), false);
  esquecerMenuConector();
});
