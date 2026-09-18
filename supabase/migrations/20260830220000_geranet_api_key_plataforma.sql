BEGIN;

-- UltraPDV — API Key Geranet global da plataforma
-- A chave deixa de ser credencial da empresa.
-- Certificado A1 e CSC continuam em fiscal_segredos_refs por empresa_id.
-- Chaves já gravadas por empresa NÃO são apagadas.

CREATE TABLE IF NOT EXISTS public.plataforma_segredos_refs (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  geranet_api_key_secret_id uuid,
  geranet_api_key_configurada boolean NOT NULL DEFAULT false,
  migracao_chaves_empresa text NOT NULL DEFAULT 'pendente'
    CHECK (migracao_chaves_empresa IN ('pendente', 'vazia', 'copiada', 'divergente')),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES public.usuarios(id)
);

COMMENT ON TABLE public.plataforma_segredos_refs IS
  'Referências aos segredos globais da plataforma no Vault. Não pertence a empresa.';

INSERT INTO public.plataforma_segredos_refs (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.plataforma_segredos_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plataforma_segredos_refs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plataforma_segredos_refs FROM PUBLIC;
REVOKE ALL ON TABLE public.plataforma_segredos_refs FROM anon;
REVOKE ALL ON TABLE public.plataforma_segredos_refs FROM authenticated;
GRANT ALL ON TABLE public.plataforma_segredos_refs TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_master_salvar_api_key_geranet(
  p_valor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_admin uuid;
  v_nome text := 'ultrapdv:plataforma:geranet_api_key';
  v_id uuid;
  v_valor text;
BEGIN
  SELECT a.usuario_id
    INTO v_admin
  FROM public.administradores_plataforma a
  WHERE a.usuario_id = auth.uid()
    AND a.ativo = true
  LIMIT 1;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'nao_autorizado'
      USING ERRCODE = '42501';
  END IF;

  v_valor := btrim(coalesce(p_valor, ''));
  IF char_length(v_valor) < 20 THEN
    RAISE EXCEPTION 'api_key_invalida'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.geranet_api_key_secret_id
    INTO v_id
  FROM public.plataforma_segredos_refs r
  WHERE r.id;

  IF v_id IS NULL THEN
    SELECT s.id
      INTO v_id
    FROM vault.secrets s
    WHERE s.name = v_nome
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(
      v_valor,
      v_nome,
      'UltraPDV API Key Geranet (plataforma)'
    );
    SELECT s.id
      INTO v_id
    FROM vault.secrets s
    WHERE s.name = v_nome
    LIMIT 1;
  ELSE
    PERFORM vault.update_secret(
      v_id,
      v_valor,
      v_nome,
      'UltraPDV API Key Geranet (plataforma)'
    );
  END IF;

  UPDATE public.plataforma_segredos_refs
  SET
    geranet_api_key_secret_id = v_id,
    geranet_api_key_configurada = true,
    atualizado_em = now(),
    atualizado_por = v_admin
  WHERE id;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_api_key_geranet_plataforma()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
  v_valor text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'obter_api_key_geranet_plataforma restrito ao servidor';
  END IF;

  SELECT r.geranet_api_key_secret_id
    INTO v_id
  FROM public.plataforma_segredos_refs r
  WHERE r.id;

  IF v_id IS NULL THEN
    SELECT s.id
      INTO v_id
    FROM vault.secrets s
    WHERE s.name = 'ultrapdv:plataforma:geranet_api_key'
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.decrypted_secret
    INTO v_valor
  FROM vault.decrypted_secrets s
  WHERE s.id = v_id;

  RETURN NULLIF(btrim(coalesce(v_valor, '')), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.diagnostico_api_key_geranet_plataforma()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_valor text;
  v_configurada boolean := false;
  v_migracao text := 'pendente';
  v_empresas integer := 0;
  v_distintas integer := 0;
  v_mascara text := NULL;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'diagnostico_api_key_geranet_plataforma restrito ao servidor';
  END IF;

  SELECT
    r.geranet_api_key_configurada,
    r.migracao_chaves_empresa
    INTO v_configurada, v_migracao
  FROM public.plataforma_segredos_refs r
  WHERE r.id;

  v_valor := public.obter_api_key_geranet_plataforma();
  IF v_valor IS NOT NULL THEN
    v_configurada := true;
    v_mascara := '••••' || right(v_valor, 4);
  END IF;

  SELECT count(*)
    INTO v_empresas
  FROM public.fiscal_segredos_refs r
  WHERE r.geranet_api_key_secret_id IS NOT NULL;

  SELECT count(*)
    INTO v_distintas
  FROM (
    SELECT DISTINCT btrim(s.decrypted_secret)
    FROM public.fiscal_segredos_refs r
    JOIN vault.decrypted_secrets s ON s.id = r.geranet_api_key_secret_id
    WHERE r.geranet_api_key_secret_id IS NOT NULL
      AND btrim(coalesce(s.decrypted_secret, '')) <> ''
  ) d;

  RETURN jsonb_build_object(
    'configurada', coalesce(v_configurada, false),
    'mascara', v_mascara,
    'migracao', coalesce(v_migracao, 'pendente'),
    'empresas_com_chave', v_empresas,
    'chaves_empresa_distintas', v_distintas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_master_salvar_api_key_geranet(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_master_salvar_api_key_geranet(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_master_salvar_api_key_geranet(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_master_salvar_api_key_geranet(text) TO service_role;

REVOKE ALL ON FUNCTION public.obter_api_key_geranet_plataforma() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obter_api_key_geranet_plataforma() FROM anon;
REVOKE ALL ON FUNCTION public.obter_api_key_geranet_plataforma() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.obter_api_key_geranet_plataforma() TO service_role;

REVOKE ALL ON FUNCTION public.diagnostico_api_key_geranet_plataforma() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diagnostico_api_key_geranet_plataforma() FROM anon;
REVOKE ALL ON FUNCTION public.diagnostico_api_key_geranet_plataforma() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diagnostico_api_key_geranet_plataforma() TO service_role;

DO $$
DECLARE
  v_distintas integer;
  v_valor text;
  v_id uuid;
  v_nome text := 'ultrapdv:plataforma:geranet_api_key';
BEGIN
  SELECT count(*)
    INTO v_distintas
  FROM (
    SELECT DISTINCT btrim(s.decrypted_secret)
    FROM public.fiscal_segredos_refs r
    JOIN vault.decrypted_secrets s ON s.id = r.geranet_api_key_secret_id
    WHERE r.geranet_api_key_secret_id IS NOT NULL
      AND btrim(coalesce(s.decrypted_secret, '')) <> ''
  ) d;

  IF v_distintas = 0 THEN
    UPDATE public.plataforma_segredos_refs
    SET migracao_chaves_empresa = 'vazia'
    WHERE id;
    RAISE NOTICE 'UltraPDV: nenhuma API Key Geranet de empresa para copiar.';
    RETURN;
  END IF;

  IF v_distintas > 1 THEN
    UPDATE public.plataforma_segredos_refs
    SET migracao_chaves_empresa = 'divergente'
    WHERE id;
    RAISE NOTICE 'UltraPDV: empresas possuem API Keys Geranet distintas. Cópia automática interrompida. Defina a chave em Master → Integrações → Geranet. As chaves por empresa foram preservadas.';
    RETURN;
  END IF;

  SELECT btrim(s.decrypted_secret)
    INTO v_valor
  FROM public.fiscal_segredos_refs r
  JOIN vault.decrypted_secrets s ON s.id = r.geranet_api_key_secret_id
  WHERE r.geranet_api_key_secret_id IS NOT NULL
    AND btrim(coalesce(s.decrypted_secret, '')) <> ''
  LIMIT 1;

  SELECT s.id
    INTO v_id
  FROM vault.secrets s
  WHERE s.name = v_nome
  LIMIT 1;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(
      v_valor,
      v_nome,
      'UltraPDV API Key Geranet (plataforma)'
    );
    SELECT s.id
      INTO v_id
    FROM vault.secrets s
    WHERE s.name = v_nome
    LIMIT 1;
  ELSE
    PERFORM vault.update_secret(
      v_id,
      v_valor,
      v_nome,
      'UltraPDV API Key Geranet (plataforma)'
    );
  END IF;

  UPDATE public.plataforma_segredos_refs
  SET
    geranet_api_key_secret_id = v_id,
    geranet_api_key_configurada = true,
    migracao_chaves_empresa = 'copiada',
    atualizado_em = now()
  WHERE id;

  RAISE NOTICE 'UltraPDV: API Key Geranet única copiada para o cofre da plataforma. Chaves por empresa foram preservadas.';
END;
$$;

-- Empresas não podem mais gravar/alterar a API Key Geranet no cofre por empresa.
-- Linhas existentes são preservadas (somente leitura) para fallback da emissão.
CREATE OR REPLACE FUNCTION public.impedir_alteracao_api_key_geranet_empresa()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.geranet_api_key_secret_id IS NOT NULL THEN
    RAISE EXCEPTION 'api_key_geranet_somente_plataforma'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.geranet_api_key_secret_id IS DISTINCT FROM OLD.geranet_api_key_secret_id THEN
    RAISE EXCEPTION 'api_key_geranet_somente_plataforma'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.impedir_alteracao_api_key_geranet_empresa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.impedir_alteracao_api_key_geranet_empresa() FROM anon;
REVOKE ALL ON FUNCTION public.impedir_alteracao_api_key_geranet_empresa() FROM authenticated;

DROP TRIGGER IF EXISTS trg_impedir_alteracao_api_key_geranet_empresa
  ON public.fiscal_segredos_refs;

CREATE TRIGGER trg_impedir_alteracao_api_key_geranet_empresa
BEFORE INSERT OR UPDATE ON public.fiscal_segredos_refs
FOR EACH ROW
EXECUTE FUNCTION public.impedir_alteracao_api_key_geranet_empresa();

NOTIFY pgrst, 'reload schema';

COMMIT;
