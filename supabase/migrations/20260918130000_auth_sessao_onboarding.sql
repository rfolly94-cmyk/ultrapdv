BEGIN;

-- Onboarding: qualquer vínculo prévio (ativo ou não) bloqueia nova empresa.
-- Auditoria mínima de login/logout/bloqueio, sem senha ou token.

CREATE TABLE IF NOT EXISTS public.auth_eventos_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento text NOT NULL,
  usuario_id uuid NULL,
  empresa_id uuid NULL,
  detalhe text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_eventos_acesso_evento_check
    CHECK (evento = ANY (ARRAY[
      'login_sucesso',
      'login_falha',
      'logout',
      'acesso_bloqueado_usuario_inativo',
      'acesso_bloqueado_empresa_inativa'
    ]))
);

COMMENT ON TABLE public.auth_eventos_acesso IS
  'Eventos de acesso sem senha, token ou cookie. Inserção apenas via service_role.';

ALTER TABLE public.auth_eventos_acesso ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_eventos_acesso FROM PUBLIC;
REVOKE ALL ON TABLE public.auth_eventos_acesso FROM anon;
REVOKE ALL ON TABLE public.auth_eventos_acesso FROM authenticated;
GRANT INSERT, SELECT ON TABLE public.auth_eventos_acesso TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_criar_empresa_onboarding(
  p_usuario_id uuid,
  p_email text,
  p_nome text,
  p_razao_social text,
  p_nome_fantasia text,
  p_cnpj text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nome text := btrim(coalesce(p_nome, ''));
  v_razao_social text := btrim(coalesce(p_razao_social, ''));
  v_nome_fantasia text := btrim(coalesce(p_nome_fantasia, ''));
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário inválido.';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_usuario_id THEN
    RAISE EXCEPTION 'Não autorizado a criar empresa para outro usuário.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_usuario_id
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Confirme seu e-mail antes de cadastrar a empresa.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = p_usuario_id
      AND u.ativo = false
  ) THEN
    RAISE EXCEPTION
      'Seu acesso à empresa foi desativado. Entre em contato com o administrador.';
  END IF;

  IF length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Informe o nome do responsável.';
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'E-mail do usuário não encontrado.';
  END IF;

  IF length(v_razao_social) < 2 THEN
    RAISE EXCEPTION 'Informe a razão social.';
  END IF;

  IF length(v_nome_fantasia) < 2 THEN
    RAISE EXCEPTION 'Informe o nome fantasia.';
  END IF;

  IF length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ deve possuir 14 dígitos.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('ultrapdv:onboarding:user:' || p_usuario_id::text)::bigint
  );

  PERFORM pg_advisory_xact_lock(
    hashtext('ultrapdv:onboarding:cnpj:' || v_cnpj)::bigint
  );

  IF EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = p_usuario_id
      AND ue.principal = true
      AND ue.ativo = true
  ) THEN
    RAISE EXCEPTION
      'Este usuário já possui uma empresa principal ativa.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = p_usuario_id
  ) THEN
    RAISE EXCEPTION
      'Seu acesso à empresa foi desativado. Entre em contato com o administrador.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.empresas e
    WHERE regexp_replace(coalesce(e.cnpj, ''), '[^0-9]', '', 'g') = v_cnpj
  ) THEN
    RAISE EXCEPTION
      'Este CNPJ já está cadastrado no UltraPDV.';
  END IF;

  v_empresa_id := gen_random_uuid();

  INSERT INTO public.empresas (
    id,
    razao_social,
    nome_fantasia,
    cnpj,
    ativo
  )
  VALUES (
    v_empresa_id,
    v_razao_social,
    v_nome_fantasia,
    v_cnpj,
    true
  );

  INSERT INTO public.usuarios (
    id,
    nome,
    email,
    ativo
  )
  VALUES (
    p_usuario_id,
    v_nome,
    v_email,
    true
  )
  ON CONFLICT (id)
  DO UPDATE SET
    nome = EXCLUDED.nome,
    email = EXCLUDED.email,
    ativo = true,
    updated_at = now();

  INSERT INTO public.usuarios_empresas (
    usuario_id,
    empresa_id,
    perfil,
    principal,
    ativo
  )
  VALUES (
    p_usuario_id,
    v_empresa_id,
    'administrador',
    true,
    true
  );

  UPDATE public.empresas
  SET proprietario_usuario_id = p_usuario_id
  WHERE id = v_empresa_id;

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'usuario_id', p_usuario_id,
    'proprietario_usuario_id', p_usuario_id,
    'perfil', 'administrador'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) TO service_role;

COMMIT;
