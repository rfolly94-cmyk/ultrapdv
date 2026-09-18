import assert from "node:assert/strict";
import { test } from "node:test";

import { MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL } from "@/lib/fiscal/operacoes/status-operacao";
import { fonte } from "@/lib/multiempresa/fonte";

import {
  ABA_RASCUNHOS_NFE,
  MENSAGEM_CONFIRMAR_EXCLUSAO_RASCUNHO_NFE,
  MENSAGEM_NFE_AUTORIZADA_NAO_EXCLUI,
  MENSAGEM_RASCUNHO_COM_ESTOQUE_NAO_EXCLUI,
  MENSAGEM_RASCUNHO_NFE_NAO_EXCLUIVEL,
  STATUS_RASCUNHO_NFE55,
  hrefContinuarRascunhoNfe55,
  identificacaoRascunhoNfe55,
  montarItemListaRascunhoNfe55,
  motivoImpedeExcluirRascunhoNfe55,
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
  assert.match(workspace, /Excluir/);
  assert.match(workspace, /<th>Ações<\/th>/);
  assert.match(workspace, /RowActions/);
  assert.match(workspace, /href: item\.href/);
  assert.match(workspace, /excluirRascunhoOperacaoFiscal/);
  assert.match(workspace, /MENSAGEM_CONFIRMAR_EXCLUSAO_RASCUNHO_NFE/);
  assert.doesNotMatch(workspace, /editHref/);
  assert.doesNotMatch(workspace, /updv-btn-row/);
  assert.doesNotMatch(workspace, /sticky right-0/);
  assert.ok(
    workspace.indexOf("<th>Ações</th>") < workspace.indexOf("<th>Rascunho</th>"),
    "Ações deve ser a primeira coluna"
  );
  assert.equal(ABA_RASCUNHOS_NFE, "rascunhos-nfe");
});

test("Continuar reabre o rascunho existente sem criar outro", () => {
  assert.equal(
    hrefContinuarRascunhoNfe55("op-9"),
    "/fiscal/nfe/op-9/editar"
  );
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const continuar = fonte("lib/fiscal/nfe55/rascunhos-nfe.ts");
  assert.match(continuar, /hrefEdicaoOperacaoFiscal/);
  assert.doesNotMatch(continuar, /criarOperacaoFiscal/);
  const excluir = actions.slice(
    actions.indexOf("export async function excluirRascunhoOperacaoFiscal")
  );
  assert.doesNotMatch(excluir, /criarOperacaoFiscal/);
  assert.doesNotMatch(excluir, /insert\(/);
});

test("Excluir rascunho só apaga o rascunho da empresa ativa", () => {
  assert.equal(
    motivoImpedeExcluirRascunhoNfe55({ status: "rascunho" }),
    null
  );
  assert.equal(
    motivoImpedeExcluirRascunhoNfe55({ status: "pronta_para_emissao" }),
    null
  );
  assert.equal(
    motivoImpedeExcluirRascunhoNfe55({ status: "autorizada" }),
    MENSAGEM_NFE_AUTORIZADA_NAO_EXCLUI
  );
  assert.equal(
    motivoImpedeExcluirRascunhoNfe55({ status: "cancelada" }),
    MENSAGEM_RASCUNHO_NFE_NAO_EXCLUIVEL
  );
  assert.equal(
    motivoImpedeExcluirRascunhoNfe55({
      status: "rascunho",
      saidaEstoqueProcessadaAt: "2026-08-30T12:00:00.000Z",
    }),
    MENSAGEM_RASCUNHO_COM_ESTOQUE_NAO_EXCLUI
  );
  assert.equal(
    motivoImpedeExcluirRascunhoNfe55({
      status: "rascunho",
      emissao: { status: "autorizada" },
    }),
    MENSAGEM_DOCUMENTO_FISCAL_NAO_EDITAVEL
  );
  assert.equal(MENSAGEM_CONFIRMAR_EXCLUSAO_RASCUNHO_NFE, "Deseja excluir este rascunho de NF-e?");

  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const excluir = actions.slice(
    actions.indexOf("export async function excluirRascunhoOperacaoFiscal")
  );
  assert.match(excluir, /getContexto\(\)/);
  assert.match(excluir, /\.eq\("empresa_id", empresaId\)/);
  assert.match(excluir, /registroPertenceAEmpresaAtiva/);
  assert.match(excluir, /motivoImpedeExcluirRascunhoNfe55/);
  assert.match(excluir, /from\("fiscal_operacoes"\)/);
  assert.match(excluir, /\.delete\(\)/);
  assert.doesNotMatch(excluir, /empresa_id: input/);
  assert.doesNotMatch(excluir, /from\("vendas"\)/);
  assert.doesNotMatch(excluir, /from\("caixa/);
  assert.doesNotMatch(excluir, /carteira/);
  assert.doesNotMatch(excluir, /createAdminClient/);
  assert.doesNotMatch(excluir, /rpc_confirmar_saida/);
  assert.doesNotMatch(excluir, /rpc_finalizar_venda/);

  const migracao = fonte(
    "supabase/migrations/20260830120000_fiscal_operacoes_delete_rascunho.sql"
  );
  assert.match(migracao, /fiscal_operacoes_delete_empresa/);
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migracao, /status IN/);
  assert.match(migracao, /rascunho/);
  assert.match(migracao, /saida_estoque_processada_at IS NULL/);
  assert.doesNotMatch(migracao, /service_role/);
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
