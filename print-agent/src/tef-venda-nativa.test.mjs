import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  abrirVendaOficial,
  bibliotecaVendaNativa,
  classificarPendenciaNativa,
  interpretarServerPnd,
} from "./tef-venda-nativa.mjs";
import { parametrosPinpadInstalacao } from "./tef-instalacao-homologacao.mjs";

const PWRET_MOREDATA = -2497;
const PWRET_NOTHING = -2493;
const PWRET_DISPLAY = -2495;
const PWRET_NODATA = -2496;
const PWRET_INVPARAM = -2499;

function koffi() {
  return {
    structs: 0,
    struct() {
      this.structs += 1;
      return { nome: "PW_GetDataInstalacao" };
    },
    array() {
      return "array";
    },
  };
}

function funcoes() {
  const estado = { consultas: 0, inits: 0 };
  const transporte = {
    estado,
    PW_iInit() {
      estado.inits += 1;
      return 0;
    },
    PW_iSetEnvironment() {
      return 0;
    },
    PW_iNewTransac() {
      return 0;
    },
    PW_iAddParam() {
      return 0;
    },
    PW_iExecTransac(_capturas, quantidade) {
      quantidade[0] = 0;
      return PWRET_NOTHING;
    },
    PW_iGetResult() {
      estado.consultas += 1;
      return 0;
    },
    PW_iPPEventLoop(display) {
      display.write("Aguardando", "latin1");
      return PWRET_DISPLAY;
    },
  };
  return transporte;
}

test("o adaptador preserva MOREDATA, NOTHING e DISPLAY e registra o tipo uma vez", async () => {
  const tipos = koffi();
  const transporte = funcoes();
  transporte.PW_iExecTransac = (memoria, quantidade) => {
    const base = 0;
    memoria.writeUInt16LE(0x26, base);
    memoria.writeUInt8(1, base + 2);
    memoria.write("Modalidade", base + 3, "latin1");
    memoria.writeUInt8(1, base + 87);
    memoria.write("Debito", base + 88, "latin1");
    memoria.write("1", base + 1728, "latin1");
    quantidade[0] = 1;
    return PWRET_MOREDATA;
  };
  const biblioteca = bibliotecaVendaNativa(transporte, { koffi: tipos });
  const pedido = await biblioteca.execTransac(9);
  assert.equal(pedido.codigo, PWRET_MOREDATA);
  assert.equal(pedido.captura.length, 1);
  assert.equal(pedido.captura[0].szPrompt, "Modalidade");
  assert.deepEqual(pedido.captura[0].opcoes, ["Debito"]);
  assert.deepEqual(pedido.captura[0].valores, ["1"]);
  assert.equal(pedido.captura[0].valores[0] === pedido.captura[0].opcoes[0], false);
  const seguinte = funcoes();
  const mais = bibliotecaVendaNativa(seguinte, { koffi: tipos });
  const nada = await mais.execTransac(9);
  assert.equal(nada.codigo, PWRET_NOTHING);
  assert.equal(nada.captura.length, 0);
  const display = await biblioteca.ppEventLoop();
  assert.equal(display.codigo, PWRET_DISPLAY);
  assert.equal(display.display, "Aguardando");
  assert.equal(tipos.structs, 1);
});

test("a venda não reenvia o PinPad da instalação e recusa produção e dado sensível", async () => {
  const tipos = koffi();
  const transporte = funcoes();
  const chamadas = [];
  transporte.PW_iNewTransac = (operacao) => {
    chamadas.push(["PW_iNewTransac", operacao]);
    return 0;
  };
  transporte.PW_iAddParam = (info, valor) => {
    chamadas.push(["PW_iAddParam", info, valor]);
    return 0;
  };
  transporte.PW_iExecTransac = (_capturas, quantidade) => {
    chamadas.push(["PW_iExecTransac"]);
    quantidade[0] = 0;
    return PWRET_NOTHING;
  };
  const biblioteca = bibliotecaVendaNativa(transporte, { koffi: tipos });
  assert.equal(await biblioteca.newTransac(0x21), 0);
  assert.equal(await biblioteca.addParam(0x15, "UltraPDV"), 0);
  assert.equal(await biblioteca.addParam(0x25, "1"), 0);
  assert.equal(await biblioteca.addParam(0x7f01, "1"), PWRET_INVPARAM);
  assert.equal(await biblioteca.addParam(0x7f02, "0"), PWRET_INVPARAM);
  const execucao = await biblioteca.execTransac(9);
  assert.equal(execucao.codigo, PWRET_NOTHING);
  assert.deepEqual(chamadas, [
    ["PW_iNewTransac", 0x21],
    ["PW_iAddParam", 0x15, "UltraPDV"],
    ["PW_iAddParam", 0x25, "1"],
    ["PW_iExecTransac"],
  ]);
  assert.equal(parametrosPinpadInstalacao().some((item) => item[0] === 0x7f01 && item[1] === "1"), true);
  const incompleta = classificarPendenciaNativa({
    transacaoIniciada: true,
    retornoNewTransac: 0,
    identificacaoPosErro: { serverPndPresente: true, prova: false },
  });
  assert.equal(incompleta.acao, "bloquear");
  assert.equal(incompleta.confirmar, false);
  assert.equal(incompleta.desfazer, false);
  assert.equal(interpretarServerPnd(0, "0").estado, "ausente");
  assert.equal(interpretarServerPnd(0, "1").bloqueio, true);
  assert.equal(interpretarServerPnd(0, "").estado, "indeterminado");
  assert.equal(await biblioteca.init("C:\\UltraPDV\\TEF\\Producao\\PGWeb"), PWRET_INVPARAM);
  assert.equal(transporte.estado.inits, 0);
  assert.equal(await biblioteca.init("C:\\UltraPDV\\TEF\\Homologacao\\PGWeb"), 0);
  assert.equal(transporte.estado.inits, 1);
  const pan = await biblioteca.getResult(0xc1);
  assert.equal(pan.codigo, PWRET_NODATA);
  assert.equal(pan.valor, "");
  assert.equal(transporte.estado.consultas, 0);
  assert.equal(biblioteca.real, false);
});

test("a PGWebLib oficial não é carregada", () => {
  assert.throws(() => abrirVendaOficial(), /Nenhuma venda foi iniciada/);
  const fonte = readFileSync(fileURLToPath(new URL("./tef-venda-nativa.mjs", import.meta.url)), "utf8");
  assert.equal(fonte.includes("koffi.load"), false);
  const servidor = readFileSync(fileURLToPath(new URL("./server.mjs", import.meta.url)), "utf8");
  assert.equal(servidor.includes("tef-venda-nativa"), false);
});
