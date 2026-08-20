import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "./fonte";

const MIGRATION =
  "supabase/migrations/20260818150000_default_privileges_funcoes_sem_anon_e_public.sql";

test("default privileges futuros: REVOKE FROM PUBLIC e FROM anon são comandos distintos", () => {
  const sql = fonte(MIGRATION);
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/
  );
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM anon;/
  );
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/
  );
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM anon/
  );
});

test("default privileges futuros: não revoga grants de funções existentes", () => {
  const sql = fonte(MIGRATION);
  assert.doesNotMatch(sql, /REVOKE ALL ON FUNCTION/);
  assert.doesNotMatch(sql, /REVOKE EXECUTE ON FUNCTION public\./);
  assert.match(sql, /NÃO revoga grants de funções existentes/);
});

test("catálogo público: GRANT EXECUTE TO anon é explícito e não depende do default", () => {
  const sql = fonte("supabase/migrations/20260816010000_catalogo_online.sql");
  assert.match(
    sql,
    /GRANT EXECUTE\s+ON FUNCTION public\.rpc_catalogo_publico\(text\)\s+TO anon, authenticated/
  );
  assert.match(
    sql,
    /GRANT EXECUTE\s+ON FUNCTION public\.rpc_catalogo_criar_pedido\([\s\S]*?\)\s+TO anon, authenticated/
  );
});
