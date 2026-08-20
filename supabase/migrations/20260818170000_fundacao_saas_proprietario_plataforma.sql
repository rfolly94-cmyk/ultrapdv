BEGIN;

-- ============================================================
-- UltraPDV FASE 2B — Fundação SaaS
-- Data: 2026-08-18
--
-- - proprietario_usuario_id nullable (legado descartável permanece NULL)
-- - onboarding novo SEMPRE preenche o proprietário
-- - e-mail confirmado obrigatório na RPC
-- - administradores_plataforma + auditoria
-- - criar_empresa legado desativado
-- Sem backfill. Sem reset de dados.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Proprietário explícito
-- ------------------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS proprietario_usuario_id uuid
  REFERENCES public.usuarios(id);

CREATE INDEX IF NOT EXISTS empresas_proprietario_usuario_id_idx
  ON public.empresas (proprietario_usuario_id);

CREATE OR REPLACE FUNCTION public.garantir_proprietario_mesma_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.proprietario_usuario_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = NEW.proprietario_usuario_id
      AND ue.empresa_id = NEW.id
      AND ue.ativo = true
  ) THEN
    RAISE EXCEPTION
      'O proprietário precisa ter vínculo ativo na mesma empresa.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS empresas_proprietario_mesma_empresa
  ON public.empresas;

CREATE CONSTRAINT TRIGGER empresas_proprietario_mesma_empresa
AFTER INSERT OR UPDATE OF proprietario_usuario_id
ON public.empresas
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.garantir_proprietario_mesma_empresa();

REVOKE ALL ON FUNCTION public.garantir_proprietario_mesma_empresa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garantir_proprietario_mesma_empresa() FROM anon;
REVOKE ALL ON FUNCTION public.garantir_proprietario_mesma_empresa() FROM authenticated;

-- ------------------------------------------------------------
-- 2) Onboarding: confirmação + proprietário na mesma transação
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 3) criar_empresa legado: não cria mais empresa
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_empresa(
  p_razao_social text,
  p_nome_fantasia text,
  p_cnpj text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION
    'Esta operação foi desativada. Use o cadastro oficial com e-mail confirmado.';
END;
$$;

REVOKE ALL ON FUNCTION public.criar_empresa(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_empresa(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.criar_empresa(text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.criar_empresa(text, text, text) FROM service_role;

-- ------------------------------------------------------------
-- 4) Administradores da plataforma
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.administradores_plataforma (
  usuario_id uuid PRIMARY KEY
    REFERENCES public.usuarios(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
    REFERENCES public.usuarios(id)
);

ALTER TABLE public.administradores_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administradores_plataforma FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS administradores_plataforma_self_select
  ON public.administradores_plataforma;

CREATE POLICY administradores_plataforma_self_select
  ON public.administradores_plataforma
  FOR SELECT
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND ativo = true
  );

REVOKE ALL ON TABLE public.administradores_plataforma FROM PUBLIC;
REVOKE ALL ON TABLE public.administradores_plataforma FROM anon;
REVOKE ALL ON TABLE public.administradores_plataforma FROM authenticated;
GRANT SELECT ON TABLE public.administradores_plataforma TO authenticated;
GRANT ALL ON TABLE public.administradores_plataforma TO service_role;

-- ------------------------------------------------------------
-- 5) Auditoria da plataforma
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plataforma_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_usuario_id uuid NOT NULL
    REFERENCES public.usuarios(id),
  acao text NOT NULL,
  empresa_id uuid
    REFERENCES public.empresas(id),
  usuario_alvo_id uuid
    REFERENCES public.usuarios(id),
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plataforma_auditoria_acao_nao_vazia
    CHECK (length(btrim(acao)) > 0)
);

ALTER TABLE public.plataforma_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plataforma_auditoria FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plataforma_auditoria FROM PUBLIC;
REVOKE ALL ON TABLE public.plataforma_auditoria FROM anon;
REVOKE ALL ON TABLE public.plataforma_auditoria FROM authenticated;
GRANT ALL ON TABLE public.plataforma_auditoria TO service_role;

CREATE INDEX IF NOT EXISTS plataforma_auditoria_admin_criado_idx
  ON public.plataforma_auditoria (admin_usuario_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS plataforma_auditoria_empresa_idx
  ON public.plataforma_auditoria (empresa_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
