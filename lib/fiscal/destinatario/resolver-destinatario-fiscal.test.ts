import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  alertaNaoContribuinteConsumidorFinal,
  defaultConsumidorFinalOperacao,
  escolherSnapshotDestinatario,
  flagConsumidorFinal,
  ieDestinatarioParaGeranet,
  indicadorIeParaContribuinteIcms,
  lerSnapshotDestinatarioFiscal,
  modeloDocumentoNfeOperacao,
  normalizarIndicadorIeDestinatario,
  origemSnapshotAInicializar,
  resolverDestinatarioFiscalDaOrigem,
  resolverDestinatarioFiscalNfe,
  snapshotDestinatarioParaPersistir,
} from "./resolver-destinatario-fiscal";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

test("1. PDV / PF não contribuinte varejo resolve 9+1 e persiste no snapshot", () => {
  const resolvido = resolverDestinatarioFiscalDaOrigem({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "pdv",
    contribuinteIcms: false,
    indicadorIeCadastro: "9",
    consumidorFinalCadastro: false,
  });
  assert.equal(resolvido.indicadorIEdestinatario, "9");
  assert.equal(resolvido.consumidorFinal, "1");
  const persistir = snapshotDestinatarioParaPersistir({
    consumidorFinal: true,
    origem: origemSnapshotAInicializar({ origemVenda: "pdv" }),
    indicadorIe: resolvido.indicadorIEdestinatario,
  });
  assert.equal(persistir.consumidor_final, true);
  assert.equal(persistir.consumidor_final_origem, "origem_pdv");
  assert.equal(persistir.indicador_ie_destinatario, "9");
  const depois = resolverDestinatarioFiscalDaOrigem({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "pdv",
    snapshotVenda: persistir,
    contribuinteIcms: false,
    consumidorFinalCadastro: false,
  });
  assert.deepEqual(depois, resolvido);
});

test("2. PJ contribuinte / revenda permanece 1+0 quando a operação grava não consumidor final", () => {
  const resolvido = resolverDestinatarioFiscalNfe({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "nfe_manual",
    contribuinteIcms: true,
    indicadorIeCadastro: "1",
    consumidorFinalSnapshot: false,
    consumidorFinalDefinidoNoSnapshot: true,
  });
  assert.equal(resolvido.indicadorIEdestinatario, "1");
  assert.equal(resolvido.consumidorFinal, "0");
});

test("3. PJ contribuinte / uso próprio permite 1+1", () => {
  const resolvido = resolverDestinatarioFiscalNfe({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "nfe_manual",
    contribuinteIcms: true,
    indicadorIeCadastro: "1",
    consumidorFinalSnapshot: true,
    consumidorFinalDefinidoNoSnapshot: true,
  });
  assert.equal(resolvido.indicadorIEdestinatario, "1");
  assert.equal(resolvido.consumidorFinal, "1");
  assert.equal(
    alertaNaoContribuinteConsumidorFinal({
      modelo: "55",
      tipoOperacaoInterno: "venda",
      indicadorIEdestinatario: "1",
      consumidorFinal: "1",
      ufDestinatario: "MT",
    }),
    null
  );
});

test("4. Isento persiste e resolve exatamente 2", () => {
  assert.equal(normalizarIndicadorIeDestinatario("2"), "2");
  assert.equal(indicadorIeParaContribuinteIcms("2"), false);
  const snap = snapshotDestinatarioParaPersistir({
    consumidorFinal: true,
    origem: "operacao",
    indicadorIe: "2",
  });
  const lido = lerSnapshotDestinatarioFiscal(snap);
  assert.equal(lido.indicadorIe, "2");
  const resolvido = resolverDestinatarioFiscalDaOrigem({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "nfe_manual",
    snapshotOperacao: snap,
    contribuinteIcms: false,
  });
  assert.equal(resolvido.indicadorIEdestinatario, "2");
  assert.equal(ieDestinatarioParaGeranet({
    indicadorIEdestinatario: "2",
    inscricaoEstadual: "",
  }), "ISENTO");
});

test("5. alteração manual na operação não volta para o cadastro", () => {
  const snapshot = snapshotDestinatarioParaPersistir({
    consumidorFinal: false,
    origem: "operacao",
    indicadorIe: "9",
  });
  const resolvido = resolverDestinatarioFiscalDaOrigem({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "nfe_manual",
    snapshotOperacao: snapshot,
    contribuinteIcms: false,
    consumidorFinalCadastro: true,
  });
  assert.equal(resolvido.consumidorFinal, "0");
  assert.equal(resolvido.indicadorIEdestinatario, "9");
});

test("6. venda PDV sem formulário fiscal ainda assim usa indFinal 1", () => {
  const resolvido = resolverDestinatarioFiscalDaOrigem({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "pdv",
    contribuinteIcms: false,
    consumidorFinalCadastro: false,
  });
  assert.equal(resolvido.indicadorIEdestinatario, "9");
  assert.equal(resolvido.consumidorFinal, "1");
  assert.equal(
    defaultConsumidorFinalOperacao({
      modelo: "55",
      tipoOperacaoInterno: "venda",
      origemVenda: "pdv",
    }),
    true
  );
});

test("7. snapshot da empresa A não é escolhido no lugar do da B", () => {
  const snapA = snapshotDestinatarioParaPersistir({
    consumidorFinal: true,
    origem: "operacao",
    indicadorIe: "9",
  });
  const snapB = snapshotDestinatarioParaPersistir({
    consumidorFinal: false,
    origem: "operacao",
    indicadorIe: "1",
  });
  const escolhidoB = escolherSnapshotDestinatario({
    snapshotOperacao: snapB,
    snapshotVenda: snapA,
  });
  assert.equal(escolhidoB.consumidorFinal, false);
  assert.equal(escolhidoB.indicadorIe, "1");
});

test("NFC-e 65 continua consumidor final 1 mesmo com cadastro false", () => {
  const resolvido = resolverDestinatarioFiscalNfe({
    modelo: "65",
    tipoOperacaoInterno: "venda",
    origemVenda: "pdv",
    contribuinteIcms: false,
    consumidorFinalCadastro: false,
  });
  assert.equal(resolvido.consumidorFinal, "1");
});

test("transferência não presume consumidor final", () => {
  const resolvido = resolverDestinatarioFiscalNfe({
    modelo: "55",
    tipoOperacaoInterno: "transferencia",
    contribuinteIcms: true,
    indicadorIeCadastro: "1",
  });
  assert.equal(resolvido.consumidorFinal, "0");
});

test("legado contribuinte_icms true/false vira 1/9, nunca inventa 2", () => {
  assert.equal(normalizarIndicadorIeDestinatario(null, true), "1");
  assert.equal(normalizarIndicadorIeDestinatario(null, false), "9");
  assert.equal(normalizarIndicadorIeDestinatario("x", false), "9");
});

test("9+0 vira alerta, não trava universal de emissão", () => {
  const alerta = alertaNaoContribuinteConsumidorFinal({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    indicadorIEdestinatario: "9",
    consumidorFinal: "0",
    ufDestinatario: "MT",
  });
  assert.ok(alerta);
  assert.equal(alerta?.codigo, "consumidor_final");
});

test("snapshot definido tem precedência sobre cadastro, inclusive origem cadastro antiga", () => {
  const snap = lerSnapshotDestinatarioFiscal({
    consumidor_final: true,
    consumidor_final_origem: "cadastro",
    indicador_ie_destinatario: "9",
  });
  assert.equal(snap.consumidorFinalDefinido, true);
  const resolvido = resolverDestinatarioFiscalNfe({
    modelo: "55",
    tipoOperacaoInterno: "venda",
    origemVenda: "pdv",
    contribuinteIcms: false,
    consumidorFinalCadastro: false,
    consumidorFinalSnapshot: snap.consumidorFinal,
    consumidorFinalDefinidoNoSnapshot: snap.consumidorFinalDefinido,
    indicadorIeSnapshot: snap.indicadorIe,
  });
  assert.equal(resolvido.consumidorFinal, "1");
});

test("Nova NF-e permanece modelo 55 independente de consumidor final", () => {
  assert.equal(
    modeloDocumentoNfeOperacao({
      tipoOperacaoInterno: "venda",
      consumidorFinal: true,
    }),
    "55"
  );
});

test("flag e IE para payload", () => {
  assert.equal(flagConsumidorFinal("0"), false);
  assert.equal(flagConsumidorFinal("1"), true);
  assert.equal(
    ieDestinatarioParaGeranet({
      indicadorIEdestinatario: "1",
      inscricaoEstadual: "13.885.672-9",
    }),
    "13.885.672-9"
  );
  assert.equal(
    ieDestinatarioParaGeranet({
      indicadorIEdestinatario: "9",
      inscricaoEstadual: "123",
    }),
    ""
  );
});

test("Validar e Emitir compartilham o mesmo resolver e persistência de snapshot", () => {
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const emitirOp = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const conferir = fonte("lib/fiscal/operacoes/verificar-operacao.ts");
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const paginaVenda = fonte("app/vendas/[id]/nfe/page.tsx");

  assert.match(actions, /resolverDestinatarioFiscalDaOrigem/);
  assert.match(emitirVenda, /resolverDestinatarioFiscalDaOrigem/);
  assert.match(emitirVenda, /snapshotDestinatarioParaPersistir/);
  assert.match(emitirVenda, /chamarGeranet/);
  assert.doesNotMatch(emitirVenda, /return erro\(\s*\n?\s*pendenciaDestinatario/);
  assert.match(emitirOp, /resolverDestinatarioFiscalDaOrigem/);
  assert.match(conferir, /alertaNaoContribuinteConsumidorFinal/);
  assert.doesNotMatch(conferir, /pendencias\.push\(pendenciaDestinatario\)/);
  assert.match(form, /Informações fiscais da operação/);
  assert.match(form, /option value="2"/);
  assert.match(paginaVenda, /resolverDestinatarioFiscalDaOrigem/);
  assert.doesNotMatch(emitirVenda, /consumidorFinal:\s*"1"/);
});

test("rotas de teste/homologação passam pelo resolver central", () => {
  const nfeAvulso = fonte("app/api/fiscal/geranet/nfe-emitir/route.ts");
  const nfe55 = fonte("app/api/fiscal/geranet/nfe55-emitir/route.ts");
  const nfceAvulso = fonte("app/api/fiscal/geranet/nfce-emitir/route.ts");
  const nfceBuilder = fonte("lib/fiscal/geranet/montar-payload-nfce.ts");
  assert.match(nfeAvulso, /resolverDestinatarioFiscalNfe/);
  assert.match(nfe55, /resolverDestinatarioFiscalNfe/);
  assert.match(nfceAvulso, /resolverDestinatarioFiscalNfe/);
  assert.match(nfceBuilder, /resolverDestinatarioFiscalNfe/);
});

test("consulta de snapshot/venda sempre filtra empresa_id", () => {
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  assert.match(emitirVenda, /\.eq\(\s*"empresa_id"/);
  assert.match(actions, /registroPertenceAEmpresaAtiva/);
});
