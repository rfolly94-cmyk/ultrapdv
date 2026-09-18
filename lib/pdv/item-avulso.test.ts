import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  MENSAGEM_ITEM_AVULSO_SEM_CONFIG_FISCAL,
  ORIGEM_ITEM_AVULSO,
  ORIGEM_ITEM_PRODUTO,
  itemVendaEhAvulso,
  itensCatalogoParaEstoque,
  mensagemEmissaoItemAvulsoSemFiscal,
  origemItemPdv,
  validarFormularioItemAvulso,
} from "./item-avulso";

const MIGRATION = "supabase/migrations/20260910120000_pdv_item_avulso.sql";
const MIGRATION_EDICAO =
  "supabase/migrations/20260910121000_pdv_item_avulso_edicao.sql";

test("empresa sem produtos consegue adicionar item avulso no PDV", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const modal = fonte("components/pdv/pdv-item-avulso-modal.tsx");
  assert.match(shell, /Nenhum produto cadastrado/);
  assert.match(shell, /Vender item avulso/);
  assert.match(shell, /Cadastrar produto/);
  assert.match(shell, /Item avulso/);
  assert.match(modal, /Descrição/);
  assert.match(modal, /Quantidade/);
  assert.match(modal, /Valor unitário/);
});

test("descrição, quantidade e valor do item avulso são preservados", () => {
  const validado = validarFormularioItemAvulso({
    descricao: "Película 3D",
    quantidadeTexto: "2",
    valorUnitarioTexto: "25,00",
  });
  assert.equal(validado.ok, true);
  if (validado.ok) {
    assert.equal(validado.descricao, "Película 3D");
    assert.equal(validado.quantidade, 2);
    assert.equal(validado.valorUnitarioCentavos, 2500);
  }

  const action = fonte("app/pdv/actions.ts");
  assert.match(action, /origem: ORIGEM_ITEM_AVULSO/);
  assert.match(action, /descricao/);
  assert.match(action, /valor_unitario:/);
  assert.match(fonte(MIGRATION), /produto_nome', v_descricao/);
  assert.doesNotMatch(fonte(MIGRATION), /p\.nome.*v_descricao/);
});

test("item avulso não cria produto", () => {
  const sql = fonte(MIGRATION);
  assert.doesNotMatch(sql, /INSERT INTO public\.produtos/);
  assert.match(sql, /origem_item', 'avulso'/);
  assert.match(sql, /produto_id IS NULL/);
});

test("item avulso não baixa estoque", () => {
  const sql = fonte(MIGRATION);
  assert.match(
    sql,
    /coalesce\(vi\.origem_item, 'produto'\) <> 'avulso'/
  );
  assert.match(sql, /vi\.produto_id IS NOT NULL/);
  assert.doesNotMatch(
    sql,
    /A venda não possui itens para baixa de estoque/
  );
});

test("cancelamento de avulso não adiciona estoque", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /estoque_estornar_composicao_venda_interno/);
  assert.match(sql, /origem_item = 'avulso' THEN[\s\S]*CONTINUE/);
  assert.match(
    sql,
    /estoque_estornar_itens_venda_interno[\s\S]*origem_item = 'avulso' THEN[\s\S]*CONTINUE/
  );
});

test("produto normal continua movimentando estoque", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /finalizar_venda_comercial_interno_v1/);
  assert.match(sql, /IF v_tem_avulso THEN/);
  assert.match(sql, /ELSE[\s\S]*finalizar_venda_comercial_interno_v1/);
  assert.match(sql, /estoque_baixar_composicao_venda_interno/);
  assert.match(fonte("app/pdv/actions.ts"), /NÃO enviamos valor_unitario para produto cadastrado/);
});

test("recibo e detalhes mostram a descrição digitada", () => {
  const recibo = fonte("lib/impressao/carregar-recibo.ts");
  const detalhes = fonte("app/vendas/[id]/page.tsx");
  assert.match(recibo, /produto_nome/);
  assert.doesNotMatch(recibo, /inner join.*produtos/i);
  assert.match(detalhes, /item\.produto_nome/);
  assert.doesNotMatch(recibo, /ITEM AVULSO/);
});

test("total da venda considera item avulso", () => {
  const validado = validarFormularioItemAvulso({
    descricao: "Película 3D",
    quantidadeTexto: "2",
    valorUnitarioTexto: "25,00",
  });
  assert.equal(validado.ok, true);
  if (!validado.ok) {
    return;
  }
  assert.equal(validado.quantidade * validado.valorUnitarioCentavos, 5000);
  assert.match(fonte(MIGRATION), /v_valor_produtos :=/);
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /valorUnitarioCentavos/);
});

test("pagamento e caixa seguem o fluxo atual da finalização", () => {
  const action = fonte("app/pdv/actions.ts");
  assert.match(action, /rpc_finalizar_venda/);
  assert.match(action, /rpc_finalizar_venda_com_caixa/);
  assert.match(fonte(MIGRATION), /pix_local_vincular_na_finalizacao/);
  assert.match(fonte(MIGRATION), /carteira_criar_debito_venda_interno/);
});

test("venda fiscal sem produto fiscal padrão é bloqueada", () => {
  assert.equal(
    mensagemEmissaoItemAvulsoSemFiscal({
      origem_item: ORIGEM_ITEM_AVULSO,
      produto_id: null,
      snapshot_fiscal: null,
    }),
    MENSAGEM_ITEM_AVULSO_SEM_CONFIG_FISCAL
  );
  for (const arquivo of [
    "app/api/fiscal/geranet/nfce-emitir-venda/route.ts",
    "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
    "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts",
  ]) {
    const rota = fonte(arquivo);
    assert.match(rota, /mensagemEmissaoItemAvulsoSemFiscal/, arquivo);
    assert.match(rota, /MENSAGEM_ITEM_AVULSO_SEM_CONFIG_FISCAL|bloqueioAvulso/, arquivo);
  }
});

test("venda fiscal com produto fiscal padrão gera snapshot pelo motor existente", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /pdv_fonte_fiscal_item_avulso/);
  assert.match(sql, /produtos_fiscal/);
  assert.match(sql, /grupo_fiscal_id/);
  assert.doesNotMatch(sql, /INSERT INTO public\.grupos_fiscais/);
  assert.match(
    fonte("supabase/migrations/20260826120000_vendas_itens_snapshot_tributario.sql"),
    /vendas_itens_congelar_snapshot_tributario/
  );
});

test("estoque do produto fiscal padrão não é movimentado", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /Item avulso não pode informar produto_id/);
  assert.match(sql, /produto_id', NULL/);
  assert.match(sql, /produto_fiscal_padrao_item_avulso_id/);
});

test("descrição do produto fiscal padrão não substitui a descrição avulsa", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /'produto_nome', v_descricao/);
  assert.doesNotMatch(sql, /v_descricao := v_fonte/);
  assert.doesNotMatch(sql, /p\.nome AS produto_nome/);
});

test("empresa A não usa configuração/produto fiscal padrão da empresa B", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /p\.empresa_id = p_empresa_id/);
  assert.match(sql, /c\.empresa_id = p_empresa_id/);
  assert.match(
    sql,
    /O produto fiscal padrão para item avulso deve pertencer à empresa ativa/
  );
  assert.match(sql, /trg_pdv_assert_produto_fiscal_padrao_item_avulso/);
  assert.notEqual(empresaA, empresaB);
});

test("request adulterado não troca a empresa da configuração", () => {
  const sql = fonte(MIGRATION);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.rpc_definir_pdv_item_avulso\(\s*p_permitir boolean/
  );
  assert.doesNotMatch(sql, /rpc_definir_pdv_item_avulso\(\s*p_empresa_id/);
  assert.match(sql, /principal = true/);
  assert.match(sql, /tem_acesso_empresa\(v_empresa_id\)/);
  assert.match(fonte("app/pdv/actions.ts"), /p_empresa_id:\s*vinculo\.empresa_id/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /empresa_id:\s*input\.empresaId/);
});

test("RLS impede leitura cruzada da configuração", () => {
  const sql = fonte(
    "supabase/migrations/20260825200000_pdv_permitir_venda_sem_estoque.sql"
  );
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE/);
  assert.match(fonte(MIGRATION), /pdv_configuracoes/);
});

test("vendas antigas e só com produtos continuam no caminho _v1", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /origem_item text NOT NULL DEFAULT 'produto'/);
  assert.match(sql, /IF v_tem_avulso THEN/);
  assert.match(sql, /finalizar_venda_comercial_interno_v1/);
  assert.match(sql, /v_item - 'valor_unitario'/);
});

test("venda misturando produtos cadastrados e itens avulsos é suportada", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /vendas_item_payload_eh_avulso/);
  assert.match(sql, /finalizar_venda_comercial_com_avulsos_interno/);
  const action = fonte("app/pdv/actions.ts");
  assert.match(action, /origem: "produto"/);
  assert.match(action, /origem: ORIGEM_ITEM_AVULSO/);
  assert.match(fonte(MIGRATION_EDICAO), /rpc_editar_venda_pdv/);
});

test("mobile sem origem continua produto e o wrapper ignora snapshot do cliente no avulso", () => {
  assert.equal(origemItemPdv(undefined), ORIGEM_ITEM_PRODUTO);
  assert.equal(itemVendaEhAvulso({ produtoId: "abc" }), false);
  assert.equal(
    itemVendaEhAvulso({ origem: ORIGEM_ITEM_AVULSO, produto_id: null }),
    true
  );
  assert.deepEqual(
    itensCatalogoParaEstoque([
      { origem: ORIGEM_ITEM_AVULSO, produtoId: undefined, quantidade: 1 },
      { origem: ORIGEM_ITEM_PRODUTO, produtoId: "p1", quantidade: 2 },
    ]).map((item) => item.produtoId),
    ["p1"]
  );
  const sql = fonte(MIGRATION);
  assert.match(sql, /v_item[\s\S]*- 'snapshot_fiscal'/);
  assert.match(sql, /v_item[\s\S]*- 'ncm'/);
  assert.match(sql, /v_item[\s\S]*- 'empresa_id'/);
});
