import assert from "node:assert/strict";
import { test } from "node:test";

import {
  abrirGaveta,
  montarComandoGaveta,
  sanitizarPinoGaveta,
  MENSAGEM_GAVETA_DESABILITADA,
  MENSAGEM_GAVETA_IMPRESSORA_OFFLINE,
  MENSAGEM_GAVETA_NAO_SUPORTADA,
} from "./gaveta.mjs";
import { MENSAGEM_IMPRESSORA_INDISPONIVEL } from "./imprimir.mjs";

test("comando pino 0 é ESC p 0 25 250 (1B 70 00 19 FA)", () => {
  assert.equal(sanitizarPinoGaveta(0), 0);
  assert.equal(sanitizarPinoGaveta("0"), 0);
  assert.equal(sanitizarPinoGaveta(null), 0);
  assert.deepEqual(
    [...montarComandoGaveta(0)],
    [0x1b, 0x70, 0x00, 0x19, 0xfa]
  );
});

test("comando pino 1 é ESC p 1 25 250 (1B 70 01 19 FA)", () => {
  assert.equal(sanitizarPinoGaveta(1), 1);
  assert.equal(sanitizarPinoGaveta("1"), 1);
  assert.deepEqual(
    [...montarComandoGaveta(1)],
    [0x1b, 0x70, 0x01, 0x19, 0xfa]
  );
});

test("gaveta desabilitada não envia RAW", async () => {
  let enviou = false;
  await assert.rejects(
    () =>
      abrirGaveta("ELGIN i9", { habilitada: false, pino: 0 }, {
        impressoras: [{ nome: "ELGIN i9" }],
        enviarRaw: async () => {
          enviou = true;
        },
        consultarStatus: async () => ({ existe: true, offline: false }),
      }),
    (erro) => erro instanceof Error && erro.message === MENSAGEM_GAVETA_DESABILITADA
  );
  assert.equal(enviou, false);
});

test("impressora não configurada", async () => {
  await assert.rejects(
    () =>
      abrirGaveta(null, { habilitada: true, pino: 0 }, {
        impressoras: [{ nome: "ELGIN i9" }],
        enviarRaw: async () => {
          throw new Error("não deveria enviar");
        },
        consultarStatus: async () => ({ existe: true, offline: false }),
      }),
    (erro) =>
      erro instanceof Error && erro.message === MENSAGEM_IMPRESSORA_INDISPONIVEL
  );
});

test("impressora offline e falha RAW não derrubam o helper", async () => {
  await assert.rejects(
    () =>
      abrirGaveta("ELGIN i9", { habilitada: true, pino: 0 }, {
        impressoras: [{ nome: "ELGIN i9" }],
        consultarStatus: async () => ({ existe: true, offline: true }),
        enviarRaw: async () => {
          throw new Error("não deveria enviar");
        },
      }),
    (erro) =>
      erro instanceof Error && erro.message === MENSAGEM_GAVETA_IMPRESSORA_OFFLINE
  );

  await assert.rejects(
    () =>
      abrirGaveta("ELGIN i9", { habilitada: true, pino: 1 }, {
        impressoras: [{ nome: "ELGIN i9" }],
        consultarStatus: async () => ({ existe: true, offline: false }),
        enviarRaw: async () => {
          throw new Error("WritePrinter falhou");
        },
      }),
    (erro) =>
      erro instanceof Error && erro.message === MENSAGEM_GAVETA_NAO_SUPORTADA
  );
});

test("abrirGaveta envia o comando do pino selecionado", async () => {
  let enviado = null;
  const r = await abrirGaveta("ELGIN i9", { habilitada: true, pino: 1 }, {
    impressoras: [{ nome: "ELGIN i9" }],
    consultarStatus: async () => ({ existe: true, offline: false }),
    enviarRaw: async ({ impressora, bytes }) => {
      enviado = { impressora, bytes: [...bytes] };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(enviado.impressora, "ELGIN i9");
  assert.deepEqual(enviado.bytes, [0x1b, 0x70, 0x01, 0x19, 0xfa]);
});
