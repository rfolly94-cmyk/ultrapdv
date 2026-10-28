import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ESPERA_CONSULTA_TEF_MS,
  aguardarConsultaTef,
  classificarProntidaoConnector,
  decidirInicializacaoPascal,
  interpretarConsultaTef,
  mensagemRecusaInicializacao,
} from "./prontidao-connector";

const statusVivo = {
  inicializado: false,
  processo: "parado",
  disponivel: false,
  prontoParaPagamento: false,
  situacaoAmbiente: "desconhecido",
  pgwebLib: {
    pronta: true,
    arquitetura: "x64",
    versao: "4.1.50.924",
  },
};

test("pgwebLib.pronta libera o encaminhamento mesmo com o Pascal parado", () => {
  const prontidao = classificarProntidaoConnector(statusVivo);
  assert.equal(prontidao.pgwebLibPronta, true);
  assert.equal("sessaoPascalInicializada" in prontidao, false);
  assert.equal(prontidao.pontoComprovado, null);
  assert.equal(prontidao.pinpadNoStatus, null);
  assert.equal(prontidao.podeEncaminharPgWeb, true);
  assert.equal(prontidao.codigo, "pgweb_pronta");
  assert.equal(decidirInicializacaoPascal(statusVivo), "pgweb_pronta");
});

test("pgwebLib ausente ou falsa usa a consulta da biblioteca e não o processo antigo", () => {
  const ausente = classificarProntidaoConnector({ inicializado: false, processo: "parado" });
  assert.equal(ausente.podeEncaminharPgWeb, false);
  assert.equal(ausente.codigo, "pgweblib");
  assert.match(ausente.mensagem, /não informou pgwebLib/);
  assert.equal(ausente.mensagem.includes("inicializado=false"), false);
  const falsa = classificarProntidaoConnector({
    pgwebLib: { pronta: false, mensagem: "A PGWebLib.dll x64 4.1.50.924 não foi encontrada." },
    inicializado: true,
  });
  assert.match(falsa.mensagem, /4\.1\.50\.924/);
  assert.equal(decidirInicializacaoPascal({ inicializado: false }), "biblioteca");
  assert.equal(decidirInicializacaoPascal({ inicializado: true, pgwebLib: { pronta: true } }), "pgweb_pronta");
});

test("a recusa de inicialização usa mensagem e código quando erro vem vazio", () => {
  assert.equal(
    mensagemRecusaInicializacao({
      ok: false,
      codigo: "nativo",
      mensagem: "A cobrança permanece na PGWebLib deste Connector.",
    }),
    "nativo: A cobrança permanece na PGWebLib deste Connector."
  );
  assert.equal(mensagemRecusaInicializacao({ ok: false }), "O Connector TEF não está pronto.");
});

test("a primeira consulta espera a promessa em voo e estoura o limite sem cobrar", async () => {
  let liberar: (valor: number) => void = () => undefined;
  const consulta = new Promise<number>((resolve) => {
    liberar = resolve;
  });
  const espera = aguardarConsultaTef(consulta, 20);
  const vencida = await espera;
  assert.equal(vencida.ok, false);
  if (!vencida.ok) {
    assert.equal(vencida.codigo, "timeout");
    assert.match(vencida.mensagem, /12 segundos|tempo/i);
  }
  liberar(1);
  const imediata = await aguardarConsultaTef(Promise.resolve(7), ESPERA_CONSULTA_TEF_MS);
  assert.deepEqual(imediata, { ok: true, valor: 7 });
});

test("a consulta HTTP vira a política usada pelo F2", () => {
  const consulta = interpretarConsultaTef(true, {
    habilitado: true,
    plataformaHabilitada: true,
    empresaHabilitada: true,
    permitirOperacaoManual: false,
    ambiente: "homologacao",
    empresaId: "empresa",
    estabelecimento: "homologacao",
    pendencias: [],
  });
  assert.equal(consulta.ok, true);
  assert.equal(consulta.politica.ambiente, "homologacao");
  assert.equal(consulta.habilitado, true);
  assert.equal(interpretarConsultaTef(false, null).ok, false);
});

test("o F2 cobra pelo motor C# e não encaminha a PGWebLib em JavaScript", () => {
  const raiz = path.resolve(import.meta.dirname, "../../..");
  const shell = readFileSync(path.join(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  const conclusao = shell.slice(shell.indexOf("function concluirVenda("), shell.indexOf("finalizarVendaPdv("));
  assert.match(conclusao, /cobrarPeloMotorCsharp/);
  assert.doesNotMatch(conclusao, /executarVendaPinpad/);
  assert.doesNotMatch(conclusao, /classificarProntidaoConnector/);
  assert.doesNotMatch(conclusao, /\/tef\/status/);
  const fluxo = readFileSync(path.join(raiz, "lib/pdv/tef/fluxo-cliente.ts"), "utf8");
  assert.equal(fluxo.includes("/tef/inicializar"), false);
});
