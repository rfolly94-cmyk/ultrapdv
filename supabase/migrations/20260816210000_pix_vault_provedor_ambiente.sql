BEGIN;

-- UltraPDV PIX — vault por provedor e ambiente.
-- Não apaga secrets antigos pix/{empresa}/{tipo}.
-- Leitura nova: pix/{empresa}/{provedor}/{homologacao|producao}/{campo}

CREATE OR REPLACE FUNCTION public.salvar_segredo_bancario_provedor(
  p_empresa_id uuid,
  p_provedor text,
  p_ambiente text,
  p_campo text,
  p_valor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ambiente text;
  v_nome text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'sem acesso a empresa';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = p_empresa_id
      AND ue.ativo = true
      AND ue.perfil = 'administrador'
  ) THEN
    RAISE EXCEPTION 'somente administrador pode gravar segredo bancario';
  END IF;

  IF p_ambiente NOT IN ('1', '2') THEN
    RAISE EXCEPTION 'ambiente pix invalido';
  END IF;

  IF p_provedor IS NULL OR p_provedor !~ '^[a-z0-9]+$' THEN
    RAISE EXCEPTION 'provedor pix invalido';
  END IF;

  IF p_campo NOT IN (
    'clienteId',
    'clienteSegredo',
    'chaveUsuario',
    'chavePix',
    'escopo',
    'token',
    'tokenAcesso',
    'certificadoPemHexadecimal',
    'chavePrivadaPemHexadecimal',
    'certificadoPfxHexadecimal',
    'senhaCertificadoPfx'
  ) THEN
    RAISE EXCEPTION 'campo de credencial Geranet invalido';
  END IF;

  IF p_valor IS NULL OR btrim(p_valor) = '' THEN
    RAISE EXCEPTION 'segredo bancario vazio';
  END IF;

  v_ambiente := CASE WHEN p_ambiente = '1' THEN 'producao' ELSE 'homologacao' END;
  v_nome := 'pix/' || p_empresa_id::text || '/' || p_provedor || '/' || v_ambiente || '/' || p_campo;

  SELECT s.id
  INTO v_id
  FROM vault.secrets s
  WHERE s.name = v_nome
  LIMIT 1;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_valor, v_nome, 'UltraPDV PIX Geranet');
  ELSE
    PERFORM vault.update_secret(v_id, p_valor, v_nome, 'UltraPDV PIX Geranet');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_segredos_bancarios_provedor(
  p_empresa_id uuid,
  p_provedor text,
  p_ambiente text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ambiente text;
  v_prefixo text;
  v_saida jsonb := '{}'::jsonb;
  v_linha record;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'obter_segredos_bancarios_provedor restrito ao servidor';
  END IF;

  IF p_ambiente NOT IN ('1', '2') THEN
    RAISE EXCEPTION 'ambiente pix invalido';
  END IF;

  v_ambiente := CASE WHEN p_ambiente = '1' THEN 'producao' ELSE 'homologacao' END;
  v_prefixo := 'pix/' || p_empresa_id::text || '/' || p_provedor || '/' || v_ambiente || '/';

  FOR v_linha IN
    SELECT
      regexp_replace(s.name, '^' || v_prefixo, '') AS campo,
      s.decrypted_secret AS valor
    FROM vault.decrypted_secrets s
    WHERE s.name LIKE (v_prefixo || '%')
  LOOP
    v_saida := v_saida || jsonb_build_object(v_linha.campo, v_linha.valor);
  END LOOP;

  RETURN v_saida;
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_segredo_bancario_provedor(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salvar_segredo_bancario_provedor(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.salvar_segredo_bancario_provedor(uuid, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.obter_segredos_bancarios_provedor(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obter_segredos_bancarios_provedor(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.obter_segredos_bancarios_provedor(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.obter_segredos_bancarios_provedor(uuid, text, text) TO service_role;

-- Leitura legada continua existindo, mas não mistura o namespace
-- pix/{empresa}/{provedor}/{ambiente}/{campo}.
CREATE OR REPLACE FUNCTION public.obter_segredos_bancarios(
  p_empresa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_saida jsonb := '{}'::jsonb;
  v_linha record;
  v_campo text;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'obter_segredos_bancarios restrito ao servidor';
  END IF;

  FOR v_linha IN
    SELECT
      regexp_replace(s.name, '^pix/' || p_empresa_id::text || '/', '') AS tipo,
      s.decrypted_secret AS valor
    FROM vault.decrypted_secrets s
    WHERE s.name LIKE ('pix/' || p_empresa_id::text || '/%')
  LOOP
    v_campo := v_linha.tipo;
    IF v_campo LIKE '%/%' THEN
      CONTINUE;
    END IF;
    v_saida := v_saida || jsonb_build_object(v_campo, v_linha.valor);
  END LOOP;

  RETURN v_saida;
END;
$$;

COMMIT;
