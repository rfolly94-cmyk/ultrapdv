import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  hrefOrigemEmissaoFiscal,
  resolverAcoesEmissaoFiscal,
  rotuloOrigemEmissaoFiscal,
} from "./acoes-emissao";
import {
  bloqueioCancelamentoDevolucaoFornecedor,
  MENSAGEM_CANCELAMENTO_DEVOLUCAO_COM_SAIDA,
} from "./entrada/devolucao-status";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const nfe55Autorizada = {
  modelo: "55",
  status: "autorizada",
  cstat: "100",
  motivo: "Autorizado o uso da NF-e",
  protocolo: "123",
  chaveAcesso: "35240111222333000155550010000000291000000001",
};

test("A/B. venda e devolução autorizadas compartilham as mesmas ações fiscais", () => {
  const venda = resolverAcoesEmissaoFiscal({ emissao: nfe55Autorizada });
  const devolucao = resolverAcoesEmissaoFiscal({ emissao: nfe55Autorizada });

  assert.deepEqual(venda, devolucao);
  assert.equal(venda.podeBaixarPdf, true);
  assert.equal(venda.podeBaixarXml, true);
  assert.equal(venda.podeCancelar, true);
  assert.equal(venda.podeCartaCorrecao, true);
  assert.equal(venda.podeConsultar, true);
  assert.equal(venda.podeReconciliar, false);
  assert.equal(venda.podeRetransmitir, false);
});

test("origem_tipo não entra na decisão fiscal", () => {
  const resolver = fonte("lib/fiscal/acoes-emissao.ts");
  const corpo = resolver.slice(
    resolver.indexOf("export function resolverAcoesEmissaoFiscal"),
    resolver.indexOf("export function hrefOrigemEmissaoFiscal")
  );
  assert.doesNotMatch(corpo, /origem_tipo/);
  assert.doesNotMatch(corpo, /origemTipo/);
  assert.doesNotMatch(corpo, /venda_id/);
});

test("C/D. DANFE e XML reutilizam a rota por emissão", () => {
  const botoes = fonte("components/vendas/documento-fiscal-botoes.tsx");
  const arquivo = fonte("app/api/fiscal/emissoes/[id]/arquivo/route.ts");
  const painel = fonte("components/fiscal/emissao-fiscal-acoes.tsx");

  assert.match(botoes, /\/api\/fiscal\/emissoes\/\$\{emissaoId\}\/arquivo/);
  assert.match(arquivo, /obterDocumentoFiscal/);
  assert.match(arquivo, /\.eq\("empresa_id", vinculo\.empresa_id\)/);
  assert.match(painel, /DocumentoFiscalBotoes/);
  assert.doesNotMatch(painel, /nfe-emitir-devolucao/);
});

test("E. CC-e usa a mesma rota da NF-e 55", () => {
  const carta = fonte("components/vendas/carta-correcao-nfe.tsx");
  const rota = fonte("app/api/fiscal/emissoes/[id]/carta-correcao/route.ts");
  const painel = fonte("components/fiscal/emissao-fiscal-acoes.tsx");

  assert.match(carta, /\/api\/fiscal\/emissoes\/\$\{emissaoId\}\/carta-correcao/);
  assert.match(rota, /\/api\/v1\/nfe\/carta-correcao/);
  assert.match(rota, /fiscal_emissao_eventos/);
  assert.match(rota, /Carta de Correção é permitida somente para NF-e modelo 55/);
  assert.match(painel, /CartaCorrecaoNfe/);
  assert.doesNotMatch(rota, /cancelar-devolucao/);
});

test("F. cancelamento sem saída não mexe em estoque", () => {
  const cancelar = fonte("app/api/fiscal/emissoes/[id]/cancelar/route.ts");
  assert.match(cancelar, /\/api\/v1\/nfe\/cancelar/);
  assert.match(cancelar, /fiscal_emissao_eventos/);
  assert.doesNotMatch(cancelar, /estoque_atual/);
  assert.doesNotMatch(cancelar, /rpc_confirmar_saida_devolucao_fornecedor/);
  assert.equal(bloqueioCancelamentoDevolucaoFornecedor(null), null);
});

test("G. cancelamento com saída processada é bloqueado", () => {
  assert.equal(
    bloqueioCancelamentoDevolucaoFornecedor("2026-08-17T19:00:00Z"),
    MENSAGEM_CANCELAMENTO_DEVOLUCAO_COM_SAIDA
  );

  const cancelar = fonte("app/api/fiscal/emissoes/[id]/cancelar/route.ts");
  assert.match(cancelar, /bloqueioCancelamentoDevolucaoFornecedor/);
  assert.match(cancelar, /devolucao_fornecedor/);
  assert.match(cancelar, /saida_estoque_processada_at/);
  assert.match(cancelar, /bloqueioCancelamentoOperacaoFiscal/);
  assert.match(cancelar, /operacao_fiscal/);
  assert.doesNotMatch(cancelar, /estoque_atual/);

  const acoes = resolverAcoesEmissaoFiscal({
    emissao: nfe55Autorizada,
    bloqueioCancelamentoOperacional: MENSAGEM_CANCELAMENTO_DEVOLUCAO_COM_SAIDA,
  });
  assert.equal(acoes.podeCancelar, false);
  assert.equal(acoes.podeCartaCorrecao, true);
  assert.equal(acoes.mensagemBloqueioCancelamento, MENSAGEM_CANCELAMENTO_DEVOLUCAO_COM_SAIDA);
});

test("H. cancelada não oferece cancelar nem CC-e, mas permite DANFE/XML", () => {
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: { ...nfe55Autorizada, status: "cancelada" },
  });
  assert.equal(acoes.podeCancelar, false);
  assert.equal(acoes.podeCartaCorrecao, false);
  assert.equal(acoes.podeBaixarPdf, true);
  assert.equal(acoes.podeBaixarXml, true);
  assert.equal(acoes.podeConsultar, true);
  assert.equal(acoes.podeReconciliar, false);

  const peloEvento = resolverAcoesEmissaoFiscal({
    emissao: nfe55Autorizada,
    statusEventoCancelamento: "sucesso",
  });
  assert.equal(peloEvento.podeCancelar, false);
  assert.equal(peloEvento.podeCartaCorrecao, false);
});

test("I. rejeitada não oferece CC-e nem cancelar", () => {
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: {
      ...nfe55Autorizada,
      status: "rejeitada",
      cstat: "225",
      motivo: "CFOP inválido para finalidade de devolução",
      protocolo: null,
    },
  });
  assert.equal(acoes.podeCancelar, false);
  assert.equal(acoes.podeCartaCorrecao, false);
  assert.equal(acoes.podeBaixarPdf, false);
  assert.equal(acoes.podeReconciliar, false);
});

test("J. aguardando reconciliação mostra Reconciliar e não retransmite", () => {
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: {
      ...nfe55Autorizada,
      status: "aguardando_reconciliacao",
      protocolo: null,
    },
  });
  assert.equal(acoes.podeReconciliar, true);
  assert.equal(acoes.podeRetransmitir, false);
  assert.equal(acoes.podeCancelar, false);
  assert.equal(acoes.podeCartaCorrecao, false);

  const emitir = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );
  assert.match(emitir, /claimTentativaEmissaoFiscal/);
  assert.match(emitir, /MENSAGEM_BLOQUEIO_RETRANSMISSAO/);
});

test("J2. conferência NF-e 55 não trata todo erro_comunicacao como reconciliação", () => {
  const pagina = fonte("app/vendas/[id]/nfe/page.tsx");
  const card = fonte("components/vendas/reconciliar-emissao-fiscal.tsx");
  const lista = fonte("components/fiscal/fiscal-documentos-lista.tsx");

  assert.match(pagina, /resolverApresentacaoEmissaoFiscal/);
  assert.match(pagina, /nao_transmitida/);
  assert.match(pagina, /retryVenda/);
  assert.match(card, /apresentacao\.titulo/);
  assert.match(card, /Tentar novamente/);
  assert.match(card, /Consultar Geranet/);
  assert.match(lista, /resolverApresentacaoEmissaoFiscal/);
  assert.match(lista, /Tentar novamente/);

  const trechoAmbigua = pagina.slice(
    pagina.indexOf("const ambigua"),
    pagina.indexOf("Segurança contra retransmissão")
  );
  assert.doesNotMatch(trechoAmbigua, /status === ["']erro_comunicacao["']/);
});

test("K. ações fiscais isolam empresa_id da empresa ativa", () => {
  const arquivo = fonte("app/api/fiscal/emissoes/[id]/arquivo/route.ts");
  const cancelar = fonte("app/api/fiscal/emissoes/[id]/cancelar/route.ts");
  const carta = fonte("app/api/fiscal/emissoes/[id]/carta-correcao/route.ts");
  const reconciliar = fonte("app/api/fiscal/emissoes/[id]/reconciliar/route.ts");

  for (const fonteRota of [arquivo, cancelar, carta, reconciliar]) {
    assert.match(fonteRota, /usuarios_empresas/);
    assert.match(fonteRota, /principal/);
    assert.match(fonteRota, /empresa_id/);
  }
});

test("L. venda e devolução usam o mesmo histórico/eventos", () => {
  const venda = fonte("app/vendas/[id]/page.tsx");
  const devolucao = fonte(
    "components/fiscal/entrada/devolucao-fornecedor-detalhe.tsx"
  );
  const historico = fonte("components/fiscal/emissao-fiscal-historico.tsx");

  assert.match(venda, /EmissaoFiscalAcoes/);
  assert.match(venda, /EmissaoFiscalHistorico/);
  assert.match(devolucao, /EmissaoFiscalAcoes/);
  assert.match(devolucao, /EmissaoFiscalHistorico/);
  assert.match(historico, /fiscal_emissao_eventos|rotuloTipoEventoFiscal/);
  assert.match(historico, /Tentativas fiscais/);
  assert.doesNotMatch(devolucao, /acoes-devolucao/);
});

test("lista fiscal não trata origem_id de devolução como venda", () => {
  const lista = fonte("components/fiscal/fiscal-documentos-lista.tsx");
  const pagina = fonte("app/fiscal/page.tsx");
  assert.doesNotMatch(lista, /vendaId/);
  assert.match(lista, /origemHref/);
  assert.match(pagina, /origem_tipo/);
  assert.match(pagina, /hrefOrigemEmissaoFiscal/);
  assert.equal(
    hrefOrigemEmissaoFiscal("devolucao_fornecedor", "abc"),
    "/fiscal/entradas/devolucoes/abc"
  );
  assert.equal(hrefOrigemEmissaoFiscal("venda", "abc"), "/vendas/abc");
  assert.equal(
    hrefOrigemEmissaoFiscal("operacao_fiscal", "abc"),
    "/fiscal/nfe/abc/editar"
  );
  assert.equal(rotuloOrigemEmissaoFiscal("devolucao_fornecedor"), "Abrir devolução");
  assert.equal(rotuloOrigemEmissaoFiscal("operacao_fiscal"), "Abrir NF-e");
});

test("impressão da CC-e volta para a origem da emissão", () => {
  const impressao = fonte("app/pdv/imprimir/carta-correcao/[eventoId]/page.tsx");
  assert.match(impressao, /origem_tipo/);
  assert.match(impressao, /hrefOrigemEmissaoFiscal/);
  assert.doesNotMatch(impressao, /\/vendas\/\$\{emissao\.origem_id\}/);
});

test("NFC-e 65 autorizada não oferece CC-e", () => {
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: { ...nfe55Autorizada, modelo: "65" },
  });
  assert.equal(acoes.podeCartaCorrecao, false);
  assert.equal(acoes.podeCancelar, true);
  assert.equal(acoes.podeBaixarPdf, true);
});

test("emissão da devolução não ganhou endpoint paralelo", () => {
  const emitir = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );
  assert.doesNotMatch(emitir, /\/api\/v1\/nfe\/cancelar/);
  assert.doesNotMatch(emitir, /carta-correcao/);
  assert.match(emitir, /p_origem_tipo:\s*"devolucao_fornecedor"/);
});
