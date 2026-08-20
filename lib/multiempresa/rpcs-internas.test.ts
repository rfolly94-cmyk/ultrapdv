import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "./fonte";

const INTERNAS = [
  "carteira_credito_disponivel_cliente_interno",
  "carteira_criar_debito_venda_interno",
  "carteira_recalcular_saldo_cliente_interno",
  "estoque_baixar_composicao_venda_interno",
  "estoque_estornar_composicao_venda_interno",
  "finalizar_venda_comercial_interno",
  "finalizar_venda_comercial_interno_v1",
  "garantir_forma_pix_unica_empresa",
  "inserir_formas_pagamento_padrao",
  "pix_geranet_validar_na_finalizacao",
  "pix_geranet_vincular_na_finalizacao",
  "pix_local_validar_na_finalizacao",
  "pix_local_vincular_na_finalizacao",
  "rpc_cancelar_venda_comercial",
  "rpc_criar_empresa_onboarding",
];

test("RPCs internas da FASE 1B: authenticated recebe REVOKE ALL", () => {
  const revoke = fonte(
    "supabase/migrations/20260818130000_revoke_execute_anon_funcoes_internas.sql"
  );

  for (const nome of INTERNAS) {
    assert.match(revoke, new RegExp(`'${nome}'`));
  }

  assert.match(revoke, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
  assert.match(revoke, /REVOKE ALL ON FUNCTION %s FROM anon/);
  assert.match(revoke, /REVOKE ALL ON FUNCTION %s FROM authenticated/);
  assert.match(revoke, /GRANT EXECUTE ON FUNCTION %s TO service_role/);
});

test("RPCs internas: reforço explícito de onboarding e cancelar venda", () => {
  const reforco = fonte(
    "supabase/migrations/20260818131000_proteger_rpcs_p0_onboarding_cancelar.sql"
  );
  assert.match(
    reforco,
    /GRANT EXECUTE ON FUNCTION public\.rpc_criar_empresa_onboarding[\s\S]*TO service_role/
  );
  assert.match(
    reforco,
    /REVOKE ALL ON FUNCTION public\.rpc_cancelar_venda_comercial[\s\S]*FROM authenticated/
  );
});

test("RPCs de sessão autenticada continuam com GRANT authenticated (não são internas)", () => {
  const revoke = fonte(
    "supabase/migrations/20260818130000_revoke_execute_anon_funcoes_internas.sql"
  );
  assert.match(revoke, /GRANT EXECUTE ON FUNCTION %s TO authenticated/);
  assert.match(revoke, /'rpc_finalizar_venda'/);
  assert.match(revoke, /'rpc_receber_carteira_cliente'/);
  assert.match(revoke, /'rpc_movimentar_estoque_produto'/);
});
