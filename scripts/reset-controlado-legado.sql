-- UltraPDV FASE 2C — reset controlado de dados legados
-- NÃO é migration. Não altera schema_migrations.
-- Preserva estrutura, RLS, RPCs, catálogos globais e o admin da plataforma.
--
-- Admin preservado:
--   3a4774cd-6b9c-4ca2-a93e-36d73bec2f6b

BEGIN;

DO $$
DECLARE
  admin_id uuid := '3a4774cd-6b9c-4ca2-a93e-36d73bec2f6b';
  n_auth int;
  n_public int;
  n_admin int;
  n_confirm int;
  trunc_sql text;
  n_vault int;
BEGIN
  SELECT count(*) INTO n_auth
  FROM auth.users
  WHERE id = admin_id;

  SELECT count(*) INTO n_confirm
  FROM auth.users
  WHERE id = admin_id
    AND email_confirmed_at IS NOT NULL;

  SELECT count(*) INTO n_public
  FROM public.usuarios
  WHERE id = admin_id;

  SELECT count(*) INTO n_admin
  FROM public.administradores_plataforma
  WHERE usuario_id = admin_id
    AND ativo = true;

  IF n_auth <> 1 THEN
    RAISE EXCEPTION 'Admin não encontrado em auth.users.';
  END IF;

  IF n_confirm <> 1 THEN
    RAISE EXCEPTION 'Admin sem e-mail confirmado.';
  END IF;

  IF n_public <> 1 THEN
    RAISE EXCEPTION 'Admin não encontrado em public.usuarios.';
  END IF;

  IF n_admin <> 1 THEN
    RAISE EXCEPTION 'Admin não está em administradores_plataforma.';
  END IF;

  -- Vault: somente nomes ligados às empresas descartadas (sem ler valores).
  DELETE FROM vault.secrets s
  WHERE s.name LIKE 'ultrapdv:%'
     OR s.name LIKE 'pix/%'
     OR s.id IN (
       SELECT secret_id
       FROM public.fiscal_segredos_refs r
       CROSS JOIN LATERAL (
         VALUES
           (r.geranet_api_key_secret_id),
           (r.certificado_a1_secret_id),
           (r.senha_certificado_secret_id),
           (r.csc_secret_id),
           (r.csrt_secret_id)
       ) v(secret_id)
       WHERE secret_id IS NOT NULL
     );

  GET DIAGNOSTICS n_vault = ROW_COUNT;
  RAISE NOTICE 'vault.secrets removidos: %', n_vault;

  -- Storage: apagado via scripts/reset-controlado-storage.ts (API oficial).
  -- DELETE direto em storage.objects é bloqueado pelo trigger protect_delete.

  SELECT format(
    'TRUNCATE TABLE %s RESTART IDENTITY CASCADE',
    string_agg(format('public.%I', c.relname), ', ' ORDER BY c.relname)
  )
  INTO trunc_sql
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname NOT IN (
      'administradores_plataforma',
      'usuarios',
      'fiscal_cclasstrib_catalogo',
      'fiscal_cst_ibscbs_catalogo',
      'fiscal_tipos_operacao'
    );

  IF trunc_sql IS NULL THEN
    RAISE EXCEPTION 'Nenhuma tabela tenant para truncar.';
  END IF;

  EXECUTE trunc_sql;

  DELETE FROM public.usuarios
  WHERE id <> admin_id;

  DELETE FROM auth.users
  WHERE id <> admin_id;

  IF (SELECT count(*) FROM public.empresas) <> 0 THEN
    RAISE EXCEPTION 'empresas não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.usuarios_empresas) <> 0 THEN
    RAISE EXCEPTION 'usuarios_empresas não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.clientes) <> 0 THEN
    RAISE EXCEPTION 'clientes não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.produtos) <> 0 THEN
    RAISE EXCEPTION 'produtos não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.vendas) <> 0 THEN
    RAISE EXCEPTION 'vendas não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.estoque_atual) <> 0 THEN
    RAISE EXCEPTION 'estoque não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.fiscal_emissoes) <> 0 THEN
    RAISE EXCEPTION 'fiscal_emissoes não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.integracoes_pix) <> 0 THEN
    RAISE EXCEPTION 'PIX não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.catalogo_config) <> 0 THEN
    RAISE EXCEPTION 'catálogo não zerou.';
  END IF;

  IF (SELECT count(*) FROM public.catalogo_pedidos) <> 0 THEN
    RAISE EXCEPTION 'pedidos de catálogo não zerou.';
  END IF;

  IF (SELECT count(*) FROM vault.secrets) <> 0 THEN
    RAISE EXCEPTION 'vault ainda possui segredos.';
  END IF;

  IF (SELECT count(*) FROM public.usuarios) <> 1 THEN
    RAISE EXCEPTION 'public.usuarios deveria ter 1 linha.';
  END IF;

  IF (SELECT count(*) FROM auth.users) <> 1 THEN
    RAISE EXCEPTION 'auth.users deveria ter 1 linha.';
  END IF;

  IF (SELECT id FROM auth.users) <> admin_id THEN
    RAISE EXCEPTION 'auth.users restante não é o admin.';
  END IF;

  IF (SELECT id FROM public.usuarios) <> admin_id THEN
    RAISE EXCEPTION 'public.usuarios restante não é o admin.';
  END IF;

  IF (
    SELECT count(*)
    FROM public.administradores_plataforma
    WHERE usuario_id = admin_id
      AND ativo = true
  ) <> 1 THEN
    RAISE EXCEPTION 'administradores_plataforma não preservou o admin.';
  END IF;

  IF (SELECT count(*) FROM public.fiscal_tipos_operacao) < 1 THEN
    RAISE EXCEPTION 'catálogo global fiscal_tipos_operacao foi apagado.';
  END IF;
END;
$$;

COMMIT;
