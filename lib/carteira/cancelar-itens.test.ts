import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  conferirItensMesmaVenda,
  itensEmAbertoParaImpressao,
  pagoAlocadoDoItem,
  resumoValoresCancelamentoItens,
  todosItensAtivosSelecionados,
  vendaJaTeveCancelamentoParcial,
} from "./cancelar-itens";

test("item totalmente em aberto: pago 0 pelo vínculo da carteira", () => {
  const analise = pagoAlocadoDoItem({
    valorOriginal: 65,
    valorAberto: 65,
    alocadoAtivo: 0,
  });
  assert.deepEqual(analise, { ok: true, pago: 0 });
});

test("item com baixa parcial usa só a alocação do item", () => {
  const analise = pagoAlocadoDoItem({
    valorOriginal: 65,
    valorAberto: 20,
    alocadoAtivo: 45,
  });
  assert.deepEqual(analise, { ok: true, pago: 45 });
});

test("sem vínculo seguro entre recebimento e item bloqueia o cancelamento", () => {
  const analise = pagoAlocadoDoItem({
    valorOriginal: 65,
    valorAberto: 65,
    alocadoAtivo: 10,
  });
  assert.equal(analise.ok, false);
  if (!analise.ok) {
    assert.match(analise.erro, /vínculo seguro/);
  }
});

test("não mistura itens de vendas diferentes", () => {
  const ok = conferirItensMesmaVenda([
    { venda_id: "venda-44" },
    { venda_id: "venda-44" },
  ]);
  assert.equal(ok.ok, true);
  const erro = conferirItensMesmaVenda([
    { venda_id: "venda-44" },
    { venda_id: "venda-48" },
  ]);
  assert.equal(erro.ok, false);
});

test("modal usa R$ 65 selecionados, não o total de R$ 185", () => {
  const resumo = resumoValoresCancelamentoItens({
    valorOriginalVenda: 185,
    valorAbertoVenda: 185,
    selecionados: [{ valor_original: 65, valor_aberto: 65 }],
  });
  assert.equal(resumo.valorSelecionadoOriginal, 65);
  assert.equal(resumo.valorSelecionadoAberto, 65);
  assert.equal(resumo.valorPermaneceraAberto, 120);
  assert.equal(resumo.valorOriginalVenda, 185);
});

test("todos os itens ativos selecionados autoriza rotina completa", () => {
  const itens = [
    { id: "a", titulo_id: "t", produto_nome: "A", quantidade: 1, valor_original: 65, valor_aberto: 65, status: "ABERTO" },
    { id: "b", titulo_id: "t", produto_nome: "B", quantidade: 1, valor_original: 55, valor_aberto: 55, status: "ABERTO" },
    { id: "c", titulo_id: "t", produto_nome: "C", quantidade: 1, valor_original: 65, valor_aberto: 65, status: "ABERTO" },
  ];
  assert.equal(
    todosItensAtivosSelecionados({ itensDaVenda: itens, selecionadosIds: ["a"] }),
    false
  );
  assert.equal(
    todosItensAtivosSelecionados({
      itensDaVenda: itens,
      selecionadosIds: ["a", "b", "c"],
    }),
    true
  );
});

test("impressão ignora cancelado e quitado; parcial entra pelo saldo", () => {
  const abertos = itensEmAbertoParaImpressao([
    { status: "CANCELADO", valor_aberto: 0 },
    { status: "QUITADO", valor_aberto: 0 },
    { status: "PARCIAL", valor_aberto: 20 },
    { status: "ABERTO", valor_aberto: 55 },
  ]);
  assert.equal(abertos.length, 2);
  assert.equal(abertos[0]?.valor_aberto, 20);
});

test("cancelamento parcial anterior impede rotina da venda inteira", () => {
  assert.equal(
    vendaJaTeveCancelamentoParcial([
      { status: "CANCELADO" },
      { status: "ABERTO" },
    ]),
    true
  );
  assert.equal(
    vendaJaTeveCancelamentoParcial([{ status: "ABERTO" }, { status: "PARCIAL" }]),
    false
  );
});

test("RPC de item isola empresa_id, não muta fiscal e devolve só o item", () => {
  const rpc = fonte(
    "supabase/migrations/20260821140000_carteira_cancelar_itens.sql"
  );
  assert.match(rpc, /rpc_cancelar_itens_carteira/);
  assert.match(rpc, /p_empresa_id/);
  assert.match(rpc, /estoque_estornar_itens_venda_interno/);
  assert.match(rpc, /ci\.id = ANY\s*\(\s*v_ids\)/);
  assert.doesNotMatch(rpc, /caixa_movimentacoes/);
  assert.doesNotMatch(rpc, /UPDATE public\.fiscal_emissoes/);
  assert.doesNotMatch(rpc, /chamarGeranet|nfe\/cancelar|nfce-emitir/);
  assert.match(rpc, /status = 'cancelada'/);
  assert.match(rpc, /NAO altera fiscal_emissoes/);
});
