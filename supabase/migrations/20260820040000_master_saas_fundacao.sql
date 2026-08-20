BEGIN;

-- Fundação SaaS enxuta: planos + assinatura por empresa.
-- Master da plataforma continua em administradores_plataforma
-- (equivalente a platform_admins; não duplicar).
-- Histórico reutiliza plataforma_auditoria.
-- empresas.ativo NÃO vira controle de pagamento.

-- ------------------------------------------------------------
-- 1) Planos comerciais
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  valor_mensal numeric(12, 2),
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planos_nome_unico UNIQUE (nome),
  CONSTRAINT planos_nome_nao_vazio CHECK (length(btrim(nome)) > 0)
);

ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planos FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.planos TO authenticated;
GRANT ALL ON TABLE public.planos TO service_role;

DROP POLICY IF EXISTS planos_select_ativos ON public.planos;
CREATE POLICY planos_select_ativos
  ON public.planos
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.planos (nome, descricao, valor_mensal, ativo, ordem)
VALUES
  ('Básico', 'Plano inicial do UltraPDV.', 97, true, 1),
  ('Pro', 'Plano intermediário.', 197, true, 2),
  ('Premium', 'Plano completo.', 297, true, 3)
ON CONFLICT (nome) DO NOTHING;

-- ------------------------------------------------------------
-- 2) Assinatura atual por empresa
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assinaturas_empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  plano_id uuid REFERENCES public.planos (id),
  status text NOT NULL DEFAULT 'ativa',
  inicio_em timestamptz NOT NULL DEFAULT now(),
  vencimento_em date,
  carencia_ate date,
  liberado_ate timestamptz,
  suspenso_em timestamptz,
  cancelado_em timestamptz,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinaturas_empresas_unica UNIQUE (empresa_id),
  CONSTRAINT assinaturas_empresas_status_check
    CHECK (status = ANY (ARRAY[
      'trial',
      'ativa',
      'carencia',
      'suspensa',
      'cancelada'
    ]::text[]))
);

CREATE INDEX IF NOT EXISTS assinaturas_empresas_status_idx
  ON public.assinaturas_empresas (status);

CREATE INDEX IF NOT EXISTS assinaturas_empresas_plano_idx
  ON public.assinaturas_empresas (plano_id);

ALTER TABLE public.assinaturas_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas_empresas FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assinaturas_empresas FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.assinaturas_empresas TO authenticated;
GRANT ALL ON TABLE public.assinaturas_empresas TO service_role;

DROP POLICY IF EXISTS assinaturas_empresas_select_propria
  ON public.assinaturas_empresas;
CREATE POLICY assinaturas_empresas_select_propria
  ON public.assinaturas_empresas
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

-- ------------------------------------------------------------
-- 3) Backfill seguro: empresas existentes entram como ativas
-- ------------------------------------------------------------
INSERT INTO public.assinaturas_empresas (
  empresa_id,
  plano_id,
  status,
  inicio_em,
  updated_at
)
SELECT
  e.id,
  (SELECT p.id FROM public.planos p WHERE p.nome = 'Básico' LIMIT 1),
  'ativa',
  coalesce(e.created_at, now()),
  now()
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.assinaturas_empresas a
  WHERE a.empresa_id = e.id
);

-- ------------------------------------------------------------
-- 4) Nova empresa recebe trial de 7 dias (sem alterar onboarding)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_assinatura_inicial_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plano uuid;
BEGIN
  SELECT id INTO v_plano
  FROM public.planos
  WHERE nome = 'Básico'
  LIMIT 1;

  INSERT INTO public.assinaturas_empresas (
    empresa_id,
    plano_id,
    status,
    inicio_em,
    vencimento_em
  )
  VALUES (
    NEW.id,
    v_plano,
    'trial',
    now(),
    (current_date + 7)
  )
  ON CONFLICT (empresa_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS empresas_criar_assinatura_inicial
  ON public.empresas;

CREATE TRIGGER empresas_criar_assinatura_inicial
AFTER INSERT ON public.empresas
FOR EACH ROW
EXECUTE FUNCTION public.criar_assinatura_inicial_empresa();

REVOKE ALL ON FUNCTION public.criar_assinatura_inicial_empresa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_assinatura_inicial_empresa() FROM anon;
REVOKE ALL ON FUNCTION public.criar_assinatura_inicial_empresa() FROM authenticated;

COMMENT ON TABLE public.planos IS
  'Cadastro comercial de planos. Sem feature flags nesta etapa.';

COMMENT ON TABLE public.assinaturas_empresas IS
  'Situação comercial da empresa. Independente de empresas.ativo.';

COMMENT ON TABLE public.administradores_plataforma IS
  'Master da plataforma UltraPDV (não é perfil de empresa).';

-- Promover o primeiro Master (execute no SQL editor autenticado
-- como o usuário desejado, ou substitua o UUID):
-- INSERT INTO public.administradores_plataforma (usuario_id, ativo)
-- VALUES (auth.uid(), true)
-- ON CONFLICT (usuario_id) DO UPDATE SET ativo = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
