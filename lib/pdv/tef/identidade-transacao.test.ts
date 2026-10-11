import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { casarTransacaoTef, type TransacaoTefIdentificavel } from "./identidade-transacao";

const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NSU = "E1928374620261011120364LDuT35VP5";

function operacao(
  parcial: Partial<TransacaoTefIdentificavel> = {}
): TransacaoTefIdentificavel {
  return {
    id: "op-1",
    empresaId: EMPRESA_A,
    nsu: NSU,
    rede: "PIX C6 BANK",
    finalizacao: "1",
    valorCentavos: 100,
    terminalId: "terminal-a",
    autorizacao: null,
    ...parcial,
  };
}

test("a mesma chave composta encontra uma única transação", () => {
  const casamento = casarTransacaoTef(
    [operacao(), operacao({ id: "op-2", nsu: "OUTRO", rede: "MASTERCARD DEBITO" })],
    operacao()
  );
  assert.equal(casamento.resultado, "unica");
  if (casamento.resultado === "unica") {
    assert.equal(casamento.operacao.id, "op-1");
  }
});

test("NSU repetido em outra rede, outro valor ou outra empresa não casa sozinho", () => {
  const base = operacao();
  assert.equal(
    casarTransacaoTef(
      [operacao({ id: "cartao", rede: "MASTERCARD DEBITO", autorizacao: "778617" })],
      { ...base, rede: "PIX C6 BANK" }
    ).resultado,
    "nao_encontrada"
  );
  assert.equal(
    casarTransacaoTef([base], { ...base, valorCentavos: 200 }).resultado,
    "nao_encontrada"
  );
  assert.equal(
    casarTransacaoTef([base], { ...base, empresaId: EMPRESA_B }).resultado,
    "nao_encontrada"
  );
  assert.equal(
    casarTransacaoTef([base], { ...base, terminalId: "terminal-b" }).resultado,
    "nao_encontrada"
  );
});

test("dois candidatos com a mesma chave composta ficam ambíguos", () => {
  const casamento = casarTransacaoTef(
    [operacao({ id: "op-1" }), operacao({ id: "op-2" })],
    operacao()
  );
  assert.equal(casamento.resultado, "ambigua");
  if (casamento.resultado === "ambigua") {
    assert.equal(casamento.quantidade, 2);
  }
});

test("NSU sem rede ou sem finalização não reconcilia", () => {
  assert.equal(
    casarTransacaoTef([operacao()], { ...operacao(), rede: "" }).resultado,
    "insuficiente"
  );
  assert.equal(
    casarTransacaoTef([operacao()], { ...operacao(), finalizacao: null }).resultado,
    "insuficiente"
  );
});

test("não há UNIQUE simplista de NSU por empresa na proposta", () => {
  const fonte = readFileSync(new URL("./identidade-transacao.ts", import.meta.url), "utf8");
  assert.match(fonte, /Não criar UNIQUE \(empresa_id, nsu\)/);
  assert.doesNotMatch(fonte, /CREATE UNIQUE INDEX/);
});
