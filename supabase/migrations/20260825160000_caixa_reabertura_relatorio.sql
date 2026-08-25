BEGIN;

-- UltraPDV — Fase 4: reabertura auditável + ciclos de fechamento.
-- Não edita Fases 1/2A/2B/3. Não executa reset.
-- Preserva status operacional 'aberto' para as RPCs existentes.

-- ------------------------------------------------------------
-- Ciclos de fechamento (um caixa pode fechar N vezes)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.caixa_fechamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  filial_id uuid,
  caixa_id uuid NOT NULL,
  versao integer NOT NULL,
  fechado_em timestamptz NOT NULL,
  fechado_por uuid NOT NULL REFERENCES public.usuarios (id),
  dinheiro_contado numeric(14, 2) NOT NULL,
  dinheiro_fisico_esperado numeric(14, 2) NOT NULL,
  diferenca numeric(14, 2) NOT NULL,
  observacao text,
  versao_livro text NOT NULL,
  fechamento_cego boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixa_fechamentos_empresa_id_key UNIQUE (empresa_id, id),
  CONSTRAINT caixa_fechamentos_empresa_caixa_fk
    FOREIGN KEY (empresa_id, caixa_id)
    REFERENCES public.caixas (empresa_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT caixa_fechamentos_versao_unica UNIQUE (empresa_id, caixa_id, versao),
  CONSTRAINT caixa_fechamentos_versao_check CHECK (versao >= 1),
  CONSTRAINT caixa_fechamentos_contado_check CHECK (dinheiro_contado >= 0)
);

COMMENT ON TABLE public.caixa_fechamentos IS
  'Cada fechamento de um caixa. Reabertura não apaga ciclos anteriores.';

CREATE INDEX IF NOT EXISTS ix_caixa_fechamentos_caixa
  ON public.caixa_fechamentos (empresa_id, caixa_id, versao DESC);

ALTER TABLE public.caixa_fechamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_caixa_fechamentos
  ON public.caixa_fechamentos;
CREATE POLICY usuario_visualiza_caixa_fechamentos
  ON public.caixa_fechamentos
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.caixa_fechamentos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.caixa_fechamentos FROM authenticated;
GRANT SELECT ON TABLE public.caixa_fechamentos TO authenticated;
GRANT ALL ON TABLE public.caixa_fechamentos TO service_role;

-- ------------------------------------------------------------
-- Meios passam a pertencer a um ciclo de fechamento
-- ------------------------------------------------------------

ALTER TABLE public.caixa_fechamentos_meios
  ADD COLUMN IF NOT EXISTS caixa_fechamento_id uuid;

INSERT INTO public.caixa_fechamentos (
  empresa_id,
  filial_id,
  caixa_id,
  versao,
  fechado_em,
  fechado_por,
  dinheiro_contado,
  dinheiro_fisico_esperado,
  diferenca,
  observacao,
  versao_livro,
  fechamento_cego
)
SELECT
  c.empresa_id,
  c.filial_id,
  c.id,
  1,
  c.fechado_em,
  c.usuario_fechamento_id,
  c.dinheiro_contado,
  ROUND(c.dinheiro_contado - COALESCE(c.diferenca, 0), 2),
  c.diferenca,
  c.observacao_fechamento,
  'backfill-fase3',
  false
FROM public.caixas AS c
WHERE c.status = 'fechado'
  AND c.fechado_em IS NOT NULL
  AND c.usuario_fechamento_id IS NOT NULL
  AND c.dinheiro_contado IS NOT NULL
  AND c.diferenca IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.caixa_fechamentos AS f
    WHERE f.empresa_id = c.empresa_id
      AND f.caixa_id = c.id
  );

UPDATE public.caixa_fechamentos_meios AS m
SET caixa_fechamento_id = f.id
FROM public.caixa_fechamentos AS f
WHERE m.caixa_fechamento_id IS NULL
  AND f.empresa_id = m.empresa_id
  AND f.caixa_id = m.caixa_id
  AND f.versao = (
    SELECT MAX(f2.versao)
    FROM public.caixa_fechamentos AS f2
    WHERE f2.empresa_id = m.empresa_id
      AND f2.caixa_id = m.caixa_id
  );

INSERT INTO public.caixa_fechamentos (
  empresa_id,
  filial_id,
  caixa_id,
  versao,
  fechado_em,
  fechado_por,
  dinheiro_contado,
  dinheiro_fisico_esperado,
  diferenca,
  observacao,
  versao_livro,
  fechamento_cego
)
SELECT
  c.empresa_id,
  c.filial_id,
  c.id,
  1,
  COALESCE(c.fechado_em, now()),
  COALESCE(c.usuario_fechamento_id, c.usuario_abertura_id),
  COALESCE(c.dinheiro_contado, 0),
  ROUND(COALESCE(c.dinheiro_contado, 0) - COALESCE(c.diferenca, 0), 2),
  COALESCE(c.diferenca, 0),
  c.observacao_fechamento,
  'backfill-meios-orfaos',
  false
FROM public.caixa_fechamentos_meios AS m
INNER JOIN public.caixas AS c
  ON c.empresa_id = m.empresa_id
  AND c.id = m.caixa_id
WHERE m.caixa_fechamento_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.caixa_fechamentos AS f
    WHERE f.empresa_id = m.empresa_id
      AND f.caixa_id = m.caixa_id
  )
GROUP BY
  c.empresa_id,
  c.filial_id,
  c.id,
  c.fechado_em,
  c.usuario_fechamento_id,
  c.usuario_abertura_id,
  c.dinheiro_contado,
  c.diferenca,
  c.observacao_fechamento;

UPDATE public.caixa_fechamentos_meios AS m
SET caixa_fechamento_id = f.id
FROM public.caixa_fechamentos AS f
WHERE m.caixa_fechamento_id IS NULL
  AND f.empresa_id = m.empresa_id
  AND f.caixa_id = m.caixa_id;

DELETE FROM public.caixa_fechamentos_meios
WHERE caixa_fechamento_id IS NULL;

ALTER TABLE public.caixa_fechamentos_meios
  ALTER COLUMN caixa_fechamento_id SET NOT NULL;

ALTER TABLE public.caixa_fechamentos_meios
  DROP CONSTRAINT IF EXISTS caixa_fechamentos_meios_fechamento_fk;

ALTER TABLE public.caixa_fechamentos_meios
  ADD CONSTRAINT caixa_fechamentos_meios_fechamento_fk
  FOREIGN KEY (empresa_id, caixa_fechamento_id)
  REFERENCES public.caixa_fechamentos (empresa_id, id)
  ON DELETE RESTRICT;

ALTER TABLE public.caixa_fechamentos_meios
  DROP CONSTRAINT IF EXISTS caixa_fechamentos_meios_unico;

ALTER TABLE public.caixa_fechamentos_meios
  ADD CONSTRAINT caixa_fechamentos_meios_unico
  UNIQUE (empresa_id, caixa_fechamento_id, chave);

CREATE INDEX IF NOT EXISTS ix_caixa_fechamentos_meios_ciclo
  ON public.caixa_fechamentos_meios (empresa_id, caixa_fechamento_id);

-- ------------------------------------------------------------
-- Flag operacional: sessão foi reaberta (status continua 'aberto')
-- ------------------------------------------------------------

ALTER TABLE public.caixas
  ADD COLUMN IF NOT EXISTS reaberto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.caixas.reaberto IS
  'True se a sessão já foi fechada e reaberta. Status operacional permanece aberto/fechado.';

-- ------------------------------------------------------------
-- Auditoria de reaberturas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.caixa_reaberturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  filial_id uuid,
  caixa_id uuid NOT NULL,
  fechamento_id uuid NOT NULL,
  reaberto_em timestamptz NOT NULL DEFAULT now(),
  reaberto_por uuid NOT NULL REFERENCES public.usuarios (id),
  motivo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixa_reaberturas_empresa_caixa_fk
    FOREIGN KEY (empresa_id, caixa_id)
    REFERENCES public.caixas (empresa_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT caixa_reaberturas_fechamento_fk
    FOREIGN KEY (empresa_id, fechamento_id)
    REFERENCES public.caixa_fechamentos (empresa_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT caixa_reaberturas_motivo_check CHECK (char_length(btrim(motivo)) >= 8)
);

COMMENT ON TABLE public.caixa_reaberturas IS
  'Histórico de reaberturas. Nunca apaga o fechamento apontado por fechamento_id.';

CREATE INDEX IF NOT EXISTS ix_caixa_reaberturas_caixa
  ON public.caixa_reaberturas (empresa_id, caixa_id, reaberto_em);

ALTER TABLE public.caixa_reaberturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_caixa_reaberturas
  ON public.caixa_reaberturas;
CREATE POLICY usuario_visualiza_caixa_reaberturas
  ON public.caixa_reaberturas
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.caixa_reaberturas FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.caixa_reaberturas FROM authenticated;
GRANT SELECT ON TABLE public.caixa_reaberturas TO authenticated;
GRANT ALL ON TABLE public.caixa_reaberturas TO service_role;

-- ------------------------------------------------------------
-- Confirmar fechamento: grava um NOVO ciclo, sem apagar os anteriores
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
  v_ciclo integer := 1;
  v_fechamento_id uuid;
  v_cego boolean := false;
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

  SELECT COALESCE(cfg.fechamento_caixa_cego, false)
  INTO v_cego
  FROM public.caixa_configuracoes AS cfg
  WHERE cfg.empresa_id = v_empresa_id;

  v_cego := COALESCE(v_cego, false);

  SELECT COALESCE(MAX(f.versao), 0) + 1
  INTO v_ciclo
  FROM public.caixa_fechamentos AS f
  WHERE f.empresa_id = v_empresa_id
    AND f.caixa_id = v_caixa.id;

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

  INSERT INTO public.caixa_fechamentos (
    empresa_id,
    filial_id,
    caixa_id,
    versao,
    fechado_em,
    fechado_por,
    dinheiro_contado,
    dinheiro_fisico_esperado,
    diferenca,
    observacao,
    versao_livro,
    fechamento_cego
  )
  VALUES (
    v_empresa_id,
    v_caixa.filial_id,
    v_caixa.id,
    v_ciclo,
    v_fechado_em,
    v_usuario_id,
    v_contado,
    v_fisico,
    v_diferenca,
    v_observacao,
    btrim(p_versao_livro),
    v_cego
  )
  RETURNING id INTO v_fechamento_id;

  INSERT INTO public.caixa_fechamentos_meios (
    empresa_id,
    filial_id,
    caixa_id,
    caixa_fechamento_id,
    chave,
    forma_pagamento_id,
    forma_nome_snapshot,
    forma_tipo_snapshot,
    forma_codigo_snapshot,
    afeta_caixa_fisico_snapshot,
    valor_esperado,
    valor_informado
  )
  SELECT
    v_empresa_id,
    v_caixa.filial_id,
    v_caixa.id,
    v_fechamento_id,
    item->>'chave',
    CASE
      WHEN NULLIF(item->>'forma_pagamento_id', '') IS NULL THEN NULL
      ELSE (item->>'forma_pagamento_id')::uuid
    END,
    COALESCE(NULLIF(btrim(item->>'forma_nome_snapshot'), ''), 'Sem forma'),
    NULLIF(btrim(item->>'forma_tipo_snapshot'), ''),
    NULLIF(btrim(item->>'forma_codigo_snapshot'), ''),
    COALESCE((item->>'afeta_caixa_fisico_snapshot')::boolean, false),
    round((item->>'valor_esperado')::numeric, 2),
    round((item->>'valor_informado')::numeric, 2)
  FROM jsonb_array_elements(v_snapshot) AS item;

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
    'fechamento_id', v_fechamento_id,
    'versao', v_ciclo,
    'fechado_em', v_fechado_em,
    'dinheiro_contado', v_contado,
    'dinheiro_fisico_esperado', v_fisico,
    'diferenca', v_diferenca,
    'meios', v_snapshot
  );
END;
$function$;

-- ------------------------------------------------------------
-- Reabrir somente o último caixa fechado da empresa/filial
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_reabrir_caixa(
  p_caixa_id uuid,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_motivo text := NULLIF(btrim(p_motivo), '');
  v_caixa public.caixas%ROWTYPE;
  v_fechamento public.caixa_fechamentos%ROWTYPE;
  v_reabertura_id uuid;
  v_reaberto_em timestamptz := now();
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Caixa é obrigatório.';
  END IF;

  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reabertura.';
  END IF;

  IF char_length(v_motivo) < 8 THEN
    RAISE EXCEPTION 'Informe o motivo da reabertura com pelo menos 8 caracteres.';
  END IF;

  IF char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'O motivo da reabertura deve ter no máximo 500 caracteres.';
  END IF;

  -- Mesmo lock de abrir: serializa reabrir x abrir x reabrir concorrente.
  PERFORM pg_advisory_xact_lock(hashtext('caixa-abrir:' || v_empresa_id::text));

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.id = p_caixa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.';
  END IF;

  IF v_caixa.status IS DISTINCT FROM 'fechado' THEN
    RAISE EXCEPTION 'Só é possível reabrir um caixa fechado.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.caixas AS c
    WHERE c.empresa_id = v_empresa_id
      AND c.status = 'aberto'
      AND c.filial_id IS NOT DISTINCT FROM v_caixa.filial_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Já existe um caixa aberto para esta empresa.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.caixas AS o
    WHERE o.empresa_id = v_empresa_id
      AND o.id IS DISTINCT FROM v_caixa.id
      AND o.filial_id IS NOT DISTINCT FROM v_caixa.filial_id
      AND (
        o.aberto_em > v_caixa.aberto_em
        OR (o.aberto_em = v_caixa.aberto_em AND o.numero > v_caixa.numero)
      )
  ) THEN
    RAISE EXCEPTION 'Só é possível reabrir o último caixa fechado desta empresa.';
  END IF;

  SELECT f.*
  INTO v_fechamento
  FROM public.caixa_fechamentos AS f
  WHERE f.empresa_id = v_empresa_id
    AND f.caixa_id = v_caixa.id
  ORDER BY f.versao DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.caixa_fechamentos (
      empresa_id,
      filial_id,
      caixa_id,
      versao,
      fechado_em,
      fechado_por,
      dinheiro_contado,
      dinheiro_fisico_esperado,
      diferenca,
      observacao,
      versao_livro,
      fechamento_cego
    )
    VALUES (
      v_empresa_id,
      v_caixa.filial_id,
      v_caixa.id,
      1,
      COALESCE(v_caixa.fechado_em, v_reaberto_em),
      COALESCE(v_caixa.usuario_fechamento_id, v_usuario_id),
      COALESCE(v_caixa.dinheiro_contado, 0),
      ROUND(COALESCE(v_caixa.dinheiro_contado, 0) - COALESCE(v_caixa.diferenca, 0), 2),
      COALESCE(v_caixa.diferenca, 0),
      v_caixa.observacao_fechamento,
      'reabertura-legado',
      false
    )
    RETURNING * INTO v_fechamento;
  END IF;

  INSERT INTO public.caixa_reaberturas (
    empresa_id,
    filial_id,
    caixa_id,
    fechamento_id,
    reaberto_em,
    reaberto_por,
    motivo
  )
  VALUES (
    v_empresa_id,
    v_caixa.filial_id,
    v_caixa.id,
    v_fechamento.id,
    v_reaberto_em,
    v_usuario_id,
    v_motivo
  )
  RETURNING id INTO v_reabertura_id;

  UPDATE public.caixas
  SET
    status = 'aberto',
    usuario_fechamento_id = NULL,
    fechado_em = NULL,
    dinheiro_contado = NULL,
    diferenca = NULL,
    observacao_fechamento = NULL,
    reaberto = true,
    updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id
    AND status = 'fechado';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível reabrir o caixa.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'caixa_id', v_caixa.id,
    'reabertura_id', v_reabertura_id,
    'fechamento_id', v_fechamento.id,
    'reaberto_em', v_reaberto_em,
    'motivo', v_motivo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_reabrir_caixa(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_reabrir_caixa(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reabrir_caixa(uuid, text) TO service_role;

COMMENT ON FUNCTION public.rpc_confirmar_fechamento_caixa(uuid, text, jsonb, text) IS
  'Fecha o caixa de forma atômica criando um novo ciclo em caixa_fechamentos. Não apaga ciclos anteriores.';
COMMENT ON FUNCTION public.rpc_reabrir_caixa(uuid, text) IS
  'Reabre o último caixa fechado da empresa/filial. Preserva fechamentos anteriores e exige motivo. Status volta a aberto.';

COMMIT;
