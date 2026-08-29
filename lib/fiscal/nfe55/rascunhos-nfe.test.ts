import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";

import {
  ABA_RASCUNHOS_NFE,
  STATUS_RASCUNHO_NFE55,
  hrefContinuarRascunhoNfe55,
  identificacaoRascunhoNfe55,
  montarItemListaRascunhoNfe55,
  statusEhRascunhoNfe55,
} from "./rascunhos-nfe";

test("lista de rascunhos NF-e aceita só status ainda não emitidos", () => {
  assert.deepEqual(STATUS_RASCUNHO_NFE55, [
    "rascunho",
    "pronta_para_verificacao",
    "pronta_para_emissao",
  ]);
  assert.equal(statusEhRascunhoNfe55("rascunho"), true);
  assert.equal(statusEhRascunhoNfe55("pronta_para_emissao"), true);
  assert.equal(statusEhRascunhoNfe55("autorizada"), false);
  assert.equal(statusEhRascunhoNfe55("rejeitada"), false);
  assert.equal(statusEhRascunhoNfe55("cancelada"), false);
  assert.equal(statusEhRascunhoNfe55("enviando"), false);
});

test("identificação usa série/número quando já existem no rascunho", () => {
  assert.equal(
    identificacaoRascunhoNfe55({ id: "abc", serie: 1, numero: 44 }),
    "1/44"
  );
  assert.equal(
    identificacaoRascunhoNfe55({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }),
    "Rascunho aaaaaaaa"
  );
});

test("montar item ignora autorizado, rejeitado, NFC-e implícita por status e calcula total líquido", () => {
  assert.equal(
    montarItemListaRascunhoNfe55({
      id: "op-1",
      status: "autorizada",
    }),
    null
  );
  assert.equal(
    montarItemListaRascunhoNfe55({
      id: "op-2",
      status: "rejeitada",
    }),
    null
  );

  const item = montarItemListaRascunhoNfe55({
    id: "op-3",
    status: "rascunho",
    naturezaDescricao: "Venda",
    snapshotFiscal: {
      serie: 2,
      numero: 10,
      totais_nota: { desconto: 5, frete: 2, seguro: 0, outro: 0 },
    },
    destinatarioNome: "Cliente A",
    usuarioNome: "Rafael",
    quantidadeItens: 3,
    totalProdutos: 100,
    createdAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-08-28T13:00:00.000Z",
  });
  assert.ok(item);
  assert.equal(item?.identificacao, "2/10");
  assert.equal(item?.valorTotal, 97);
  assert.equal(item?.href, hrefContinuarRascunhoNfe55("op-3"));
  assert.equal(item?.statusRotulo, "Rascunho");
});

test("Vendas ganha aba Rascunhos NF-e no mesmo padrão de Pedidos Online", () => {
  const tabs = fonte("components/vendas/vendas-module-tabs.tsx");
  const pagina = fonte("app/vendas/rascunhos-nfe/page.tsx");
  const vendas = fonte("app/vendas/page.tsx");
  const workspace = fonte("components/vendas/nfe-rascunhos-workspace.tsx");

  assert.match(tabs, /Rascunhos NF-e/);
  assert.match(tabs, /\/vendas\/rascunhos-nfe/);
  assert.match(tabs, /rascunhosNfe/);
  assert.match(pagina, /from\("fiscal_operacoes"\)/);
  assert.match(pagina, /\.eq\("empresa_id"/);
  assert.match(pagina, /STATUS_RASCUNHO_NFE55/);
  assert.match(pagina, /filtrarRegistrosDaEmpresaAtiva/);
  assert.match(vendas, /aba === ABA_RASCUNHOS_NFE/);
  assert.match(vendas, /redirect\(HREF_RASCUNHOS_NFE\)/);
  assert.match(workspace, /Continuar/);
  assert.doesNotMatch(workspace, /excluirRascunho|delete\(/);
  assert.equal(ABA_RASCUNHOS_NFE, "rascunhos-nfe");
});

test("tela da NF-e remove Validar da UI e Emitir valida antes de transmitir", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  assert.match(form, /Salvar como rascunho/);
  assert.match(form, />\s*Emitir\s*</);
  assert.match(form, /validarNfe\(\)/);
  assert.match(form, /HREF_RASCUNHOS_NFE/);
  assert.match(form, /MENSAGEM_SAIR_NFE_COM_ALTERACOES/);
  assert.doesNotMatch(form, /Validar NF-e/);
  assert.doesNotMatch(form, /acionarValidar/);
  const emitir = form.slice(form.indexOf("function emitir("));
  assert.ok(
    emitir.indexOf("validarNfe()") < emitir.indexOf("nfe-emitir-venda"),
    "Emitir deve validar antes da transmissão da venda"
  );
  assert.ok(
    emitir.indexOf("validarNfe()") < emitir.indexOf("nfe-emitir-operacao"),
    "Emitir deve validar antes da transmissão da operação"
  );
  assert.match(form, /sticky top-14/);
  assert.match(form, /lg:top-12/);
});
