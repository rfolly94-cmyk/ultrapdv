import assert from "node:assert/strict";
import { test } from "node:test";

import {
  escolherStatusFiscalVenda,
  interpretarRespostaEmissaoVenda,
  mensagemFeedbackEmissaoVenda,
  resolverDestinoAposEmissaoVenda,
  resolverOrigemVendaComercial,
  resolverRotaEdicaoVenda,
  resolverRotaEmissaoListaVenda,
  rotuloOrigemVendaComercial,
} from "./resolver-rota-edicao-venda";

test("origem da venda é NF-e só quando existe fiscal_operacoes.venda_id", () => {
  assert.equal(resolverOrigemVendaComercial(null), "pdv");
  assert.equal(resolverOrigemVendaComercial(""), "pdv");
  assert.equal(resolverOrigemVendaComercial("op-1"), "nfe_manual");
  assert.equal(rotuloOrigemVendaComercial("pdv"), "PDV");
  assert.equal(rotuloOrigemVendaComercial("nfe_manual"), "NF-e");
});

test("PDV edita no PDV e emite pela tela da venda", () => {
  const edicao = resolverRotaEdicaoVenda({
    vendaId: "v1",
    origem: "pdv",
    statusFiscal: "rejeitada",
  });
  assert.equal(edicao.href, "/pdv/editar/v1");
  assert.equal(edicao.modo, "pdv");

  const emitir = resolverRotaEmissaoListaVenda({
    vendaId: "v1",
    origem: "pdv",
    modelo: "55",
  });
  assert.equal(emitir.href, "/vendas/v1/nfe");
  assert.equal(emitir.ocultar, true);
  const emitirNfce = resolverRotaEmissaoListaVenda({
    vendaId: "v1",
    origem: "pdv",
    modelo: "65",
  });
  assert.equal(emitirNfce.ocultar, false);
});

test("NF-e manual rascunho ou rejeitada reabre o formulário original", () => {
  const rascunho = resolverRotaEdicaoVenda({
    vendaId: "v1",
    origem: "nfe_manual",
    operacaoFiscalId: "op-9",
  });
  assert.equal(rascunho.href, "/fiscal/nfe/op-9/editar");
  assert.equal(rascunho.modo, "nfe_formulario");

  const rejeitada = resolverRotaEdicaoVenda({
    vendaId: "v1",
    origem: "nfe_manual",
    operacaoFiscalId: "op-9",
    statusFiscal: "rejeitada",
  });
  assert.equal(rejeitada.href, "/fiscal/nfe/op-9/editar");
  assert.equal(rejeitada.label, "Corrigir NF-e");
});

test("NF-e autorizada ou em reconciliação não reabre rascunho", () => {
  const autorizada = resolverRotaEdicaoVenda({
    vendaId: "v1",
    origem: "nfe_manual",
    operacaoFiscalId: "op-9",
    statusFiscal: "autorizada",
  });
  assert.equal(autorizada.href, "/vendas/v1");
  assert.equal(autorizada.modo, "venda_detalhe");

  const pendente = resolverRotaEdicaoVenda({
    vendaId: "v1",
    origem: "nfe_manual",
    operacaoFiscalId: "op-9",
    statusFiscal: "aguardando_reconciliacao",
  });
  assert.equal(pendente.href, "/vendas/v1");
  assert.equal(pendente.label, "Acompanhar reconciliação");

  const emitir = resolverRotaEmissaoListaVenda({
    vendaId: "v1",
    origem: "nfe_manual",
    operacaoFiscalId: "op-9",
    statusFiscal: "aguardando_reconciliacao",
    modelo: "55",
  });
  assert.equal(emitir.ocultar, true);
});

test("após emitir, autorizada e ambígua vão para a venda; rejeição permanece no formulário", () => {
  assert.equal(
    resolverDestinoAposEmissaoVenda({
      vendaId: "v1",
      ok: true,
      autorizada: true,
    })?.href,
    "/vendas/v1?emissao=autorizada"
  );
  assert.equal(
    resolverDestinoAposEmissaoVenda({
      vendaId: "v1",
      ok: false,
      status: "aguardando_reconciliacao",
      classificacao: "erro_tecnico",
      requer_reconciliacao: true,
      podeRetransmitir: false,
    })?.href,
    "/vendas/v1?emissao=aguardando_reconciliacao"
  );
  assert.equal(
    interpretarRespostaEmissaoVenda({
      ok: false,
      status: "aguardando_reconciliacao",
      classificacao: "erro_tecnico",
      requer_reconciliacao: true,
    }).kind,
    "aguardando_reconciliacao"
  );
  assert.equal(
    resolverDestinoAposEmissaoVenda({
      vendaId: "v1",
      ok: false,
      status: "rejeitada",
    }),
    null
  );
  assert.equal(
    resolverDestinoAposEmissaoVenda({
      vendaId: "v1",
      ok: false,
      status: "erro_comunicacao",
      classificacao: "erro_envio",
    })?.href,
    "/vendas/v1?emissao=nao_transmitida"
  );
  assert.equal(interpretarRespostaEmissaoVenda({ status: "rejeitada" }).kind, "rejeitada");
  assert.equal(mensagemFeedbackEmissaoVenda("autorizada")?.type, "sucesso");
  assert.equal(mensagemFeedbackEmissaoVenda("aguardando_reconciliacao")?.type, "aviso");
  assert.match(
    mensagemFeedbackEmissaoVenda("aguardando_reconciliacao")?.texto ?? "",
    /Não retransmita/
  );
  assert.equal(mensagemFeedbackEmissaoVenda("nao_transmitida")?.type, "aviso");
  assert.doesNotMatch(
    mensagemFeedbackEmissaoVenda("nao_transmitida")?.texto ?? "",
    /Não retransmita/
  );
  assert.doesNotMatch(
    mensagemFeedbackEmissaoVenda("erro_comunicacao")?.texto ?? "",
    /pendente de reconciliação/
  );
});

test("status fiscal da venda prefere autorização a rejeição", () => {
  assert.equal(
    escolherStatusFiscalVenda([
      { status: "rejeitada" },
      { status: "autorizada" },
      { status: "aguardando_reconciliacao" },
    ]),
    "autorizada"
  );
});
