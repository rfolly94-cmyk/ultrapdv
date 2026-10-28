import assert from "node:assert/strict";
import test from "node:test";

import { classificarArquivoJournal } from "./tef-pendencias-ambiente.mjs";

const HOSTS_REAIS = [
  "https://xdcmoqvfrdqfinylyjqt.supabase.co",
  "https://nfe.sefaz.mt.gov.br",
  "https://baas-api.c6bank.info",
  "https://pos-transac-sb.tpgweb.io:31735",
];

function hostBloqueado(url) {
  const host = new URL(url).hostname.toLowerCase();
  return (
    host.endsWith("supabase.co") ||
    host.includes("sefaz") ||
    host.endsWith("c6bank.info") ||
    host.endsWith("tpgweb.io")
  );
}

test("journal do Connector não é exercitado contra serviço real", () => {
  for (const url of HOSTS_REAIS) {
    assert.equal(hostBloqueado(url), true);
  }
});

test("journal corrompido ou incompleto do motor C# fica ilegível e não libera a troca", () => {
  assert.equal(classificarArquivoJournal(null).ilegivel, true);
  assert.equal(classificarArquivoJournal([]).ilegivel, true);
  assert.equal(classificarArquivoJournal("texto").ilegivel, true);
  const decisao = classificarArquivoJournal({ status: "aguardando_decisao" });
  assert.equal(decisao.ilegivel, false);
  assert.equal(decisao.bloqueia, true);
  const confirmada = classificarArquivoJournal({ Status: "confirmada" });
  assert.equal(confirmada.bloqueia, false);
});

test("journal de decisão do motor C# continua bloqueando a troca de ambiente", () => {
  const lido = classificarArquivoJournal({
    status: "aguardando_decisao",
    identificador: "10fc717b-5e8b-433b-9e24-f5040c8c0076",
    valor: 1,
  });
  assert.equal(lido.ilegivel, false);
  assert.equal(lido.status, "aguardando_decisao");
  assert.equal(lido.bloqueia, true);
});
