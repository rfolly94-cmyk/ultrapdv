BEGIN;

-- Amplia o allowlist do vault PIX com chaves adicionais documentadas
-- pela Geranet (additionalProperties) sem apagar secrets existentes.

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
    'senhaCertificadoPfx',
    'chaveAplicacaoDesenvolvedor',
    'chaveConsumidor',
    'segredoConsumidor',
    'tokenPagamento',
    'tokenHomologacao',
    'autenticacaoApi',
    'chaveAutenticacao'
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

COMMIT;
