BEGIN;

-- ============================================================
-- UltraPDV — Hardening: REVOKE EXECUTE de funções internas
-- Data: 2026-08-18
--
-- Fecha a superfície PostgREST (chave pública / anon) sem mudar
-- a semântica das funções.
--
-- Internas: só service_role (ou execução indireta por DEFINER).
-- RPCs de sessão: authenticated + service_role; sem anon.
-- Catálogo público e guards de RLS: inalterados.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Funções internas / P0
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
  nomes text[] := ARRAY[
    'carteira_credito_disponivel_cliente_interno',
    'carteira_criar_debito_venda_interno',
    'carteira_recalcular_saldo_cliente_interno',
    'estoque_baixar_composicao_venda_interno',
    'estoque_estornar_composicao_venda_interno',
    'finalizar_venda_comercial_interno',
    'finalizar_venda_comercial_interno_v1',
    'forma_pagamento_eh_pix',
    'garantir_forma_pix_unica_empresa',
    'gerar_proximo_codigo_produto',
    'inserir_formas_pagamento_padrao',
    'pix_geranet_validar_na_finalizacao',
    'pix_geranet_vincular_na_finalizacao',
    'pix_local_validar_na_finalizacao',
    'pix_local_vincular_na_finalizacao',
    'rpc_cancelar_venda_comercial',
    'rpc_criar_empresa_onboarding'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (nomes)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

-- ------------------------------------------------------------
-- 2) RPCs de sessão autenticada: tirar anon, manter authenticated
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
  nomes text[] := ARRAY[
    'criar_configuracao_fiscal_inicial',
    'criar_empresa',
    'rpc_atualizar_limites_estoque_produto',
    'rpc_cadastrar_produto',
    'rpc_confirmar_entrada_nfe',
    'rpc_confirmar_recebimento_transferencia',
    'rpc_confirmar_saida_devolucao_fornecedor',
    'rpc_confirmar_saida_operacao_fiscal',
    'rpc_editar_venda_pdv',
    'rpc_finalizar_venda',
    'rpc_importar_documento_entrada',
    'rpc_movimentar_estoque_produto',
    'rpc_receber_carteira_cliente',
    'rpc_vincular_estabelecimento_transferencia',
    'salvar_segredo_fiscal'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (nomes)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
