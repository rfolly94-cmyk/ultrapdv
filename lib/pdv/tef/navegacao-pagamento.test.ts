import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decidirNavegacaoPagamentoTef } from "./navegacao-pagamento";

test("voltar fica livre sem transação ativa", () => {
  assert.equal(decidirNavegacaoPagamentoTef({ fase: null, pagamentoConfirmado: false, estado: "" }).acao, "voltar");
  assert.equal(decidirNavegacaoPagamentoTef({ fase: null, pagamentoConfirmado: false, estado: "recusada" }).acao, "voltar");
  assert.equal(decidirNavegacaoPagamentoTef({ fase: null, pagamentoConfirmado: false, estado: "cancelada" }).acao, "voltar");
});

test("menu e digitação cancelam a interação antes da autorização", () => {
  assert.equal(decidirNavegacaoPagamentoTef({ fase: "menu", pagamentoConfirmado: false, estado: "executando" }).acao, "cancelar-interacao");
  assert.equal(decidirNavegacaoPagamentoTef({ fase: "digitado", pagamentoConfirmado: false, estado: "executando" }).acao, "cancelar-interacao");
  assert.equal(decidirNavegacaoPagamentoTef({ fase: "qrcode", pagamentoConfirmado: false, estado: "executando" }).acao, "cancelar-interacao");
});

test("pinpad pede interrupção e resultado desconhecido permanece aguardando", () => {
  assert.equal(decidirNavegacaoPagamentoTef({ fase: "pinpad", pagamentoConfirmado: false, estado: "executando" }).acao, "cancelar-interacao");
  const desconhecido = decidirNavegacaoPagamentoTef({ fase: null, pagamentoConfirmado: false, estado: "resultado_desconhecido" });
  assert.equal(desconhecido.acao, "aguardar");
});

test("venda autorizada não é cancelada ao voltar", () => {
  for (const estado of ["confirmada", "aguardando_confirmacao", ""]) {
    const decisao = decidirNavegacaoPagamentoTef({
      fase: estado === "" ? "menu" : null,
      pagamentoConfirmado: estado !== "aguardando_confirmacao",
      estado,
    });
    assert.equal(decisao.acao, "bloquear-confirmada");
  }
});

test("a tela envia o cancelamento da captura e não o cancelamento financeiro", () => {
  const shell = readFileSync(new URL("../../../components/pdv/pdv-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /Cancelar operação/);
  assert.match(shell, />\s*Voltar\s*</);
  assert.match(shell, /decidirNavegacaoPagamentoTef/);
  assert.match(shell, /respostaTefRef\.current[\s\S]{0,400}cancelar: true/);
  assert.match(shell, /pedirInterrupcaoCaptura\(\)/);
  assert.doesNotMatch(shell, /function solicitarSaidaPagamento[\s\S]{0,700}comando: "cancelar"/);
});
