import assert from "node:assert/strict";
import { test } from "node:test";

import { efeitoFisicoMovimento } from "@/lib/caixa/formas";
import { MENSAGEM_CAIXA_FECHADO_FINALIZAR } from "@/lib/caixa/mensagens";
import { totaisDoLivro } from "@/lib/caixa/saldo";
import { fonte } from "@/lib/multiempresa/fonte";

const FASE2B = "supabase/migrations/20260825140000_caixa_carteira_estornos.sql";
const FASE2A = "supabase/migrations/20260825130000_caixa_afeta_fisico.sql";
const FASE1 = "supabase/migrations/20260824100000_caixa_modulo.sql";
const CANCELAR =
  "supabase/migrations/20260821120000_carteira_estornar_recebimento_cancelar_comercial.sql";
const PARCIAL = "supabase/migrations/20260821140000_carteira_cancelar_itens.sql";

function recebimento(params: {
  entrada: number;
  saida?: number;
  forma_tipo?: string;
  forma_nome?: string;
  afeta_caixa_fisico_snapshot?: boolean;
  permite_troco_snapshot?: boolean;
}) {
  return {
    tipo: "recebimento_carteira" as const,
    entrada: params.entrada,
    saida: params.saida ?? 0,
    forma_tipo: params.forma_tipo ?? null,
    forma_nome: params.forma_nome ?? null,
    afeta_caixa_fisico_snapshot: params.afeta_caixa_fisico_snapshot ?? false,
    permite_troco_snapshot: params.permite_troco_snapshot ?? false,
  };
}

test("1. recebimento Carteira em dinheiro entra no livro e no saldo físico", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 50, saida: 0 },
    recebimento({
      entrada: 100,
      forma_tipo: "DINHEIRO",
      forma_nome: "Dinheiro",
      afeta_caixa_fisico_snapshot: true,
      permite_troco_snapshot: true,
    }),
  ]);
  assert.equal(totais.saldoAtual, 150);
  assert.equal(totais.vendasTotal, 0);
  assert.equal(
    efeitoFisicoMovimento({
      tipo: "recebimento_carteira",
      entrada: 100,
      saida: 0,
      afeta_caixa_fisico_snapshot: true,
    }),
    100
  );
});

test("2. recebimento Carteira PIX não mexe na gaveta", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 50, saida: 0 },
    recebimento({
      entrada: 200,
      forma_tipo: "PIX",
      forma_nome: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.saldoAtual, 50);
  assert.equal(totais.recebimentosCarteira, 200);
  assert.equal(totais.meiosPix, 200);
  assert.equal(totais.outrasEntradas, 0);
});

test("3. recebimento misto: duas ocorrências (uma forma por baixa)", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 0, saida: 0 },
    recebimento({
      entrada: 100,
      forma_tipo: "DINHEIRO",
      afeta_caixa_fisico_snapshot: true,
    }),
    recebimento({
      entrada: 200,
      forma_tipo: "PIX",
      forma_nome: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.saldoAtual, 100);
  assert.equal(totais.entradas, 300);
  assert.match(fonte(FASE2B), /origem_tipo = 'recebimento_carteira'/);
  assert.match(fonte(FASE2B), /v_recebimento\.id/);
});

test("4. recebimento parcial lança só o valor recebido", () => {
  const totais = totaisDoLivro([
    recebimento({
      entrada: 40,
      afeta_caixa_fisico_snapshot: true,
    }),
  ]);
  assert.equal(totais.saldoAtual, 40);
  assert.match(fonte(FASE2B), /rpc_receber_carteira_cliente\(/);
  assert.match(fonte("app/clientes/[id]/carteira/actions.ts"), /p_modo/);
});

test("5. Carteira não tem troco no fluxo atual; fórmula 2A permanece se houver", () => {
  assert.doesNotMatch(fonte(FASE2B), /p_troco/);
  assert.doesNotMatch(
    fonte("supabase/migrations/20260813016000_carteira_cliente_fundacao.sql"),
    /p_troco/
  );
  const comTroco = totaisDoLivro([
    recebimento({
      entrada: 20,
      saida: 15,
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
    }),
  ]);
  assert.equal(comTroco.saldoAtual, 5);
  assert.match(fonte(FASE2B), /caixa_movimentacoes_troco_permite_check/);
});

test("6. saldo físico usa snapshot afeta_caixa_fisico, não o nome da forma", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 10, saida: 0 },
    recebimento({
      entrada: 100,
      forma_nome: "Dinheiro",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.saldoAtual, 10);
});

test("7. estorno de recebimento em dinheiro inverte o físico sem apagar o original", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 50, saida: 0 },
    recebimento({
      entrada: 100,
      afeta_caixa_fisico_snapshot: true,
    }),
    {
      tipo: "estorno_recebimento",
      entrada: 0,
      saida: 100,
      afeta_caixa_fisico_snapshot: true,
    },
  ]);
  assert.equal(totais.saldoAtual, 50);
  const sql = fonte(FASE2B);
  assert.match(sql, /estorno_de_id/);
  assert.match(sql, /v_original\.entrada/);
  assert.doesNotMatch(sql, /DELETE FROM public\.caixa_movimentacoes/);
});

test("8. estorno PIX não gera efeito físico", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    recebimento({
      entrada: 200,
      forma_tipo: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
    {
      tipo: "estorno_recebimento",
      entrada: 0,
      saida: 200,
      afeta_caixa_fisico_snapshot: false,
    },
  ]);
  assert.equal(totais.saldoAtual, 80);
});

test("9. retry de recebimento não duplica: unique na origem do recebimento", () => {
  const sql = fonte(FASE2B);
  assert.match(sql, /ux_caixa_movimentacoes_origem_recebimento_carteira/);
  assert.match(sql, /ON CONFLICT \(empresa_id, origem_tipo, origem_id\)/);
  assert.match(sql, /origem_tipo = 'recebimento_carteira'/);
  assert.match(sql, /DO NOTHING/);
  assert.match(fonte("app/pdv/actions.ts"), /p_idempotency_key/);
});

test("10. retry de estorno não duplica compensatório", () => {
  const sql = fonte(FASE2B);
  assert.match(sql, /ux_caixa_movimentacoes_origem_estorno_recebimento/);
  assert.match(sql, /já foi estornado/);
  assert.match(sql, /origem_tipo = 'estorno_recebimento'/);
});

test("11. cancelamento total de venda não inventa estorno no Caixa", () => {
  const cancelar = fonte(CANCELAR);
  const fase2b = fonte(FASE2B);
  const api = fonte("app/api/vendas/[id]/cancelar/route.ts");
  assert.doesNotMatch(cancelar, /caixa_movimentacoes/);
  assert.doesNotMatch(fase2b, /rpc_cancelar_venda_comercial\s*\(/);
  assert.doesNotMatch(api, /rpc_.*caixa/);
  assert.match(cancelar, /devolucao_status/);
  assert.match(cancelar, /PENDENTE/);
});

test("12. cancelamento parcial não lança Caixa e não apaga movimento de venda", () => {
  const parcial = fonte(PARCIAL);
  assert.doesNotMatch(parcial, /caixa_movimentacoes/);
  assert.doesNotMatch(fonte(FASE2B), /rpc_cancelar_itens_carteira/);
  assert.match(parcial, /estoque_estornar_itens_venda_interno/);
});

test("13. movimento original nunca é apagado", () => {
  assert.doesNotMatch(fonte(FASE2B), /DELETE FROM public\.caixa_movimentacoes/);
  assert.doesNotMatch(fonte(FASE2A), /DELETE FROM public\.caixa_movimentacoes/);
  assert.match(fonte(FASE2B), /estorno_de_id/);
});

test("14. caixa fechado bloqueia recebimento e estorno novos", () => {
  const sql = fonte(FASE2B);
  const receber = sql.indexOf("rpc_receber_carteira_cliente(");
  const mensagem = sql.indexOf("O caixa foi fechado. Abra um caixa para continuar.");
  const lock = sql.indexOf("FOR UPDATE");
  assert.ok(lock > 0 && receber > lock);
  assert.ok(mensagem > 0 && mensagem < receber);
  assert.equal(
    MENSAGEM_CAIXA_FECHADO_FINALIZAR,
    "O caixa foi fechado. Abra um caixa para continuar."
  );
  assert.match(fonte("app/api/clientes/[id]/carteira/receber/route.ts"), /mensagemErroCaixaOperacao/);
  assert.match(
    fonte("app/api/clientes/[id]/carteira/estornar-recebimento/route.ts"),
    /mensagemErroCaixaOperacao/
  );
});

test("15. isolamento multiempresa: empresa ativa no servidor", () => {
  const sql = fonte(FASE2B);
  const receber = fonte("app/api/clientes/[id]/carteira/receber/route.ts");
  const estornar = fonte("app/api/clientes/[id]/carteira/estornar-recebimento/route.ts");
  assert.match(sql, /caixa_empresa_ativa_usuario\(\)/);
  assert.match(sql, /p_empresa_id IS DISTINCT FROM v_empresa_id/);
  assert.match(receber, /p_empresa_id:\s*vinculo\.empresa_id/);
  assert.match(estornar, /p_empresa_id: vinculo\.empresa_id/);
  assert.doesNotMatch(receber, /body\.empresa_id|searchParams\.get\("empresa_id"\)/);
});

test("16. alteração posterior da forma não muda histórico", () => {
  const sql = fonte(FASE2B);
  assert.match(sql, /permite_troco_snapshot/);
  assert.match(sql, /afeta_caixa_fisico_snapshot/);
  assert.match(sql, /v_original\.forma_nome/);
  const historico = totaisDoLivro([
    recebimento({
      entrada: 100,
      forma_nome: "Dinheiro antigo",
      afeta_caixa_fisico_snapshot: true,
    }),
  ]);
  assert.equal(historico.saldoAtual, 100);
  assert.doesNotMatch(fonte("lib/caixa/carregar.ts"), /from\("formas_pagamento"\)/);
});

test("17. vendas da Fase 2A continuam corretas", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    {
      tipo: "venda",
      entrada: 20,
      saida: 15,
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
      forma_tipo: "DINHEIRO",
    },
    {
      tipo: "venda",
      entrada: 50,
      saida: 0,
      afeta_caixa_fisico_snapshot: false,
      forma_tipo: "PIX",
      forma_nome: "PIX",
    },
  ]);
  assert.equal(totais.vendasTotal, 55);
  assert.equal(totais.vendasDinheiro, 5);
  assert.equal(totais.vendasPix, 50);
  assert.equal(totais.saldoAtual, 85);
  assert.doesNotMatch(fonte(FASE2B), /CREATE OR REPLACE FUNCTION public\.rpc_finalizar_venda\s*\(/);
  assert.doesNotMatch(fonte(FASE1), /recebimento_carteira/);
});

test("18. fiscal, estoque e Carteira comercial continuam nas RPCs originais", () => {
  const sql = fonte(FASE2B);
  assert.match(sql, /rpc_receber_carteira_cliente\(/);
  assert.match(sql, /rpc_estornar_recebimento_carteira\(/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.rpc_receber_carteira_cliente/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.rpc_estornar_recebimento_carteira\s*\(/);
  assert.doesNotMatch(sql, /estoque_estornar/);
  assert.doesNotMatch(sql, /fiscal_emissoes|chamarGeranet/);
  assert.doesNotMatch(fonte(CANCELAR), /caixa_movimentacoes/);
  const tabela = fonte("components/caixa/caixa-movimentos-tabela.tsx");
  assert.match(tabela, /Recebimento Carteira/);
  assert.match(tabela, /Estorno de recebimento/);
  assert.match(tabela, /Cancelamento de venda/);
  assert.match(tabela, /Cliente/);
  assert.match(tabela, /Reverte recebimento anterior/);
});
