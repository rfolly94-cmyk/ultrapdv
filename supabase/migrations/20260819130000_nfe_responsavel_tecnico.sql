BEGIN;

-- UltraPDV — Responsável técnico da NF-e 55 (nfe.responsavelTecnico)
-- Campos Geranet: cnpj, contato, email, fone, idCSRT, CSRT
-- Públicos em empresas_fiscal; CSRT no cofre (vault + fiscal_segredos_refs).
-- Sem hardcode global: uma configuração por empresa_id.

ALTER TABLE public.empresas_fiscal
  ADD COLUMN IF NOT EXISTS responsavel_tecnico_cnpj text,
  ADD COLUMN IF NOT EXISTS responsavel_tecnico_contato text,
  ADD COLUMN IF NOT EXISTS responsavel_tecnico_email text,
  ADD COLUMN IF NOT EXISTS responsavel_tecnico_fone text,
  ADD COLUMN IF NOT EXISTS responsavel_tecnico_id_csrt text,
  ADD COLUMN IF NOT EXISTS responsavel_tecnico_csrt_configurado boolean NOT NULL DEFAULT false;

ALTER TABLE public.fiscal_segredos_refs
  ADD COLUMN IF NOT EXISTS csrt_secret_id uuid;

CREATE OR REPLACE FUNCTION public.salvar_csrt_fiscal(
  p_empresa_id uuid,
  p_valor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_nome text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado';
  END IF;

  IF NOT public.eh_admin_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Sem permissão para configurar esta empresa.';
  END IF;

  IF p_valor IS NULL OR btrim(p_valor) = '' THEN
    RAISE EXCEPTION 'CSRT vazio';
  END IF;

  v_nome := 'ultrapdv:' || p_empresa_id::text || ':csrt';

  SELECT r.csrt_secret_id
  INTO v_id
  FROM public.fiscal_segredos_refs r
  WHERE r.empresa_id = p_empresa_id;

  IF v_id IS NULL THEN
    SELECT s.id
    INTO v_id
    FROM vault.secrets s
    WHERE s.name = v_nome
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_valor, v_nome, 'UltraPDV CSRT NF-e');
    SELECT s.id
    INTO v_id
    FROM vault.secrets s
    WHERE s.name = v_nome
    LIMIT 1;
  ELSE
    PERFORM vault.update_secret(v_id, p_valor, v_nome, 'UltraPDV CSRT NF-e');
  END IF;

  UPDATE public.fiscal_segredos_refs
  SET csrt_secret_id = v_id
  WHERE empresa_id = p_empresa_id;

  IF NOT FOUND THEN
    INSERT INTO public.fiscal_segredos_refs (empresa_id, csrt_secret_id)
    VALUES (p_empresa_id, v_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_csrt_fiscal(
  p_empresa_id uuid
)
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
    RAISE EXCEPTION 'obter_csrt_fiscal restrito ao servidor';
  END IF;

  SELECT r.csrt_secret_id
  INTO v_id
  FROM public.fiscal_segredos_refs r
  WHERE r.empresa_id = p_empresa_id;

  IF v_id IS NULL THEN
    SELECT s.id
    INTO v_id
    FROM vault.secrets s
    WHERE s.name = ('ultrapdv:' || p_empresa_id::text || ':csrt')
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.decrypted_secret
  INTO v_valor
  FROM vault.decrypted_secrets s
  WHERE s.id = v_id;

  RETURN v_valor;
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_csrt_fiscal(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salvar_csrt_fiscal(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.salvar_csrt_fiscal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_csrt_fiscal(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.obter_csrt_fiscal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obter_csrt_fiscal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.obter_csrt_fiscal(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.obter_csrt_fiscal(uuid) TO service_role;

COMMIT;
