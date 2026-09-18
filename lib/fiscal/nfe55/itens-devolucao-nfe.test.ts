import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import { saldoDevolvivelItem } from "@/lib/fiscal/entrada/devolucao-status";
import {
  hrefDevolverNotaEntrada,
  MENSAGEM_DEVOLUCAO_SELECIONE_ORIGEM,
  naturezaDevolucaoNoEmissor,
  tipoOperacaoEmitivelNestaTela,
} from "@/lib/fiscal/nfe55/defaults-natureza";

test("devolução no emissor não habilita item avulso; exige documento de origem", () => {
  assert.equal(tipoOperacaoEmitivelNestaTela("devolucao_fornecedor"), false);
  assert.equal(tipoOperacaoEmitivelNestaTela("devolucao_venda"), false);
  assert.equal(tipoOperacaoEmitivelNestaTela("venda"), true);
  assert.equal(naturezaDevolucaoNoEmissor("devolucao_fornecedor"), true);
  assert.equal(naturezaDevolucaoNoEmissor("venda"), false);

  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const painel = fonte("components/fiscal/nfe55/nfe-itens-devolucao-origem.tsx");
  const actionsOp = fonte("app/fiscal/nfe/operacoes-actions.ts");

  assert.match(form, /naturezaDevolucaoNoEmissor/);
  assert.match(form, /NfeItensDevolucaoOrigem/);
  assert.match(form, /podeEditar && !ehDevolucao/);
  assert.match(painel, /MENSAGEM_DEVOLUCAO_SELECIONE_ORIGEM/);
  assert.match(painel, /Selecionar nota de entrada/);
  assert.match(painel, /listarNotasEntradaParaDevolucao/);
  assert.match(painel, /hrefDevolverNotaEntrada/);
  assert.doesNotMatch(painel, /adicionarItemOperacaoFiscal/);
  assert.doesNotMatch(painel, /buscarProdutosOperacaoFiscal/);
  assert.match(actionsOp, /tipoOperacaoEmitivelNestaTela/);
  assert.match(
    actionsOp.slice(
      actionsOp.indexOf("export async function criarOperacaoFiscal"),
      actionsOp.indexOf("export async function salvarNaturezaOperacaoFiscal")
    ),
    /mensagemNaturezaNaoEmitivelNestaTela/
  );
});

test("venda continua permitindo busca e inclusão de item do cadastro", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  assert.match(form, /nfe-busca-produto/);
  assert.match(form, /adicionarItemOperacaoFiscal/);
  assert.match(form, /\+ Adicionar outro item/);
});

test("selecionar nota de entrada reusa o fluxo existente e a empresa da sessão", () => {
  assert.match(
    hrefDevolverNotaEntrada("doc-1", "nat-1"),
    /\/fiscal\/entradas\/doc-1\/devolver\?natureza=nat-1/
  );
  assert.equal(MENSAGEM_DEVOLUCAO_SELECIONE_ORIGEM.includes("documento fiscal de origem"), true);

  const listar = fonte("app/fiscal/entradas/devolucao-actions.ts").slice(
    fonte("app/fiscal/entradas/devolucao-actions.ts").indexOf(
      "export async function listarNotasEntradaParaDevolucao"
    ),
    fonte("app/fiscal/entradas/devolucao-actions.ts").indexOf(
      "export async function listarEntradasElegiveisDevolucao"
    )
  );
  assert.match(listar, /\.eq\("empresa_id", empresaId\)/);
  assert.match(listar, /\.eq\("status", "entrada_concluida"\)/);
  assert.match(listar, /registroPertenceAEmpresaAtiva/);
  assert.doesNotMatch(listar, /input\.empresaId|body\.empresa_id/);

  const devolver = fonte("app/fiscal/entradas/[id]/devolver/page.tsx");
  assert.match(devolver, /searchParams/);
  assert.match(devolver, /query\.natureza/);
  assert.match(devolver, /devolucao_fornecedor/);
  assert.match(devolver, /saldoDevolvivelItem/);
  assert.match(devolver, /\.eq\("empresa_id", empresaId\)/);
});

test("quantidade da devolução não ultrapassa o saldo da nota original", () => {
  const primeira = saldoDevolvivelItem({
    quantidadeEntradaEfetivada: 10,
    reservas: [],
  });
  assert.equal(primeira, 10);

  const segunda = saldoDevolvivelItem({
    quantidadeEntradaEfetivada: 10,
    reservas: [{ quantidade: 4, status: "autorizada" }],
  });
  assert.equal(segunda, 6);

  const actions = fonte("app/fiscal/entradas/devolucao-actions.ts");
  assert.match(actions, /MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE/);
  assert.match(actions, /saldoDevolvivelItem/);
  const emitir = fonte("app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts");
  assert.match(emitir, /notaFiscalReferencia|chave_documento_origem/);
  assert.match(emitir, /fin_nfe/);
});
