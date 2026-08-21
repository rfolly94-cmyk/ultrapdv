BEGIN;

-- ============================================================
-- UltraPDV — Planos SaaS: recursos, limites e snapshot de preço
-- Data: 2026-08-21
--
-- Incremental. Preserva Básico/Pro/Premium e assinaturas.
-- Não bloqueia ERP/PDV. Catálogos são globais da plataforma.
-- Assinaturas continuam isoladas por empresa_id.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Evolução do catálogo de planos
-- ------------------------------------------------------------
ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS valor_anual numeric(12, 2),
  ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS texto_destaque text,
  ADD COLUMN IF NOT EXISTS dias_teste integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nivel_suporte text NOT NULL DEFAULT 'normal';

ALTER TABLE public.planos
  DROP CONSTRAINT IF EXISTS planos_dias_teste_check;
ALTER TABLE public.planos
  ADD CONSTRAINT planos_dias_teste_check
  CHECK (dias_teste >= 0);

ALTER TABLE public.planos
  DROP CONSTRAINT IF EXISTS planos_valor_mensal_check;
ALTER TABLE public.planos
  ADD CONSTRAINT planos_valor_mensal_check
  CHECK (valor_mensal IS NULL OR valor_mensal >= 0);

ALTER TABLE public.planos
  DROP CONSTRAINT IF EXISTS planos_valor_anual_check;
ALTER TABLE public.planos
  ADD CONSTRAINT planos_valor_anual_check
  CHECK (valor_anual IS NULL OR valor_anual >= 0);

ALTER TABLE public.planos
  DROP CONSTRAINT IF EXISTS planos_nivel_suporte_check;
ALTER TABLE public.planos
  ADD CONSTRAINT planos_nivel_suporte_check
  CHECK (nivel_suporte = ANY (ARRAY['normal', 'prioritario', 'premium']::text[]));

-- ------------------------------------------------------------
-- 2) Snapshot de preço na assinatura da empresa
-- ------------------------------------------------------------
ALTER TABLE public.assinaturas_empresas
  ADD COLUMN IF NOT EXISTS valor_mensal_contratado numeric(12, 2);

ALTER TABLE public.assinaturas_empresas
  DROP CONSTRAINT IF EXISTS assinaturas_empresas_valor_contratado_check;
ALTER TABLE public.assinaturas_empresas
  ADD CONSTRAINT assinaturas_empresas_valor_contratado_check
  CHECK (
    valor_mensal_contratado IS NULL
    OR valor_mensal_contratado >= 0
  );

UPDATE public.assinaturas_empresas a
SET valor_mensal_contratado = p.valor_mensal
FROM public.planos p
WHERE a.plano_id = p.id
  AND a.valor_mensal_contratado IS NULL;

CREATE OR REPLACE FUNCTION public.criar_assinatura_inicial_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plano uuid;
  v_valor numeric(12, 2);
BEGIN
  SELECT id, valor_mensal
    INTO v_plano, v_valor
  FROM public.planos
  WHERE nome = 'Básico'
  LIMIT 1;

  INSERT INTO public.assinaturas_empresas (
    empresa_id,
    plano_id,
    status,
    inicio_em,
    vencimento_em,
    valor_mensal_contratado
  )
  VALUES (
    NEW.id,
    v_plano,
    'trial',
    now(),
    (current_date + 7),
    v_valor
  )
  ON CONFLICT (empresa_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_assinatura_inicial_empresa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_assinatura_inicial_empresa() FROM anon;
REVOKE ALL ON FUNCTION public.criar_assinatura_inicial_empresa() FROM authenticated;

-- ------------------------------------------------------------
-- 3) Catálogo global de recursos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recursos_plataforma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL,
  nome text NOT NULL,
  descricao text,
  categoria text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recursos_plataforma_chave_unica UNIQUE (chave),
  CONSTRAINT recursos_plataforma_chave_formato
    CHECK (chave ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT recursos_plataforma_nome_nao_vazio
    CHECK (length(btrim(nome)) > 0),
  CONSTRAINT recursos_plataforma_categoria_check
    CHECK (categoria = ANY (ARRAY[
      'comercial',
      'fiscal',
      'contabilidade',
      'integracoes',
      'suporte'
    ]::text[]))
);

CREATE INDEX IF NOT EXISTS recursos_plataforma_categoria_ordem_idx
  ON public.recursos_plataforma (categoria, ordem);

ALTER TABLE public.recursos_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recursos_plataforma FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.recursos_plataforma FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.recursos_plataforma TO authenticated;
GRANT ALL ON TABLE public.recursos_plataforma TO service_role;

DROP POLICY IF EXISTS recursos_plataforma_select ON public.recursos_plataforma;
CREATE POLICY recursos_plataforma_select
  ON public.recursos_plataforma
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.recursos_plataforma (chave, nome, descricao, categoria, ordem, ativo)
VALUES
  ('pdv', 'PDV', 'Sistema de frente de caixa.', 'comercial', 10, true),
  ('vendas', 'Vendas', 'Histórico e gestão de vendas.', 'comercial', 20, true),
  ('produtos', 'Produtos', 'Cadastro e gestão de produtos.', 'comercial', 30, true),
  ('clientes', 'Clientes', 'Cadastro de clientes.', 'comercial', 40, true),
  ('estoque', 'Estoque', 'Controle de estoque.', 'comercial', 50, true),
  ('carteira', 'Carteira', 'Vendas fiado e recebimentos.', 'comercial', 60, true),
  ('relatorios', 'Relatórios', 'Relatórios operacionais.', 'comercial', 70, true),
  ('nfce', 'NFC-e', 'Emissão de NFC-e.', 'fiscal', 10, true),
  ('nfe', 'NF-e', 'Emissão de NF-e.', 'fiscal', 20, true),
  ('cce', 'Carta de Correção Eletrônica', 'CC-e para NF-e autorizada.', 'fiscal', 30, true),
  ('inutilizacao_fiscal', 'Inutilização de numeração', 'Inutilização fiscal de numeração.', 'fiscal', 40, true),
  ('contabilidade', 'Contabilidade', 'Área da contadora.', 'contabilidade', 10, true),
  ('importador', 'Importador de dados', 'Importação de cadastros.', 'integracoes', 10, true),
  ('pix_integrado', 'PIX integrado', 'Recebimento PIX no PDV.', 'integracoes', 20, true),
  ('impressao_automatica', 'Impressão automática', 'UltraPDV Conector e impressão automática.', 'integracoes', 30, true),
  ('suporte_prioritario', 'Suporte prioritário', 'Atendimento com prioridade.', 'suporte', 10, true)
ON CONFLICT (chave) DO UPDATE
SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  categoria = EXCLUDED.categoria,
  ordem = EXCLUDED.ordem,
  updated_at = now();

-- ------------------------------------------------------------
-- 4) Recursos por plano
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planos_recursos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.planos (id) ON DELETE CASCADE,
  recurso_id uuid NOT NULL REFERENCES public.recursos_plataforma (id) ON DELETE CASCADE,
  habilitado boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planos_recursos_unico UNIQUE (plano_id, recurso_id)
);

CREATE INDEX IF NOT EXISTS planos_recursos_plano_idx
  ON public.planos_recursos (plano_id);

ALTER TABLE public.planos_recursos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos_recursos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planos_recursos FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.planos_recursos TO authenticated;
GRANT ALL ON TABLE public.planos_recursos TO service_role;

DROP POLICY IF EXISTS planos_recursos_select ON public.planos_recursos;
CREATE POLICY planos_recursos_select
  ON public.planos_recursos
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.planos_recursos (plano_id, recurso_id, habilitado)
SELECT p.id, r.id, true
FROM public.planos p
CROSS JOIN public.recursos_plataforma r
WHERE r.ativo = true
ON CONFLICT (plano_id, recurso_id) DO NOTHING;

-- ------------------------------------------------------------
-- 5) Limites extensíveis por plano (NULL = ilimitado)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planos_limites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.planos (id) ON DELETE CASCADE,
  chave text NOT NULL,
  valor integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planos_limites_unico UNIQUE (plano_id, chave),
  CONSTRAINT planos_limites_chave_formato
    CHECK (chave ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT planos_limites_valor_check
    CHECK (valor IS NULL OR valor >= 0)
);

CREATE INDEX IF NOT EXISTS planos_limites_plano_idx
  ON public.planos_limites (plano_id);

ALTER TABLE public.planos_limites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos_limites FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planos_limites FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.planos_limites TO authenticated;
GRANT ALL ON TABLE public.planos_limites TO service_role;

DROP POLICY IF EXISTS planos_limites_select ON public.planos_limites;
CREATE POLICY planos_limites_select
  ON public.planos_limites
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.planos_limites (plano_id, chave, valor)
SELECT p.id, limite.chave, NULL
FROM public.planos p
CROSS JOIN (VALUES ('usuarios'), ('filiais')) AS limite(chave)
ON CONFLICT (plano_id, chave) DO NOTHING;

-- ------------------------------------------------------------
-- 6) RPC transacional Master
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_master_salvar_plano(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin uuid;
  v_id uuid;
  v_nome text;
  v_descricao text;
  v_valor_mensal numeric(12, 2);
  v_valor_anual numeric(12, 2);
  v_ordem integer;
  v_ativo boolean;
  v_destaque boolean;
  v_texto_destaque text;
  v_dias_teste integer;
  v_nivel_suporte text;
  v_limites jsonb;
  v_recursos jsonb;
  v_antes jsonb;
  v_chave text;
  v_valor integer;
  v_habilitado boolean;
  v_recurso_id uuid;
  v_criando boolean := false;
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

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload_invalido'
      USING ERRCODE = '22023';
  END IF;

  v_id := NULLIF(btrim(coalesce(p_payload->>'id', '')), '')::uuid;
  v_nome := btrim(coalesce(p_payload->>'nome', ''));
  v_descricao := NULLIF(btrim(coalesce(p_payload->>'descricao', '')), '');
  v_valor_mensal := NULLIF(p_payload->>'valor_mensal', '')::numeric;
  v_valor_anual := NULLIF(p_payload->>'valor_anual', '')::numeric;
  v_ordem := coalesce(NULLIF(p_payload->>'ordem', '')::integer, 0);
  v_ativo := coalesce((p_payload->>'ativo')::boolean, true);
  v_destaque := coalesce((p_payload->>'destaque')::boolean, false);
  v_texto_destaque := NULLIF(btrim(coalesce(p_payload->>'texto_destaque', '')), '');
  v_dias_teste := coalesce(NULLIF(p_payload->>'dias_teste', '')::integer, 0);
  v_nivel_suporte := coalesce(NULLIF(btrim(p_payload->>'nivel_suporte'), ''), 'normal');
  v_limites := coalesce(p_payload->'limites', '{}'::jsonb);
  v_recursos := coalesce(p_payload->'recursos', '{}'::jsonb);

  IF v_nome = '' THEN
    RAISE EXCEPTION 'nome_obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  IF v_valor_mensal IS NOT NULL AND v_valor_mensal < 0 THEN
    RAISE EXCEPTION 'valor_mensal_invalido'
      USING ERRCODE = '22023';
  END IF;

  IF v_valor_anual IS NOT NULL AND v_valor_anual < 0 THEN
    RAISE EXCEPTION 'valor_anual_invalido'
      USING ERRCODE = '22023';
  END IF;

  IF v_dias_teste < 0 THEN
    RAISE EXCEPTION 'dias_teste_invalido'
      USING ERRCODE = '22023';
  END IF;

  IF v_nivel_suporte NOT IN ('normal', 'prioritario', 'premium') THEN
    RAISE EXCEPTION 'nivel_suporte_invalido'
      USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    v_criando := true;
    INSERT INTO public.planos (
      nome,
      descricao,
      valor_mensal,
      valor_anual,
      ordem,
      ativo,
      destaque,
      texto_destaque,
      dias_teste,
      nivel_suporte
    )
    VALUES (
      v_nome,
      v_descricao,
      v_valor_mensal,
      v_valor_anual,
      v_ordem,
      v_ativo,
      v_destaque,
      v_texto_destaque,
      v_dias_teste,
      v_nivel_suporte
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT jsonb_build_object(
      'nome', nome,
      'descricao', descricao,
      'valor_mensal', valor_mensal,
      'valor_anual', valor_anual,
      'ordem', ordem,
      'ativo', ativo,
      'destaque', destaque,
      'texto_destaque', texto_destaque,
      'dias_teste', dias_teste,
      'nivel_suporte', nivel_suporte
    )
      INTO v_antes
    FROM public.planos
    WHERE id = v_id;

    IF v_antes IS NULL THEN
      RAISE EXCEPTION 'plano_nao_encontrado'
        USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.planos
    SET
      nome = v_nome,
      descricao = v_descricao,
      valor_mensal = v_valor_mensal,
      valor_anual = v_valor_anual,
      ordem = v_ordem,
      ativo = v_ativo,
      destaque = v_destaque,
      texto_destaque = v_texto_destaque,
      dias_teste = v_dias_teste,
      nivel_suporte = v_nivel_suporte,
      updated_at = now()
    WHERE id = v_id;
  END IF;

  FOR v_chave, v_valor IN
    SELECT key, CASE
      WHEN value = 'null'::jsonb THEN NULL
      ELSE (value #>> '{}')::integer
    END
    FROM jsonb_each(v_limites)
  LOOP
    IF v_chave NOT IN ('usuarios', 'filiais') THEN
      RAISE EXCEPTION 'limite_desconhecido'
        USING ERRCODE = '22023';
    END IF;

    IF v_valor IS NOT NULL AND v_valor < 0 THEN
      RAISE EXCEPTION 'limite_invalido'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.planos_limites (plano_id, chave, valor)
    VALUES (v_id, v_chave, v_valor)
    ON CONFLICT (plano_id, chave) DO UPDATE
    SET
      valor = EXCLUDED.valor,
      updated_at = now();
  END LOOP;

  FOR v_chave, v_habilitado IN
    SELECT key, (value = 'true'::jsonb)
    FROM jsonb_each(v_recursos)
  LOOP
    SELECT id INTO v_recurso_id
    FROM public.recursos_plataforma
    WHERE chave = v_chave
    LIMIT 1;

    IF v_recurso_id IS NULL THEN
      RAISE EXCEPTION 'recurso_desconhecido'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.planos_recursos (plano_id, recurso_id, habilitado)
    VALUES (v_id, v_recurso_id, coalesce(v_habilitado, false))
    ON CONFLICT (plano_id, recurso_id) DO UPDATE
    SET
      habilitado = EXCLUDED.habilitado,
      updated_at = now();
  END LOOP;

  INSERT INTO public.plataforma_auditoria (
    admin_usuario_id,
    acao,
    metadados
  )
  VALUES (
    v_admin,
    CASE
      WHEN v_criando THEN 'plano_criado'
      WHEN v_ativo THEN 'plano_atualizado'
      ELSE 'plano_desativado'
    END,
    jsonb_build_object(
      'plano_id', v_id,
      'nome', v_nome,
      'antes', v_antes,
      'depois', jsonb_build_object(
        'nome', v_nome,
        'valor_mensal', v_valor_mensal,
        'valor_anual', v_valor_anual,
        'ativo', v_ativo,
        'dias_teste', v_dias_teste,
        'nivel_suporte', v_nivel_suporte,
        'limites', v_limites,
        'recursos', v_recursos
      )
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'nome', v_nome
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_master_salvar_plano(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_master_salvar_plano(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_master_salvar_plano(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_master_salvar_plano(jsonb) TO service_role;

COMMENT ON TABLE public.recursos_plataforma IS
  'Catálogo global de recursos do SaaS. Não pertence a uma empresa.';

COMMENT ON TABLE public.planos_recursos IS
  'Recursos habilitados em cada plano comercial.';

COMMENT ON TABLE public.planos_limites IS
  'Limites do plano. valor NULL significa ilimitado.';

COMMENT ON COLUMN public.assinaturas_empresas.valor_mensal_contratado IS
  'Snapshot do valor no contrato da empresa. Não acompanha alteração de catálogo.';

NOTIFY pgrst, 'reload schema';

COMMIT;
