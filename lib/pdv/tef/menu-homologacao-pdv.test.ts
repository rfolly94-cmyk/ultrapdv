import assert from "node:assert/strict";
import test from "node:test";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./motor";
import {
  esquecerMenusHomologacao,
  FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
  iniciarTesteFinanceiroHomologacao,
  responderTesteFinanceiroHomologacao,
  ROTULO_PAGAMENTO_NAO_RECEBIDO,
  ROTULO_TESTE_FINANCEIRO,
} from "./menu-homologacao-pdv";

const empresa = "empresa-menu";
const terminal = "caixa-menu";

function inicio() {
  return iniciarTesteFinanceiroHomologacao({
    ambiente: "homologacao",
    empresaId: empresa,
    terminalCodigo: terminal,
    frase: FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
  });
}

test("o PDV mostra o menu real e devolve vszValorMenu na mesma sessão", async () => {
  esquecerMenusHomologacao();
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  const aberto = await inicio();
  assert.equal(aberto.ok, true);
  assert.equal(aberto.fase, "menu");
  assert.equal(aberto.novas, 1);
  assert.equal(aberto.pagamentoRecebido, false);
  assert.equal(aberto.podeFinalizar, false);
  assert.equal(aberto.nfcEEmitida, false);
  assert.equal(aberto.rotulo, ROTULO_TESTE_FINANCEIRO);
  assert.equal(aberto.aviso, ROTULO_PAGAMENTO_NAO_RECEBIDO);
  assert.equal(aberto.menu?.wIdentificador, 0x36);
  assert.deepEqual(
    aberto.menu?.opcoes.map((item) => item.texto),
    ["C6 PAY", "REDE", "PIX C6 BANK"]
  );
  assert.deepEqual(
    aberto.menu?.opcoes.map((item) => item.valor),
    ["9691", "9692", "9693"]
  );

  const repetido = await inicio();
  assert.equal(repetido.novas, 1);
  assert.equal(repetido.menu?.capturaId, aberto.menu?.capturaId);

  const escolha = await responderTesteFinanceiroHomologacao({
    empresaId: empresa,
    terminalCodigo: terminal,
    capturaId: aberto.menu?.capturaId ?? 0,
    valor: "9691",
  });
  assert.equal(escolha.ok, true);
  assert.equal(escolha.valorEnviado, "9691");
  assert.equal(escolha.novas, 1);
  assert.equal(escolha.menu?.wIdentificador, 0x29);
  assert.deepEqual(
    escolha.menu?.opcoes.map((item) => [item.texto, item.valor]),
    [
      ["Débito", "02"],
      ["Crédito", "01"],
    ]
  );
  assert.equal(escolha.pagamentoRecebido, false);

  const forma = await responderTesteFinanceiroHomologacao({
    empresaId: empresa,
    terminalCodigo: terminal,
    capturaId: escolha.menu?.capturaId ?? 0,
    valor: "02",
  });
  assert.equal(forma.fase, "pinpad");
  assert.equal(forma.pinpad?.prompt, "Insira ou passe o cartão");
  assert.equal(forma.valorEnviado, "02");
  assert.equal(forma.novas, 1);
  assert.equal(forma.pagamentoRecebido, false);
  assert.equal(forma.podeFinalizar, false);

  const perdido = await responderTesteFinanceiroHomologacao({
    empresaId: "outra-empresa",
    terminalCodigo: terminal,
    capturaId: 1,
    valor: "9691",
  });
  assert.equal(perdido.codigo, "SESSAO_PERDIDA");
  assert.equal(perdido.pagamentoRecebido, false);

  const simultanea = await iniciarTesteFinanceiroHomologacao({
    ambiente: "homologacao",
    empresaId: empresa,
    terminalCodigo: "outro-caixa",
    frase: FRASE_TESTE_FINANCEIRO_HOMOLOGACAO,
  });
  assert.equal(simultanea.codigo, "ocupada");
  assert.equal(simultanea.novas, 0);
  esquecerMenusHomologacao();
});

test("dois cliques no mesmo menu não abrem outra transação", async () => {
  esquecerMenusHomologacao();
  const aberto = await inicio();
  const capturaId = aberto.menu?.capturaId ?? 0;
  const [primeira, segunda] = await Promise.all([
    responderTesteFinanceiroHomologacao({ empresaId: empresa, terminalCodigo: terminal, capturaId, valor: "9691" }),
    responderTesteFinanceiroHomologacao({ empresaId: empresa, terminalCodigo: terminal, capturaId, valor: "9691" }),
  ]);
  const aceita = [primeira, segunda].filter((item) => item.ok && item.valorEnviado === "9691");
  const recusada = [primeira, segunda].find((item) => item.ok === false);
  assert.equal(aceita.length, 1);
  assert.equal(recusada?.codigo === "DUPLICADA" || recusada?.codigo === "OCUPADA" || recusada?.codigo === "DIVERGENTE", true);
  assert.equal(primeira.novas === 1 || segunda.novas === 1, true);
  assert.equal(primeira.pagamentoRecebido, false);
  assert.equal(segunda.pagamentoRecebido, false);
  esquecerMenusHomologacao();
});

test("sem a frase autorizada o menu não abre", async () => {
  const recusa = await iniciarTesteFinanceiroHomologacao({
    ambiente: "homologacao",
    empresaId: empresa,
    terminalCodigo: terminal,
    frase: "nao",
  });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.codigo, "autorizacao");
  assert.equal(recusa.pagamentoRecebido, false);
  assert.equal(recusa.podeFinalizar, false);
});

test("o texto exibido não substitui o vszValorMenu", async () => {
  esquecerMenusHomologacao();
  const aberto = await inicio();
  const texto = await responderTesteFinanceiroHomologacao({
    empresaId: empresa,
    terminalCodigo: terminal,
    capturaId: aberto.menu?.capturaId ?? 0,
    valor: "C6 PAY",
  });
  assert.equal(texto.ok, false);
  assert.equal(texto.codigo, "OPCAO");
  assert.equal(texto.pagamentoRecebido, false);
  assert.equal(aberto.novas, 1);
  esquecerMenusHomologacao();
});
