import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { test } from "node:test";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_FATOR_CONVERSAO_OBRIGATORIO,
  MENSAGEM_VINCULO_CONFLITANTE,
} from "./mensagens";
import { sugerirProdutoEntrada } from "./sugerir-produto";
import {
  fatorConversaoPodeConfirmar,
  quantidadeEfetivaEstoque,
  reconhecerItemEntrada,
  unidadesEntradaDiferentes,
  type VinculoFornecedorProduto,
} from "./vinculo-fornecedor";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const migracao = fonte(
  "supabase/migrations/20260817280000_fornecedores_produtos_vinculos.sql"
);
const actions = fonte("app/fiscal/entradas/actions.ts");
const ui = fonte("components/fiscal/entrada/entrada-detalhe.tsx");
const page = fonte("app/fiscal/entradas/[id]/page.tsx");

const EMPRESA_A = "emp-a";
const EMPRESA_B = "emp-b";
const FORN_ABC = "forn-abc";
const FORN_XYZ = "forn-xyz";

const produtosA = [
  {
    id: "prod-a",
    empresa_id: EMPRESA_A,
    codigo: "5207",
    codigo_barras: "7890000000001",
    nome: "Fronta A32",
    unidade_medida: "UN",
  },
  {
    id: "prod-c",
    empresa_id: EMPRESA_A,
    codigo: "5300",
    codigo_barras: "7890000000099",
    nome: "Bateria A56",
    unidade_medida: "UN",
  },
];

const vinculoAbc001: VinculoFornecedorProduto = {
  id: "v1",
  empresa_id: EMPRESA_A,
  fornecedor_id: FORN_ABC,
  produto_id: "prod-a",
  codigo_produto_fornecedor: "001",
  ean_fornecedor: "7890000000001",
  fator_conversao: 1,
  ativo: true,
};

test("A. primeira compra: item desconhecido fica pendente até o usuário vincular", () => {
  const r = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "001",
    ean: "000",
    descricao: "Tela A32",
    vinculos: [],
    produtos: produtosA,
  });
  assert.equal(r.origem, "novo");
  assert.equal(r.autoVincular, false);
  assert.equal(r.produtoId, null);
  assert.match(actions, /upsertVinculoFornecedor/);
  assert.match(actions, /fornecedores_produtos_vinculos/);
});

test("B. segunda compra: mesmo fornecedor + cProd seleciona automaticamente", () => {
  const r = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "001",
    ean: "",
    descricao: "Tela A32",
    vinculos: [vinculoAbc001],
    produtos: produtosA,
  });
  assert.equal(r.origem, "vinculo_salvo");
  assert.equal(r.autoVincular, true);
  assert.equal(r.produtoId, "prod-a");
  assert.match(actions, /aplicarVinculosConhecidos/);
  assert.match(page, /aplicarVinculosConhecidos/);
});

test("C. mesmo cProd de outro fornecedor não herda o vínculo", () => {
  const r = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_XYZ,
    codigoFornecedor: "001",
    ean: "",
    descricao: "Tela A32",
    vinculos: [vinculoAbc001],
    produtos: produtosA,
  });
  assert.equal(r.autoVincular, false);
  assert.notEqual(r.produtoId, "prod-a");
  assert.equal(r.origem, "novo");
});

test("D. multiempresa: Empresa B não reutiliza vínculo da Empresa A", () => {
  const r = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_B,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "001",
    ean: "",
    descricao: "Tela A32",
    vinculos: [vinculoAbc001],
    produtos: [
      { ...produtosA[0], empresa_id: EMPRESA_B, id: "prod-b" },
    ],
  });
  assert.equal(r.autoVincular, false);
  assert.equal(r.produtoId, null);
  assert.equal(
    registroPertenceAEmpresaAtiva(vinculoAbc001, EMPRESA_B),
    false
  );
  assert.match(migracao, /uq_forn_prod_vinculo_cprod/);
  assert.match(
    migracao,
    /unique \(empresa_id,\s*fornecedor_id,\s*codigo_produto_fornecedor\)/
  );
});

test("E. produto novo: cadastro com estoque 0 e código automático, sem cProd interno", () => {
  const criar = actions.slice(
    actions.indexOf("export async function criarProdutoEVincularItem")
  );
  assert.match(criar, /p_estoque_inicial: 0/);
  assert.match(criar, /p_codigo: ""/);
  assert.match(criar, /p_grupo_fiscal_id: null/);
  assert.doesNotMatch(criar, /codigo_fornecedor.*p_codigo/);
  assert.match(criar, /produtos_fiscal/);
  assert.match(criar, /ncm/);
  assert.match(criar, /cest/);
  assert.doesNotMatch(criar, /csosn|cst_pis|cst_cofins|cfop_venda/);
});

test("F. nota mista: só confirma depois de todos vinculados; uma RPC movimenta todos", () => {
  const conhecidos = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "001",
    vinculos: [vinculoAbc001],
    produtos: produtosA,
  });
  const novo = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "003",
    descricao: "Bateria A56 nova",
    vinculos: [vinculoAbc001],
    produtos: produtosA,
  });
  assert.equal(conhecidos.autoVincular, true);
  assert.equal(novo.origem, "novo");
  assert.match(actions, /rpc_confirmar_entrada_nfe/);
  assert.match(ui, /Todos os produtos vinculados/);
  const rpc = migracao.slice(migracao.indexOf("rpc_confirmar_entrada_nfe"));
  assert.match(rpc, /for v_item in/);
  assert.doesNotMatch(
    actions.slice(
      actions.indexOf("export async function vincularItemEntrada"),
      actions.indexOf("export async function criarProdutoEVincularItem")
    ),
    /rpc_confirmar_entrada_nfe/
  );
});

test("G. estoque anterior soma, não substitui", () => {
  const rpc = migracao.slice(migracao.indexOf("rpc_confirmar_entrada_nfe"));
  assert.match(rpc, /v_atual := v_anterior \+ v_qtd_estoque/);
  assert.doesNotMatch(rpc, /set quantidade = v_qtd_estoque/);
  assert.equal(12 + quantidadeEfetivaEstoque(8, 1), 20);
});

test("H. mesmo XML não duplica entrada nem estoque", () => {
  const rpc = migracao.slice(migracao.indexOf("rpc_confirmar_entrada_nfe"));
  assert.match(rpc, /Esta NF-e já teve a entrada de estoque processada/);
  assert.match(rpc, /documento_entrada_item_id/);
  assert.match(fonte("supabase/migrations/20260817250000_fiscal_documentos_entrada.sql"), /uq_fiscal_documentos_entrada_chave/);
});

test("I. vínculo conflitante exige confirmação explícita", () => {
  assert.match(actions, /confirmarTrocaVinculo/);
  assert.match(actions, /MENSAGEM_VINCULO_CONFLITANTE/);
  assert.equal(
    MENSAGEM_VINCULO_CONFLITANTE.includes("já está vinculado"),
    true
  );
  assert.match(ui, /Deseja alterar o vínculo/);
  assert.match(ui, /Alterar vínculo/);
});

test("J. unidade diferente bloqueia sem fator; 3 CX × 10 = +30 UN", () => {
  assert.equal(unidadesEntradaDiferentes("CX", "UN"), true);
  assert.equal(unidadesEntradaDiferentes("UN", "UN"), false);
  assert.equal(
    fatorConversaoPodeConfirmar({
      unidadeXml: "CX",
      unidadeProduto: "UN",
      fatorConversao: 1,
      confirmado: false,
    }),
    false
  );
  assert.equal(
    fatorConversaoPodeConfirmar({
      unidadeXml: "CX",
      unidadeProduto: "UN",
      fatorConversao: 10,
      confirmado: true,
    }),
    true
  );
  assert.equal(quantidadeEfetivaEstoque(3, 10), 30);
  assert.match(migracao, /fator_conversao_confirmado is not true/);
  assert.match(actions, /MENSAGEM_FATOR_CONVERSAO_OBRIGATORIO/);
  assert.equal(
    MENSAGEM_FATOR_CONVERSAO_OBRIGATORIO.includes("fator de conversão"),
    true
  );
  assert.match(ui, /Salvar fator/);
});

test("K. snapshot: alterar vínculo futuro não reescreve item processado", () => {
  const triggerFix = fonte(
    "supabase/migrations/20260817300000_fix_trigger_entrada_processando.sql"
  );
  assert.match(
    migracao,
    /new\.fator_conversao is distinct from old\.fator_conversao/
  );
  assert.match(
    triggerFix,
    /v_status = 'entrada_concluida'/
  );
  assert.match(
    triggerFix,
    /v_status = 'processando_entrada'/
  );
  assert.match(
    triggerFix,
    /Itens de entrada já processada não podem ser alterados/
  );
  const vincular = actions.slice(
    actions.indexOf("export async function vincularItemEntrada"),
    actions.indexOf("export async function criarProdutoEVincularItem")
  );
  assert.match(vincular, /MENSAGEM_ENTRADA_JA_PROCESSADA/);
});

test("EAN duplicado no cadastro não sugere; EAN único sugere sem auto-vínculo", () => {
  const duplicados = [
    produtosA[0],
    { ...produtosA[0], id: "prod-a2", codigo: "5208" },
  ];
  assert.equal(
    sugerirProdutoEntrada(
      { ean: "7890000000001" },
      duplicados,
      EMPRESA_A
    ),
    null
  );

  const unico = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "XPTO99",
    ean: "7890000000001",
    vinculos: [],
    produtos: produtosA,
  });
  assert.equal(unico.origem, "ean");
  assert.equal(unico.autoVincular, false);
  assert.equal(unico.produtoId, "prod-a");
});

test("mesmo EAN com outro cProd do mesmo fornecedor sugere vínculo existente", () => {
  const r = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "XPTO99",
    ean: "7890000000001",
    vinculos: [vinculoAbc001],
    produtos: produtosA,
  });
  assert.equal(r.origem, "ean_vinculo");
  assert.equal(r.autoVincular, false);
  assert.equal(r.produtoId, "prod-a");
});

test("código interno igual ao cProd só sugere; descrição nunca vincula sozinha", () => {
  const porCodigo = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "5207",
    descricao: "outra coisa",
    vinculos: [],
    produtos: produtosA,
  });
  assert.equal(porCodigo.origem, "codigo");
  assert.equal(porCodigo.autoVincular, false);

  const porDescricao = reconhecerItemEntrada({
    empresaIdAtiva: EMPRESA_A,
    fornecedorId: FORN_ABC,
    codigoFornecedor: "ZZZ",
    descricao: "Fronta A32",
    vinculos: [],
    produtos: produtosA,
  });
  assert.equal(porDescricao.origem, "descricao");
  assert.equal(porDescricao.autoVincular, false);
});

test("RLS e mesma empresa no vínculo fornecedor-produto", () => {
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migracao, /forn_prod_vinculo_assert_mesma_empresa/);
  assert.match(migracao, /O fornecedor do vínculo não pertence à empresa ativa/);
  assert.match(migracao, /O produto do vínculo não pertence à empresa ativa/);
  assert.match(migracao, /enable row level security/);
  assert.doesNotMatch(migracao, /for delete/);
});

test("UI mostra origem do reconhecimento e não copia tributação de saída", () => {
  assert.match(ui, /Vínculo salvo/);
  assert.match(ui, /Encontrado por EAN/);
  assert.match(ui, /Sugestão por código/);
  assert.match(ui, /Sugestão por descrição/);
  assert.match(ui, /Novo produto/);
  assert.match(ui, /Cadastrar novo produto/);
  assert.match(ui, /Vincular existente/);
  assert.doesNotMatch(actions, /grupo_fiscal_id: item/);
});
