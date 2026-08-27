import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import {
  MENSAGEM_CONTROLE_VALIDADE_INATIVO,
  MENSAGEM_LOTE_FABRICACAO_POSTERIOR,
  alocarQuantidadeFefo,
  lotesDaEmpresaProduto,
  mensagemLotesUltrapassamEstoque,
  ordenarLotesFefo,
  resumoDistribuicaoLotes,
  rotuloStatusValidade,
  somarQuantidadesLotes,
  statusValidadeLote,
  validarDadosLoteProduto,
  validarQuantidadeContraEstoque,
} from "./lotes";
import { empresaA, empresaB, produtoA, produtoB } from "@/lib/multiempresa/cenario";

const HOJE = "2026-08-27";

test("status de validade: vencido, 7, 30, 60 e normal", () => {
  assert.equal(statusValidadeLote("2026-08-26", HOJE), "vencido");
  assert.equal(statusValidadeLote("2026-08-27", HOJE), "vence_7");
  assert.equal(statusValidadeLote("2026-09-03", HOJE), "vence_7");
  assert.equal(statusValidadeLote("2026-09-04", HOJE), "vence_30");
  assert.equal(statusValidadeLote("2026-09-26", HOJE), "vence_30");
  assert.equal(statusValidadeLote("2026-09-27", HOJE), "vence_60");
  assert.equal(statusValidadeLote("2026-10-26", HOJE), "vence_60");
  assert.equal(statusValidadeLote("2026-10-27", HOJE), "normal");
  assert.equal(rotuloStatusValidade("vence_7"), "Vence em até 7 dias");
});

test("lote exige código, validade e fabricação anterior ou igual", () => {
  assert.equal(
    validarDadosLoteProduto({
      codigoLote: "",
      dataValidade: "2026-09-01",
      quantidade: 1,
    }),
    "Informe o código do lote."
  );
  assert.equal(
    validarDadosLoteProduto({
      codigoLote: "L1",
      dataValidade: "",
      quantidade: 1,
    }),
    "Informe a data de validade do lote."
  );
  assert.equal(
    validarDadosLoteProduto({
      codigoLote: "L1",
      dataFabricacao: "2026-09-02",
      dataValidade: "2026-09-01",
      quantidade: 1,
    }),
    MENSAGEM_LOTE_FABRICACAO_POSTERIOR
  );
  assert.equal(
    validarDadosLoteProduto({
      codigoLote: "L1",
      dataFabricacao: "2026-08-01",
      dataValidade: "2026-09-01",
      quantidade: 2,
    }),
    null
  );
});

test("FEFO ordena pelo lote que vence primeiro", () => {
  const ordenados = ordenarLotesFefo([
    {
      id: "c",
      data_validade: "2026-12-01",
      created_at: "2026-01-01T00:00:00Z",
      quantidade: 5,
    },
    {
      id: "a",
      data_validade: "2026-09-01",
      created_at: "2026-02-01T00:00:00Z",
      quantidade: 3,
    },
    {
      id: "b",
      data_validade: "2026-09-01",
      created_at: "2026-01-01T00:00:00Z",
      quantidade: 4,
    },
  ]);
  assert.deepEqual(
    ordenados.map((lote) => lote.id),
    ["b", "a", "c"]
  );

  const alocacao = alocarQuantidadeFefo(
    [
      {
        id: "vencido",
        data_validade: "2026-08-01",
        created_at: "2026-01-01T00:00:00Z",
        quantidade: 10,
      },
      {
        id: "proximo",
        data_validade: "2026-09-01",
        created_at: "2026-01-01T00:00:00Z",
        quantidade: 4,
      },
      {
        id: "depois",
        data_validade: "2026-12-01",
        created_at: "2026-01-01T00:00:00Z",
        quantidade: 8,
      },
    ],
    6,
    { referencia: HOJE }
  );
  assert.deepEqual(alocacao, [
    { loteId: "proximo", quantidade: 4 },
    { loteId: "depois", quantidade: 2 },
  ]);
});

test("cadastro tem aba Validade e lotes separados do produto", () => {
  const form = fonte("app/produtos/produto-cadastro-form.tsx");
  const aba = fonte("app/produtos/produto-validade-aba.tsx");
  const actions = fonte("app/produtos/actions.ts");
  const migracao = fonte(
    "supabase/migrations/20260827120000_produtos_validade_lotes.sql"
  );

  assert.match(form, /label: "Validade"/);
  assert.match(form, /ProdutoValidadeAba/);
  assert.match(aba, /Controlar validade por lotes/);
  assert.match(aba, /name="controlar_validade"/);
  assert.match(aba, /Estoque atual/);
  assert.match(aba, /Quantidade vinculada a lotes/);
  assert.match(aba, /Saldo sem lote/);
  assert.match(actions, /controlar_validade: dados\.controlarValidade/);
  assert.match(actions, /from\("estoque_lotes"\)/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.match(actions, /validarQuantidadeContraEstoque/);
  assert.match(actions, /MENSAGEM_CONTROLE_VALIDADE_INATIVO/);
  assert.equal(
    MENSAGEM_CONTROLE_VALIDADE_INATIVO,
    "Ative o controle de validade antes de cadastrar lotes."
  );
  assert.match(migracao, /controlar_validade boolean NOT NULL DEFAULT false/);
  assert.match(migracao, /CREATE TABLE IF NOT EXISTS public\.estoque_lotes/);
  assert.doesNotMatch(migracao, /ADD COLUMN .*data_validade/);
  assert.match(
    aba,
    /Os lotes distribuem o[\s\S]*estoque já existente/
  );
});

test("PDV continua baixando estoque_atual e não estoque_lotes", () => {
  const baixa = fonte(
    "supabase/migrations/20260825200000_pdv_permitir_venda_sem_estoque.sql"
  );
  const actions = fonte("app/produtos/actions.ts");
  const lotes = actions.slice(
    actions.indexOf("async function carregarEstoqueAtualProduto"),
    actions.indexOf("export async function atualizarPublicacaoCatalogo")
  );
  assert.match(baixa, /FROM public\.estoque_atual AS ea/);
  assert.match(baixa, /UPDATE public\.estoque_atual/);
  assert.doesNotMatch(baixa, /estoque_lotes/);
  assert.match(lotes, /from\("estoque_atual"\)/);
  assert.match(lotes, /\.select\("quantidade"\)/);
  assert.doesNotMatch(
    lotes,
    /from\("estoque_atual"\)[\s\S]{0,120}\.(update|insert|delete)\(/
  );
});

test("criar lote não pode ultrapassar o estoque atual", () => {
  const lotes = [
    { id: "a", quantidade: 1, empresa_id: empresaA, produto_id: produtoA },
  ];
  assert.equal(
    validarQuantidadeContraEstoque({
      estoqueAtual: 2,
      lotes,
      quantidadeNova: 1,
    }),
    null
  );
  assert.equal(
    validarQuantidadeContraEstoque({
      estoqueAtual: 2,
      lotes: [],
      quantidadeNova: 5,
    }),
    mensagemLotesUltrapassamEstoque(2)
  );
  assert.equal(
    mensagemLotesUltrapassamEstoque(4),
    "A quantidade dos lotes não pode ultrapassar o estoque atual. Estoque disponível para vincular a lotes: 4."
  );
});

test("editar lote desconsidera a quantidade antiga do próprio lote", () => {
  const lotes = [
    { id: "a", quantidade: 1 },
    { id: "b", quantidade: 1 },
  ];
  assert.equal(
    validarQuantidadeContraEstoque({
      estoqueAtual: 2,
      lotes,
      quantidadeNova: 1,
      loteId: "a",
    }),
    null
  );
  assert.equal(
    validarQuantidadeContraEstoque({
      estoqueAtual: 2,
      lotes,
      quantidadeNova: 2,
      loteId: "a",
    }),
    mensagemLotesUltrapassamEstoque(1)
  );

  const resumo = resumoDistribuicaoLotes({
    estoqueAtual: 10,
    lotes: [
      { id: "a", quantidade: 6 },
    ],
  });
  assert.equal(resumo.estoqueAtual, 10);
  assert.equal(resumo.vinculado, 6);
  assert.equal(resumo.saldoSemLote, 4);
  assert.equal(
    resumoDistribuicaoLotes({
      estoqueAtual: 10,
      lotes: [{ id: "a", quantidade: 6 }],
      ignorarLoteId: "a",
    }).disponivel,
    10
  );
});

test("soma de lotes isola empresa e produto", () => {
  const lotes = [
    {
      id: "a",
      empresa_id: empresaA,
      produto_id: produtoA,
      quantidade: 6,
    },
    {
      id: "b",
      empresa_id: empresaB,
      produto_id: produtoB,
      quantidade: 99,
    },
  ];
  const daEmpresaA = lotesDaEmpresaProduto(lotes, empresaA, produtoA);
  assert.equal(somarQuantidadesLotes(daEmpresaA), 6);
  assert.equal(
    validarQuantidadeContraEstoque({
      estoqueAtual: 10,
      lotes: daEmpresaA,
      quantidadeNova: 5,
    }),
    mensagemLotesUltrapassamEstoque(4)
  );
  assert.equal(
    lotesDaEmpresaProduto(lotes, empresaA, produtoB).length,
    0
  );
});
