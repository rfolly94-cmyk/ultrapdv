import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { totalLiquidoNota } from "./totais-nota";
import {
  estoqueImpedeItemNfe,
  formatarPrecoItemNfe,
  mesclarSnapshotItemComercial,
  MENSAGEM_PRECO_NEGATIVO_ITEM_NFE,
  MENSAGEM_QUANTIDADE_ITEM_NFE,
  parseNumeroComercialNfe,
  produtoVisivelNaBuscaNfe,
  totalItemNfe,
  validarQuantidadeItemNfe,
  validarValorUnitarioItemNfe,
} from "./item-comercial";
import { verificarOperacaoFiscal } from "@/lib/fiscal/operacoes/verificar-operacao";
import { podeEditarDocumentoFiscal } from "@/lib/fiscal/operacoes/status-operacao";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
const editor = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
const verificar = fonte("lib/fiscal/operacoes/verificar-operacao.ts");
const migracaoSaida = fonte(
  "supabase/migrations/20260828120000_nfe_saida_estoque_negativo.sql"
);
const adicionar = actions.slice(
  actions.indexOf("export async function adicionarItemOperacaoFiscal"),
  actions.indexOf("export async function atualizarItemOperacaoFiscal")
);
const atualizar = actions.slice(
  actions.indexOf("export async function atualizarItemOperacaoFiscal"),
  actions.indexOf("export async function removerItemOperacaoFiscal")
);
const busca = actions.slice(
  actions.indexOf("export async function buscarProdutosOperacaoFiscal"),
  actions.indexOf("export async function buscarClientesOperacaoFiscal")
);

const naturezaBonificacao = {
  id: "nat-bonif",
  empresa_id: "emp-1",
  tipo_operacao_interno: "bonificacao" as const,
  descricao: "Bonificação",
  tp_nf: "1",
  fin_nfe: "1",
  padrao: true,
  ativo: true,
};

function itemVerificacao(extra: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    descricao: "Tela A32",
    produtoId: "prod-1",
    produtoEmpresaId: "emp-1",
    grupoFiscalId: "gf-1",
    grupoFiscalEmpresaId: "emp-1",
    grupoFiscalNome: "Produtos",
    icmsCstCsosn: "102",
    ncm: "85177099",
    quantidade: 2,
    valorUnitario: 10,
    ...extra,
  };
}

test("1. produto com estoque 0 pode ser adicionado", () => {
  assert.equal(estoqueImpedeItemNfe(0, 1), false);
  assert.doesNotMatch(adicionar, /Estoque insuficiente/);
  assert.doesNotMatch(adicionar, /from\("estoque_atual"\)/);
});

test("2. produto com estoque negativo pode ser adicionado", () => {
  assert.equal(estoqueImpedeItemNfe(-3, 1), false);
  assert.doesNotMatch(adicionar, /Estoque insuficiente/);
});

test("3. quantidade acima do estoque pode ser informada", () => {
  assert.equal(estoqueImpedeItemNfe(2, 10), false);
  assert.doesNotMatch(atualizar, /Estoque insuficiente/);
  assert.doesNotMatch(atualizar, /from\("estoque_atual"\)/);
  const quantidade = validarQuantidadeItemNfe({ quantidade: 10, unidade: "UN" });
  assert.equal(quantidade.ok, true);
});

test("4. busca não esconde produto por estoque zero", () => {
  assert.equal(produtoVisivelNaBuscaNfe({ ativo: true, estoque: 0 }), true);
  assert.match(busca, /eq\("ativo", true\)/);
  assert.doesNotMatch(busca, /estoque\s*>\s*0|quantidade\s*>\s*0|estoque\.gt/);
});

test("5. busca não esconde produto por estoque negativo", () => {
  assert.equal(produtoVisivelNaBuscaNfe({ ativo: true, estoque: -2 }), true);
  assert.doesNotMatch(busca, /estoque\s*>\s*0/);
});

test("6. alterar quantidade recalcula total", () => {
  assert.equal(totalItemNfe(2, 70), 140);
  assert.match(editor, /totalItemNfe/);
  assert.match(editor, /onAlterarLocal/);
});

test("7. alterar preço recalcula total", () => {
  assert.equal(totalItemNfe(1, 65), 65);
  assert.equal(totalItemNfe(1, 80), 80);
  assert.equal(totalItemNfe(1, 100), 100);
});

test("8. preço cadastrado do produto não é alterado", () => {
  assert.doesNotMatch(adicionar, /preco_venda:/);
  assert.doesNotMatch(atualizar, /preco_venda:/);
  assert.doesNotMatch(adicionar, /from\("produtos"\)\s*\.update/);
  assert.doesNotMatch(atualizar, /from\("produtos"\)\s*\.update/);
});

test("9. total geral da NF-e é recalculado", () => {
  const produtos = totalItemNfe(2, 70) + totalItemNfe(1, 80);
  assert.equal(
    totalLiquidoNota(produtos, { frete: 10, seguro: 0, outro: 0, desconto: 5 }),
    225
  );
  assert.match(editor, /itensExibidos/);
  assert.match(editor, /totalLiquidoNota\(totalProdutos, totaisNota\)/);
});

test("10. tributação recebe os valores atualizados", () => {
  assert.match(atualizar, /statusAposEdicaoDocumentoFiscal/);
  assert.match(actions, /quantidade: item\.quantidade/);
  assert.match(actions, /valor_unitario: item\.valorUnitario/);
  assert.doesNotMatch(editor, /bcIcms|calcularIcms|aliquotaIcms/);
});

test("11. quantidade zero é recusada", () => {
  const zero = validarQuantidadeItemNfe({ quantidade: 0, unidade: "UN" });
  assert.equal(zero.ok, false);
  if (!zero.ok) {
    assert.equal(zero.erro, MENSAGEM_QUANTIDADE_ITEM_NFE);
  }
});

test("12. quantidade negativa é recusada", () => {
  const negativa = validarQuantidadeItemNfe({ quantidade: -1, unidade: "UN" });
  assert.equal(negativa.ok, false);
});

test("13. preço negativo é recusado", () => {
  const negativo = validarValorUnitarioItemNfe(-0.01);
  assert.equal(negativo.ok, false);
  if (!negativo.ok) {
    assert.equal(negativo.erro, MENSAGEM_PRECO_NEGATIVO_ITEM_NFE);
  }
  assert.equal(validarValorUnitarioItemNfe(0).ok, true);
});

test("14. documento autorizado não pode ser editado", () => {
  const gate = podeEditarDocumentoFiscal({
    statusOperacao: "autorizada",
    emissao: { status: "autorizada" },
  });
  assert.equal(gate.permitido, false);
  assert.match(adicionar, /recusarEdicaoDocumentoFiscal/);
  assert.match(atualizar, /recusarEdicaoDocumentoFiscal/);
  const remover = actions.slice(
    actions.indexOf("export async function removerItemOperacaoFiscal"),
    actions.indexOf("export async function salvarTransporteOperacaoFiscal")
  );
  assert.match(remover, /recusarEdicaoDocumentoFiscal/);
  assert.doesNotMatch(remover, /operacaoPodeEditar/);
});

test("15. snapshot mantém quantidade e preço efetivamente utilizados", () => {
  const snapshot = mesclarSnapshotItemComercial(
    { ncm: "85177099", cfop: "5102", icms_cst_csosn: "102" },
    { quantidade: 3, valor_unitario: 65, valor_total: 195 }
  );
  assert.equal(snapshot.ncm, "85177099");
  assert.equal(snapshot.cfop, "5102");
  assert.equal(snapshot.icms_cst_csosn, "102");
  assert.equal(snapshot.quantidade, 3);
  assert.equal(snapshot.valor_unitario, 65);
  assert.equal(snapshot.valor_total, 195);
  assert.match(atualizar, /mesclarSnapshotItemComercial/);
  assert.match(atualizar, /cfop_resolvido: item\.cfop_resolvido/);
});

test("16. falta de estoque não gera erro fiscal falso", () => {
  const verificacao = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "bonificacao",
    natureza: naturezaBonificacao,
    ufEmpresa: "MT",
    ufDestinatario: "MT",
    destinatarioTipo: "cliente",
    destinatarioId: "cli-1",
    itens: [itemVerificacao({ quantidade: 10, estoqueDisponivel: 0 })],
    regrasCfop: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-bonif",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "5910",
        ativo: true,
      },
    ],
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: null,
  });
  assert.equal(
    verificacao.pendencias.some((item) => item.codigo === "estoque"),
    false
  );
  assert.doesNotMatch(verificar, /codigo: "estoque"/);
  assert.doesNotMatch(verificar, /Estoque insuficiente/);
});

test("17. baixa posterior pode resultar em estoque negativo", () => {
  assert.match(migracaoSaida, /v_atual := v_anterior - v_item\.quantidade/);
  assert.doesNotMatch(
    migracaoSaida,
    /Estoque insuficiente para confirmar a saída/
  );
  assert.match(migracaoSaida, /Resultado pode ser negativo/);
});

test("campos da tabela são editáveis e compactos", () => {
  assert.match(editor, /nfe-item-qtd/);
  assert.match(editor, /nfe-item-preco/);
  assert.match(editor, /onBlur=\{confirmarCampo\}/);
  assert.match(editor, /CampoValor/);
  assert.match(editor, /Estoque: \{item\.estoque\}/);
  assert.equal(parseNumeroComercialNfe("65,00"), 65);
  assert.equal(formatarPrecoItemNfe(65), "65,00");
});

test("quantidade decimal só quando a unidade permite", () => {
  assert.equal(validarQuantidadeItemNfe({ quantidade: 1.5, unidade: "KG" }).ok, true);
  assert.equal(validarQuantidadeItemNfe({ quantidade: 1.5, unidade: "UN" }).ok, false);
});
