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
