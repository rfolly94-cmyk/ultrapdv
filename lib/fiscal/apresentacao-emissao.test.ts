import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { resolverApresentacaoEmissaoFiscal } from "./apresentacao-emissao";

test("HTTP 422 genérico persistido como aguardando_reconciliacao não vira não transmitida", () => {
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "aguardando_reconciliacao",
    classificacao: "erro_tecnico",
    geranetHttpStatus: 422,
    geranetSituacao: "erro",
    motivo:
      "Não foi possível processar a solicitação. Confira os dados informados e tente novamente.",
    cstat: null,
    protocolo: null,
    chaveAcesso: null,
  });

  assert.equal(ui.caso, "aguardando_reconciliacao");
  assert.equal(ui.acaoPrincipal, "reconciliar");
  assert.equal(ui.podeRetransmitir, false);
  assert.doesNotMatch(ui.titulo, /não transmitida/i);
  assert.match(ui.texto, /Não retransmita/);
});

test("erro_envio persistido (falha antes do POST) → NF-e não transmitida", () => {
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_envio",
    geranetHttpStatus: null,
    motivo: "getaddrinfo ENOTFOUND nfe.geranet.net",
    erroComunicacao: "getaddrinfo ENOTFOUND nfe.geranet.net",
    cstat: null,
    protocolo: null,
    chaveAcesso: null,
  });

  assert.equal(ui.caso, "nao_transmitida");
  assert.equal(ui.titulo, "NF-e não transmitida");
  assert.equal(ui.acaoPrincipal, "tentar_novamente");
  assert.equal(ui.consultaGeranetSecundaria, true);
  assert.equal(ui.podeRetransmitir, true);
  assert.equal(ui.bloqueiaRetransmissao, false);
  assert.doesNotMatch(ui.titulo, /reconcilia/i);
});

test("HTTP 500 / NfeConsulta4 / ambígua → aguardando reconciliação sem retry", () => {
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "aguardando_reconciliacao",
    classificacao: "erro_tecnico",
    geranetHttpStatus: 500,
    motivo: "NfeConsulta4 timeout",
    erroComunicacao: "NfeConsulta4 timeout",
  });

  assert.equal(ui.caso, "aguardando_reconciliacao");
  assert.equal(ui.titulo, "Emissão pendente de reconciliação");
  assert.equal(ui.acaoPrincipal, "reconciliar");
  assert.equal(ui.podeRetransmitir, false);
  assert.match(ui.texto, /Não retransmita/);
});

test("erro_comunicacao sem classificação exige diagnóstico e não inventa retry nem reconciliação", () => {
  const retry = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    geranetHttpStatus: 422,
    motivo: "mensagem genérica qualquer",
  });
  assert.equal(retry.caso, "nao_classificada");
  assert.equal(retry.acaoPrincipal, "consultar_diagnostico");
  assert.equal(retry.podeRetransmitir, false);

  const ambiguo = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    geranetHttpStatus: 503,
    motivo: "mensagem genérica qualquer",
  });
  assert.equal(ambiguo.caso, "nao_classificada");
  assert.notEqual(ambiguo.acaoPrincipal, "tentar_novamente");
  assert.notEqual(ambiguo.acaoPrincipal, "reconciliar");
});

test("rejeitada conclusiva não vira reconciliação obrigatória", () => {
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "rejeitada",
    classificacao: "rejeitada",
    cstat: "230",
    motivo: "Rejeição: IE do emitente não cadastrada",
  });
  assert.equal(ui.caso, "rejeitada");
  assert.notEqual(ui.acaoPrincipal, "reconciliar");
});

test("autorizada não oferece retransmissão", () => {
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "autorizada",
    classificacao: "autorizada",
    cstat: "100",
    protocolo: "1",
    chaveAcesso: "35240111222333000155550010000000291000000001",
  });
  assert.equal(ui.caso, "autorizada");
  assert.equal(ui.podeRetransmitir, false);
  assert.equal(ui.acaoPrincipal, "nenhuma");
});

test("UI de venda/conferência separa erro_envio de reconciliação", () => {
  const helper = readFileSync(
    path.join(process.cwd(), "lib/fiscal/estado-operacional-fiscal.ts"),
    "utf8"
  );
  const card = readFileSync(
    path.join(process.cwd(), "components/vendas/reconciliar-emissao-fiscal.tsx"),
    "utf8"
  );
  const nfe = readFileSync(
    path.join(process.cwd(), "app/vendas/[id]/nfe/page.tsx"),
    "utf8"
  );
  const venda = readFileSync(
    path.join(process.cwd(), "app/vendas/[id]/page.tsx"),
    "utf8"
  );

  assert.match(helper, /não transmitida/);
  assert.match(helper, /A Geranet recusou ou não aceitou a solicitação/);
  assert.match(card, /Ver diagnóstico/);
  assert.match(card, /Tentar novamente/);
  assert.match(nfe, /caso === "nao_transmitida"/);
  assert.match(venda, /emissoesNaoTransmitidas/);
  assert.match(venda, /ocultarConsulta/);
});
