BEGIN;

-- ============================================================
-- UltraPDV — Default privileges: novas funções sem EXECUTE anon
-- Data: 2026-08-18
--
-- Causa raiz: ALTER DEFAULT PRIVILEGES IN SCHEMA public
-- concede EXECUTE ON FUNCTIONS para anon (roles postgres e
-- supabase_admin). Funções novas nascem chamáveis no PostgREST.
--
-- Esta migration NÃO revoga grants existentes.
-- NÃO altera default privileges de TABLES (RLS continua a
-- proteger SELECT; catálogo público usa RPCs já concedidas).
--
-- Funções públicas futuras (ex.: catálogo) devem GRANT EXECUTE
-- TO anon explicitamente.
-- Authenticated permanece no default para RPCs de sessão.
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

DO $$
BEGIN
  EXECUTE $cmd$
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC
  $cmd$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Não foi possível alterar default privileges de supabase_admin.';
  WHEN OTHERS THEN
    RAISE NOTICE 'Default privileges supabase_admin: %', SQLERRM;
END
$$;

COMMIT;
