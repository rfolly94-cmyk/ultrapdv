import assert from "node:assert/strict";
import { test } from "node:test";

import { classificarArquivoJournal, pastasJournalEmpresa, resumirPendencias } from "./tef-pendencias-ambiente.mjs";

const empresaA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const empresaB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const terminalA = "11111111-1111-4111-8111-111111111111";
const terminalB = "22222222-2222-4222-8222-222222222222";

test("journals de homologação e produção ficam em pastas diferentes por empresa e terminal", () => {
  const a = pastasJournalEmpresa("C:\\temp\\tef-empresas", empresaA, terminalA);
  const outroTerminal = pastasJournalEmpresa("C:\\temp\\tef-empresas", empresaA, terminalB);
  const outraEmpresa = pastasJournalEmpresa("C:\\temp\\tef-empresas", empresaB, terminalA);
  assert.notEqual(a.homologacao, a.producao);
  assert.match(a.producao, /\\producao\\/);
  assert.doesNotMatch(a.homologacao, /\\producao\\/);
  assert.notEqual(a.homologacao, outroTerminal.homologacao);
  assert.notEqual(a.producao, outraEmpresa.producao);
});

test("pendência bloqueia a troca e journal encerrado não é apagado pelo resumo", () => {
  const pendente = classificarArquivoJournal({ Status: "aguardando_confirmacao" });
  const encerrado = classificarArquivoJournal({ Status: "confirmada" });
  const resumo = resumirPendencias([pendente, encerrado], false);
  assert.deepEqual(resumo.statuses, ["aguardando_confirmacao"]);
  assert.equal(resumo.ilegivel, false);
  assert.equal(resumo.pagamentoRecebido, false);
  const ilegivel = resumirPendencias([{ ilegivel: true }], false);
  assert.equal(ilegivel.ilegivel, true);
  assert.deepEqual(ilegivel.statuses, []);
});
