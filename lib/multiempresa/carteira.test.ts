import assert from "node:assert/strict";
import { test } from "node:test";

import { buscarDaEmpresaAtiva } from "./app-layer";
import {
  clienteA,
  clienteB,
  empresaA,
  empresaB,
  usuarioA,
  usuarioB,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarPorIdComRls } from "./rls-memoria";

const carteiras = [
  { id: clienteA, empresa_id: empresaA, saldo: 10 },
  { id: clienteB, empresa_id: empresaB, saldo: 999 },
];

test("carteira: A consulta A e não consulta B", () => {
  assert.equal(
    buscarPorIdComRls(carteiras, usuarioA, vinculosPadrao, clienteA)?.saldo,
    10
  );
  assert.equal(buscarPorIdComRls(carteiras, usuarioA, vinculosPadrao, clienteB), null);
  assert.equal(buscarPorIdComRls(carteiras, usuarioB, vinculosPadrao, clienteA), null);
});

test("carteira: RPC de baixa exige cliente da mesma empresa", () => {
  const rpc = fonte("supabase/migrations/20260813016000_carteira_cliente_fundacao.sql");
  assert.match(rpc, /c\.empresa_id = p_empresa_id/);
  assert.match(rpc, /c\.id = p_cliente_id/);
  assert.match(rpc, /Cliente não encontrado/);
});

test("carteira: funções *_interno não são executáveis por authenticated", () => {
  const revoke = fonte(
    "supabase/migrations/20260818130000_revoke_execute_anon_funcoes_internas.sql"
  );
  for (const nome of [
    "carteira_credito_disponivel_cliente_interno",
    "carteira_criar_debito_venda_interno",
    "carteira_recalcular_saldo_cliente_interno",
  ]) {
    assert.match(revoke, new RegExp(nome));
  }
});

test("carteira: A não cria débito, não recalcula e não baixa B", () => {
  assert.equal(buscarDaEmpresaAtiva(carteiras, empresaA, clienteB), null);

  function operar(empresaId: string, clienteEmpresaId: string) {
    if (clienteEmpresaId !== empresaId) {
      throw new Error("Cliente não encontrado.");
    }
  }

  assert.throws(() => operar(empresaA, empresaB), /Cliente não encontrado/);
});

test("carteira: rota receber filtra cliente da empresa ativa", () => {
  const rota = fonte("app/api/clientes/[id]/carteira/receber/route.ts");
  assert.match(rota, /empresa_id/);
  assert.match(rota, /rpc_receber_carteira_cliente/);
});

test("TESTE N: estorno de recebimento isola empresa_id e não altera fiscal", () => {
  const rpc = fonte(
    "supabase/migrations/20260821120000_carteira_estornar_recebimento_cancelar_comercial.sql"
  );
  const rota = fonte(
    "app/api/clientes/[id]/carteira/estornar-recebimento/route.ts"
  );
  const inicio = rpc.indexOf(
    "CREATE OR REPLACE FUNCTION public.rpc_estornar_recebimento_carteira"
  );
  const fim = rpc.indexOf(
    "CREATE OR REPLACE FUNCTION public.rpc_cancelar_venda_comercial"
  );
  const estorno = rpc.slice(inicio, fim);

  assert.match(estorno, /r\.empresa_id = p_empresa_id/);
  assert.match(estorno, /r\.cliente_id = p_cliente_id/);
  assert.match(estorno, /tem_acesso_empresa\(p_empresa_id\)/);
  assert.match(estorno, /carteira_recalcular_saldo_cliente_interno/);
  assert.match(estorno, /carteira_cliente_recebimento_estornos/);
  assert.doesNotMatch(estorno, /estoque_estornar_composicao_venda_interno/);
  assert.doesNotMatch(estorno, /UPDATE public\.fiscal_emissoes/);
  assert.doesNotMatch(estorno, /chamarGeranet|nfe\/cancelar|nfce-emitir/);

  assert.match(rota, /vinculo\.empresa_id/);
  assert.match(rota, /rpc_estornar_recebimento_carteira/);
  assert.match(rota, /receber_carteira/);
});

test("TESTE I/J: cancelamento comercial não muta fiscal_emissoes", () => {
  const rpc = fonte(
    "supabase/migrations/20260821120000_carteira_estornar_recebimento_cancelar_comercial.sql"
  );
  const itens = fonte(
    "supabase/migrations/20260821140000_carteira_cancelar_itens.sql"
  );
  const ui = fonte("components/clientes/carteira/CarteiraClienteWorkspace.tsx");
  const cancelar = fonte("components/vendas/cancelar-venda-comercial.tsx");
  const api = fonte("app/api/vendas/[id]/cancelar/route.ts");
  const apiItens = fonte("app/api/clientes/[id]/carteira/cancelar-itens/route.ts");

  assert.match(rpc, /NAO altera fiscal_emissoes/);
  assert.doesNotMatch(rpc, /Resolva o fiscal antes do cancelamento comercial/);
  assert.doesNotMatch(rpc, /UPDATE public\.fiscal_emissoes/);
  assert.match(rpc, /estoque_estornar_composicao_venda_interno/);
  assert.match(itens, /NAO altera fiscal_emissoes/);
  assert.doesNotMatch(itens, /UPDATE public\.fiscal_emissoes/);
  assert.match(ui, /documento fiscal permanecerá com a situação fiscal atual/);
  assert.match(cancelar, /confirmar_fiscal_comercial/);
  assert.match(api, /fiscal_emissoes/);
  assert.doesNotMatch(api, /\/api\/fiscal\/emissoes\/.*cancelar/);
  assert.match(apiItens, /rpc_cancelar_itens_carteira/);
  assert.doesNotMatch(apiItens, /UPDATE public\.fiscal_emissoes/);
});
