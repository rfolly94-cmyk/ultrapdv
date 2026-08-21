import assert from "node:assert/strict";
import { test } from "node:test";

import { arquivoConfigMaquina, carregarConfigLocal } from "./config-local.mjs";
import {
  candidatosPorta,
  escolherPortaLivre,
  mensagemPortaForaDaFaixa,
  mensagemPortaOcupada,
  portaValida,
  PORTA_PADRAO,
} from "./portas.mjs";
import { ehConectorUltraPdv, obterMutexExclusivo } from "./mutex.mjs";
import { gerarPdfTesteConector } from "./pdf-teste.mjs";

test("cenário A: 18181 livre usa 18181", async () => {
  const r = await escolherPortaLivre({
    preferred: 18181,
    ocupada: async () => false,
  });
  assert.equal(r.porta, 18181);
});

test("cenário B: 18181 ocupada por outro programa usa 18182", async () => {
  const r = await escolherPortaLivre({
    preferred: 18181,
    ocupada: async (p) => p === 18181,
  });
  assert.equal(r.porta, 18182);
  assert.deepEqual(r.conflitos, [18181]);
});

test("cenário C: 18181 e 18182 ocupadas usa a próxima", async () => {
  const r = await escolherPortaLivre({
    preferred: 18181,
    ocupada: async (p) => p === 18181 || p === 18182,
  });
  assert.equal(r.porta, 18183);
});

test("cenário D: porta escolhida 18185 livre usa 18185", async () => {
  const r = await escolherPortaLivre({
    preferred: 18185,
    ocupada: async () => false,
  });
  assert.equal(r.porta, 18185);
  assert.equal(candidatosPorta(18185)[0], 18185);
});

test("cenário E: 18185 ocupada usa próxima da faixa", async () => {
  const r = await escolherPortaLivre({
    preferred: 18185,
    ocupada: async (p) => p === 18185,
  });
  assert.equal(r.porta, PORTA_PADRAO);
  assert.equal(
    mensagemPortaOcupada(18181),
    "Porta 18181 está sendo utilizada por outro aplicativo."
  );
});

test("tentar configurar 19000 é rejeitado", () => {
  assert.equal(portaValida(19000), false);
  assert.equal(portaValida(18180), false);
  assert.equal(portaValida(18191), false);
  assert.equal(portaValida(18185), true);
  assert.equal(
    mensagemPortaForaDaFaixa(),
    "O UltraPDV Conector utiliza portas entre 18181 e 18190."
  );
  assert.equal(candidatosPorta(19000).includes(19000), false);
});

test("config antiga fora da faixa volta para 18181", async () => {
  const cfg = await carregarConfigLocal({
    env: { PROGRAMDATA: "C:\\ProgramData" },
    fsApi: {
      readFile: async () =>
        JSON.stringify({ preferredPort: 19000, activePort: 19000 }),
    },
  });
  assert.equal(cfg.preferredPort, 18181);
  assert.equal(cfg.activePort, 18181);
});

test("cenário H: HTTP genérico não é o Conector", () => {
  assert.equal(ehConectorUltraPdv({ ok: true }), false);
  assert.equal(ehConectorUltraPdv({ ok: true, nome: "nginx" }), false);
  assert.equal(
    ehConectorUltraPdv({ ok: true, app: "UltraPDV-Conector" }),
    true
  );
});

test("config da máquina fica em ProgramData, não no repositório", () => {
  const arquivo = arquivoConfigMaquina({ PROGRAMDATA: "C:\\ProgramData" });
  assert.match(arquivo.replace(/\//g, "\\"), /ProgramData\\UltraPDV\\print-agent\.json/);
});

test("cenário F: segunda instância não obtém mutex", async () => {
  let ocupado = false;
  const createServer = () => {
    const listeners = {};
    return {
      on() {},
      once(ev, fn) {
        listeners[ev] = fn;
      },
      listen(_pipe, cb) {
        if (ocupado) {
          listeners.error?.({ code: "EADDRINUSE" });
          return;
        }
        ocupado = true;
        cb();
      },
    };
  };
  const a = await obterMutexExclusivo({ createServer });
  assert.equal(a.unico, true);
  const b = await obterMutexExclusivo({ createServer });
  assert.equal(b.unico, false);
});

test("PDF de teste usa o mesmo cabeçalho PDF", () => {
  const pdf = gerarPdfTesteConector({
    porta: 18183,
    versao: "1.3.1",
    impressora: "ELGIN i9",
    papel: "80mm",
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.toString("latin1"), /TESTE DE IMPRESSAO/);
  assert.match(pdf.toString("latin1"), /Porta: 18183/);
  assert.match(pdf.toString("latin1"), /Papel: 80 mm/);
  assert.match(pdf.toString("latin1"), /Versao: 1.3.1/);
});
