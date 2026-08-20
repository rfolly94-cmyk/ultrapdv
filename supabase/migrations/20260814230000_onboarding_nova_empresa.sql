BEGIN;

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
SET search_path = public, auth
AS $$
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

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_usuario_id
  ) THEN
    RAISE EXCEPTION 'Usuário autenticado não encontrado.';
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

  -- Impede duas criações simultâneas para o mesmo usuário/CNPJ.
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

  -- A migration de formas de pagamento padrão já possui
  -- trigger AFTER INSERT em empresas; portanto a nova empresa
  -- recebe automaticamente Dinheiro, PIX, Cartões e Fiado.

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

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'usuario_id', p_usuario_id,
    'perfil', 'administrador'
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.rpc_criar_empresa_onboarding(
  uuid,
  text,
  text,
  text,
  text,
  text
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.rpc_criar_empresa_onboarding(
  uuid,
  text,
  text,
  text,
  text,
  text
)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.rpc_criar_empresa_onboarding(
  uuid,
  text,
  text,
  text,
  text,
  text
)
TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
