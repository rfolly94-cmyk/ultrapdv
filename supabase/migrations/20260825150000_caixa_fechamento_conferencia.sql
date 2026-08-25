BEGIN;

-- UltraPDV — Fase 3: conferência por meio, fechamento cego e snapshot.
-- Não edita Fases 1/2A/2B. Não reabre caixa. Diferença não gera sangria/ajuste.

-- ------------------------------------------------------------
-- Configuração por empresa
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.caixa_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas (id) ON DELETE CASCADE,
  fechamento_caixa_cego boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.caixa_configuracoes IS
  'Preferências de caixa por empresa. fechamento_caixa_cego esconde o esperado até confirmar o fechamento.';

COMMENT ON COLUMN public.caixa_configuracoes.fechamento_caixa_cego IS
  'Se true, iniciar conferência não devolve valor esperado nem diferença.';

ALTER TABLE public.caixa_configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_caixa_configuracoes
  ON public.caixa_configuracoes;
CREATE POLICY usuario_visualiza_caixa_configuracoes
  ON public.caixa_configuracoes
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.caixa_configuracoes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.caixa_configuracoes FROM authenticated;
GRANT SELECT ON TABLE public.caixa_configuracoes TO authenticated;
GRANT ALL ON TABLE public.caixa_configuracoes TO service_role;

-- ------------------------------------------------------------
-- Snapshot da conferência (imutável depois do fechamento)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.caixa_fechamentos_meios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  filial_id uuid,
  caixa_id uuid NOT NULL,
  chave text NOT NULL,
  forma_pagamento_id uuid,
  forma_nome_snapshot text NOT NULL,
  forma_tipo_snapshot text,
  forma_codigo_snapshot text,
  afeta_caixa_fisico_snapshot boolean NOT NULL DEFAULT false,
  valor_esperado numeric(14, 2) NOT NULL,
  valor_informado numeric(14, 2) NOT NULL,
  diferenca numeric(14, 2) GENERATED ALWAYS AS (valor_informado - valor_esperado) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixa_fechamentos_meios_empresa_caixa_fk
    FOREIGN KEY (empresa_id, caixa_id)
    REFERENCES public.caixas (empresa_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT caixa_fechamentos_meios_informado_check CHECK (valor_informado >= 0),
  CONSTRAINT caixa_fechamentos_meios_unico UNIQUE (empresa_id, caixa_id, chave)
);

COMMENT ON TABLE public.caixa_fechamentos_meios IS
  'Snapshot da conferência por meio no fechamento. Histórico não relê formas_pagamento.';

CREATE INDEX IF NOT EXISTS ix_caixa_fechamentos_meios_caixa
  ON public.caixa_fechamentos_meios (empresa_id, caixa_id);

ALTER TABLE public.caixa_fechamentos_meios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_caixa_fechamentos_meios
  ON public.caixa_fechamentos_meios;
CREATE POLICY usuario_visualiza_caixa_fechamentos_meios
  ON public.caixa_fechamentos_meios
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.caixa_fechamentos_meios FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.caixa_fechamentos_meios FROM authenticated;
GRANT SELECT ON TABLE public.caixa_fechamentos_meios TO authenticated;
GRANT ALL ON TABLE public.caixa_fechamentos_meios TO service_role;

-- ------------------------------------------------------------
-- Helpers: versão do livro e meios esperados (snapshots do livro)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.caixa_versao_livro(
  p_empresa_id uuid,
  p_caixa_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT md5(
    concat_ws(
      '|',
      c.updated_at::text,
      COALESCE(s.qtd, 0)::text,
      COALESCE(s.entradas, 0)::text,
      COALESCE(s.saidas, 0)::text,
      COALESCE(s.max_created::text, '')
    )
  )
  FROM public.caixas AS c
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::integer AS qtd,
      COALESCE(SUM(m.entrada), 0) AS entradas,
      COALESCE(SUM(m.saida), 0) AS saidas,
      MAX(m.created_at) AS max_created
    FROM public.caixa_movimentacoes AS m
    WHERE m.empresa_id = c.empresa_id
      AND m.caixa_id = c.id
  ) AS s ON true
  WHERE c.empresa_id = p_empresa_id
    AND c.id = p_caixa_id;
$function$;

CREATE OR REPLACE FUNCTION public.caixa_meios_esperados(
  p_empresa_id uuid,
  p_caixa_id uuid
)
RETURNS TABLE (
  chave text,
  forma_pagamento_id uuid,
  forma_nome_snapshot text,
  forma_tipo_snapshot text,
  forma_codigo_snapshot text,
  afeta_caixa_fisico_snapshot boolean,
  valor_esperado numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    g.chave,
    g.forma_pagamento_id,
    COALESCE(NULLIF(btrim(g.forma_nome_snapshot), ''), CASE WHEN g.afeta_caixa_fisico_snapshot THEN 'Dinheiro' ELSE 'Sem forma' END) AS forma_nome_snapshot,
    NULLIF(btrim(g.forma_tipo_snapshot), '') AS forma_tipo_snapshot,
    NULLIF(btrim(g.forma_codigo_snapshot), '') AS forma_codigo_snapshot,
    g.afeta_caixa_fisico_snapshot,
    g.valor_esperado
  FROM (
    SELECT
      CASE
        WHEN m.forma_pagamento_id IS NOT NULL THEN m.forma_pagamento_id::text
        ELSE concat_ws(
          '|',
          '',
          COALESCE(m.forma_nome, ''),
          COALESCE(m.forma_tipo, ''),
          COALESCE(m.forma_codigo, ''),
          CASE
            WHEN m.tipo IN ('abertura', 'suprimento', 'sangria')
              OR COALESCE(m.afeta_caixa_fisico_snapshot, false)
            THEN '1'
            ELSE '0'
          END
        )
      END AS chave,
      m.forma_pagamento_id,
      MAX(m.forma_nome) FILTER (WHERE NULLIF(btrim(m.forma_nome), '') IS NOT NULL) AS forma_nome_snapshot,
      MAX(m.forma_tipo) FILTER (WHERE NULLIF(btrim(m.forma_tipo), '') IS NOT NULL) AS forma_tipo_snapshot,
      MAX(m.forma_codigo) FILTER (WHERE NULLIF(btrim(m.forma_codigo), '') IS NOT NULL) AS forma_codigo_snapshot,
      BOOL_OR(
        m.tipo IN ('abertura', 'suprimento', 'sangria')
        OR COALESCE(m.afeta_caixa_fisico_snapshot, false)
      ) AS afeta_caixa_fisico_snapshot,
      ROUND(SUM(m.entrada - m.saida), 2)::numeric(14, 2) AS valor_esperado
    FROM public.caixa_movimentacoes AS m
    WHERE m.empresa_id = p_empresa_id
      AND m.caixa_id = p_caixa_id
    GROUP BY 1, 2
  ) AS g
  ORDER BY
    CASE WHEN g.afeta_caixa_fisico_snapshot THEN 0 ELSE 1 END,
    g.forma_nome_snapshot;
$function$;

REVOKE ALL ON FUNCTION public.caixa_versao_livro(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.caixa_meios_esperados(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_versao_livro(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.caixa_meios_esperados(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- Config: fechamento cego
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_definir_fechamento_caixa_cego(
  p_habilitado boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  INSERT INTO public.caixa_configuracoes (empresa_id, fechamento_caixa_cego, updated_at)
  VALUES (v_empresa_id, COALESCE(p_habilitado, false), now())
  ON CONFLICT (empresa_id) DO UPDATE
  SET
    fechamento_caixa_cego = EXCLUDED.fechamento_caixa_cego,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'fechamento_caixa_cego', COALESCE(p_habilitado, false)
  );
END;
$function$;

-- ------------------------------------------------------------
-- Iniciar conferência (não revela esperado se cego)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_iniciar_fechamento_caixa(
  p_caixa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_caixa public.caixas%ROWTYPE;
  v_cego boolean := false;
  v_versao text;
  v_qtd integer;
  v_meios jsonb := '[]'::jsonb;
  v_meio record;
  v_item jsonb;
  v_saldo_inicial numeric(14, 2) := 0;
  v_vendas numeric(14, 2) := 0;
  v_recebimentos numeric(14, 2) := 0;
  v_suprimentos numeric(14, 2) := 0;
  v_sangrias numeric(14, 2) := 0;
  v_estornos numeric(14, 2) := 0;
  v_fisico numeric(14, 2) := 0;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Caixa é obrigatório.';
  END IF;

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.id = p_caixa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.';
  END IF;

  IF v_caixa.status IS DISTINCT FROM 'aberto' THEN
    RAISE EXCEPTION 'Este caixa já está fechado.';
  END IF;

  SELECT COALESCE(cfg.fechamento_caixa_cego, false)
  INTO v_cego
  FROM public.caixa_configuracoes AS cfg
  WHERE cfg.empresa_id = v_empresa_id;

  v_cego := COALESCE(v_cego, false);

  SELECT COUNT(*)::integer
  INTO v_qtd
  FROM public.caixa_movimentacoes AS m
  WHERE m.empresa_id = v_empresa_id
    AND m.caixa_id = v_caixa.id;

  v_versao := public.caixa_versao_livro(v_empresa_id, v_caixa.id);

  SELECT
    COALESCE(SUM(m.entrada) FILTER (WHERE m.tipo = 'abertura'), 0),
    COALESCE(SUM(m.entrada - m.saida) FILTER (WHERE m.tipo = 'venda'), 0),
    COALESCE(SUM(m.entrada - m.saida) FILTER (WHERE m.tipo = 'recebimento_carteira'), 0),
    COALESCE(SUM(m.entrada) FILTER (WHERE m.tipo = 'suprimento'), 0),
    COALESCE(SUM(m.saida) FILTER (WHERE m.tipo = 'sangria'), 0),
    COALESCE(SUM(m.saida - m.entrada) FILTER (WHERE m.tipo = 'estorno_recebimento'), 0)
  INTO
    v_saldo_inicial,
    v_vendas,
    v_recebimentos,
    v_suprimentos,
    v_sangrias,
    v_estornos
  FROM public.caixa_movimentacoes AS m
  WHERE m.empresa_id = v_empresa_id
    AND m.caixa_id = v_caixa.id;

  v_fisico := public.caixa_saldo_dinheiro(v_empresa_id, v_caixa.id);

  FOR v_meio IN
    SELECT *
    FROM public.caixa_meios_esperados(v_empresa_id, v_caixa.id)
  LOOP
    v_item := jsonb_build_object(
      'chave', v_meio.chave,
      'forma_pagamento_id', v_meio.forma_pagamento_id,
      'forma_nome', v_meio.forma_nome_snapshot,
      'forma_tipo', v_meio.forma_tipo_snapshot,
      'forma_codigo', v_meio.forma_codigo_snapshot,
      'afeta_caixa_fisico', v_meio.afeta_caixa_fisico_snapshot
    );
    IF NOT v_cego THEN
      v_item := v_item || jsonb_build_object('valor_esperado', v_meio.valor_esperado);
    END IF;
    v_meios := v_meios || jsonb_build_array(v_item);
  END LOOP;

  RETURN jsonb_strip_nulls(
    jsonb_build_object(
      'ok', true,
      'caixa_id', v_caixa.id,
      'numero', v_caixa.numero,
      'aberto_em', v_caixa.aberto_em,
      'usuario_abertura_id', v_caixa.usuario_abertura_id,
      'versao_livro', v_versao,
      'movimentos_qtd', v_qtd,
      'fechamento_cego', v_cego,
      'saldo_inicial', v_saldo_inicial,
      'vendas_liquidas', v_vendas,
      'recebimentos_carteira', v_recebimentos,
      'suprimentos', v_suprimentos,
      'sangrias', v_sangrias,
      'estornos', v_estornos,
      'dinheiro_fisico_esperado', CASE WHEN v_cego THEN NULL ELSE v_fisico END,
      'meios', v_meios
    )
  );
END;
$function$;

-- ------------------------------------------------------------
-- Confirmar fechamento atômico: snapshot + fechar
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_confirmar_fechamento_caixa(
  p_caixa_id uuid,
  p_versao_livro text,
  p_meios jsonb,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_observacao text := NULLIF(btrim(p_observacao), '');
  v_caixa public.caixas%ROWTYPE;
  v_versao text;
  v_meio record;
  v_informado numeric(14, 2);
  v_qtd_esperados integer := 0;
  v_qtd_informados integer := 0;
  v_contado numeric(14, 2) := 0;
  v_fisico numeric(14, 2) := 0;
  v_diferenca numeric(14, 2) := 0;
  v_fechado_em timestamptz := now();
  v_snapshot jsonb := '[]'::jsonb;
  v_chaves text[] := ARRAY[]::text[];
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Caixa é obrigatório.';
  END IF;

  IF NULLIF(btrim(p_versao_livro), '') IS NULL THEN
    RAISE EXCEPTION 'Atualize a conferência antes de fechar.';
  END IF;

  IF jsonb_typeof(p_meios) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Informe os valores conferidos de cada forma.';
  END IF;

  IF v_observacao IS NOT NULL AND char_length(v_observacao) > 500 THEN
    RAISE EXCEPTION 'A observação do fechamento deve ter no máximo 500 caracteres.';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_qtd_informados
  FROM jsonb_array_elements(p_meios) AS item;

  SELECT COUNT(*)::integer
  INTO v_qtd_esperados
  FROM (
    SELECT item->>'chave' AS chave
    FROM jsonb_array_elements(p_meios) AS item
    GROUP BY 1
  ) AS unicos;

  IF v_qtd_informados IS DISTINCT FROM v_qtd_esperados THEN
    RAISE EXCEPTION 'Há formas duplicadas na conferência.';
  END IF;

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.id = p_caixa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.';
  END IF;

  IF v_caixa.status IS DISTINCT FROM 'aberto' THEN
    RAISE EXCEPTION 'Este caixa já está fechado.';
  END IF;

  v_versao := public.caixa_versao_livro(v_empresa_id, v_caixa.id);

  IF v_versao IS DISTINCT FROM btrim(p_versao_livro) THEN
    RAISE EXCEPTION 'O caixa recebeu novas movimentações. Atualize a conferência antes de fechar.';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_qtd_esperados
  FROM public.caixa_meios_esperados(v_empresa_id, v_caixa.id);

  IF v_qtd_informados IS DISTINCT FROM v_qtd_esperados THEN
    RAISE EXCEPTION 'Informe o valor conferido de todas as formas.';
  END IF;

  FOR v_meio IN
    SELECT *
    FROM public.caixa_meios_esperados(v_empresa_id, v_caixa.id)
  LOOP
    SELECT round((item->>'valor_informado')::numeric, 2)
    INTO v_informado
    FROM jsonb_array_elements(p_meios) AS item
    WHERE item->>'chave' = v_meio.chave;

    IF v_informado IS NULL THEN
      RAISE EXCEPTION 'Informe o valor conferido de todas as formas.';
    END IF;

    IF v_informado < 0 THEN
      RAISE EXCEPTION 'O valor informado não pode ser negativo.';
    END IF;

    v_chaves := array_append(v_chaves, v_meio.chave);

    INSERT INTO public.caixa_fechamentos_meios (
      empresa_id,
      filial_id,
      caixa_id,
      chave,
      forma_pagamento_id,
      forma_nome_snapshot,
      forma_tipo_snapshot,
      forma_codigo_snapshot,
      afeta_caixa_fisico_snapshot,
      valor_esperado,
      valor_informado
    )
    VALUES (
      v_empresa_id,
      v_caixa.filial_id,
      v_caixa.id,
      v_meio.chave,
      v_meio.forma_pagamento_id,
      v_meio.forma_nome_snapshot,
      v_meio.forma_tipo_snapshot,
      v_meio.forma_codigo_snapshot,
      v_meio.afeta_caixa_fisico_snapshot,
      v_meio.valor_esperado,
      v_informado
    );

    IF v_meio.afeta_caixa_fisico_snapshot THEN
      v_contado := v_contado + v_informado;
    END IF;

    v_snapshot := v_snapshot || jsonb_build_array(
      jsonb_build_object(
        'chave', v_meio.chave,
        'forma_pagamento_id', v_meio.forma_pagamento_id,
        'forma_nome_snapshot', v_meio.forma_nome_snapshot,
        'forma_tipo_snapshot', v_meio.forma_tipo_snapshot,
        'forma_codigo_snapshot', v_meio.forma_codigo_snapshot,
        'afeta_caixa_fisico_snapshot', v_meio.afeta_caixa_fisico_snapshot,
        'valor_esperado', v_meio.valor_esperado,
        'valor_informado', v_informado,
        'diferenca', round(v_informado - v_meio.valor_esperado, 2)
      )
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_meios) AS item
    WHERE NOT (item->>'chave' = ANY (v_chaves))
  ) THEN
    RAISE EXCEPTION 'Informe o valor conferido de todas as formas.';
  END IF;

  v_fisico := public.caixa_saldo_dinheiro(v_empresa_id, v_caixa.id);
  v_diferenca := round(v_contado - v_fisico, 2);

  UPDATE public.caixas
  SET
    status = 'fechado',
    usuario_fechamento_id = v_usuario_id,
    fechado_em = v_fechado_em,
    dinheiro_contado = v_contado,
    diferenca = v_diferenca,
    observacao_fechamento = v_observacao,
    updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id
    AND status = 'aberto';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível fechar o caixa.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'caixa_id', v_caixa.id,
    'fechado_em', v_fechado_em,
    'dinheiro_contado', v_contado,
    'dinheiro_fisico_esperado', v_fisico,
    'diferenca', v_diferenca,
    'meios', v_snapshot
  );
END;
$function$;

-- Fechamento antigo sem conferência deixa de ser válido.
CREATE OR REPLACE FUNCTION public.rpc_fechar_caixa(
  p_caixa_id uuid,
  p_dinheiro_contado numeric,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  RAISE EXCEPTION 'O fechamento exige conferência por meio de pagamento.';
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_definir_fechamento_caixa_cego(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_iniciar_fechamento_caixa(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_confirmar_fechamento_caixa(uuid, text, jsonb, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_definir_fechamento_caixa_cego(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_definir_fechamento_caixa_cego(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_iniciar_fechamento_caixa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_iniciar_fechamento_caixa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_confirmar_fechamento_caixa(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirmar_fechamento_caixa(uuid, text, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.rpc_iniciar_fechamento_caixa(uuid) IS
  'Monta a conferência da sessão aberta da empresa ativa. Com fechamento cego, omite valor esperado.';
COMMENT ON FUNCTION public.rpc_confirmar_fechamento_caixa(uuid, text, jsonb, text) IS
  'Fecha o caixa de forma atômica: grava snapshot da conferência e impede novos movimentos. Recusa livro desatualizado.';
COMMENT ON FUNCTION public.rpc_fechar_caixa(uuid, numeric, text) IS
  'Descontinuado na Fase 3. Use rpc_confirmar_fechamento_caixa.';
COMMENT ON FUNCTION public.rpc_definir_fechamento_caixa_cego(boolean) IS
  'Liga ou desliga fechamento cego da empresa ativa. Permissão é aplicada no servidor da aplicação.';

NOTIFY pgrst, 'reload schema';

COMMIT;
