BEGIN;

-- ============================================================
-- UltraPDV FASE 1C.3 — Default privileges futuros
-- Data: 2026-08-18
--
-- Confirmação no banco vivo (postgres):
--   * funções criadas por postgres em public: default EXECUTE
--     para authenticated, postgres, service_role — sem anon
--     e sem PUBLIC (migration 20260818132000).
--   * funções criadas por supabase_admin em public: default
--     EXECUTE ainda inclui anon (dashboard / Table Editor).
--   * rpc_catalogo_publico e rpc_catalogo_criar_pedido têm
--     GRANT EXECUTE TO anon explícito e NÃO dependem deste
--     default.
--
-- Esta migration NÃO revoga grants de funções existentes.
-- REVOKE FROM PUBLIC e REVOKE FROM anon são comandos distintos.
-- Funções públicas futuras (catálogo) devem GRANT anon
-- explicitamente.
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- supabase_admin não é membro de postgres e postgres não é
-- superuser no projeto hospedado. O bloco abaixo aplica se o
-- papel executor puder alterar defaults de supabase_admin;
-- senão registra NOTICE e não falha a migration.
DO $$
BEGIN
  EXECUTE $cmd$
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC
  $cmd$;

  EXECUTE $cmd$
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM anon
  $cmd$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'FASE 1C.3: postgres não pode alterar default privileges de supabase_admin. Funções futuras criadas por esse papel em public ainda podem nascer com EXECUTE para anon.';
  WHEN OTHERS THEN
    RAISE NOTICE 'FASE 1C.3 default privileges supabase_admin: %', SQLERRM;
END
$$;

COMMIT;
