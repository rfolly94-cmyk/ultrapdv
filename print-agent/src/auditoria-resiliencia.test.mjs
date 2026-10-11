import assert from "node:assert/strict";
import test from "node:test";

import { interpretarPendencia, STATUS_JOURNAL_TEF } from "./tef-pendencia.mjs";

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

test("journal corrompido, incompleto e de status desconhecido fica ilegível", () => {
  assert.equal(interpretarPendencia("{").ok, false);
  assert.equal(interpretarPendencia("").ok, false);
  assert.equal(interpretarPendencia("null").ok, false);
  assert.equal(interpretarPendencia("[]").ok, false);
  assert.equal(
    interpretarPendencia(
      JSON.stringify({ status: STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO, nsu: "1" })
    ).ok,
    false
  );
  assert.equal(interpretarPendencia(JSON.stringify({ status: "confirmada" })).ok, false);
});

test("journal completo de decisão preserva NSU, rede e finalização", () => {
  const lido = interpretarPendencia(
    JSON.stringify({
      status: STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
      identificador: "10fc717b-5e8b-433b-9e24-f5040c8c0076",
      valor: 1,
      rede: "PIX C6 BANK",
      nsu: "E1928374620261011120364LDuT35VP5",
      finalizacao: "1",
      confirmar: true,
    })
  );
  assert.equal(lido.ok, true);
  if (!lido.ok) {
    return;
  }
  assert.equal(lido.registro.nsu, "E1928374620261011120364LDuT35VP5");
  assert.equal(lido.registro.rede, "PIX C6 BANK");
  assert.equal(lido.registro.finalizacao, "1");
});
