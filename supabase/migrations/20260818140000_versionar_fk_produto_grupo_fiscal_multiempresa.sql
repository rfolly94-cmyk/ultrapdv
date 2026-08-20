BEGIN;

-- ============================================================
-- UltraPDV — Versionar FK produto × grupo fiscal (multiempresa)
-- Data: 2026-08-18
--
-- Banco vivo já possui:
--   grupos_fiscais_id_empresa_unique
--     UNIQUE (id, empresa_id)
--   produtos_grupo_fiscal_empresa_fkey
--     FOREIGN KEY (grupo_fiscal_id, empresa_id)
--     REFERENCES grupos_fiscais (id, empresa_id)
--
-- Esta migration elimina drift do Git. Idempotente.
-- Não DROP + ADD. Não UNIQUE(nome) global. Não NOT NULL no grupo.
-- MATCH SIMPLE (padrão): grupo_fiscal_id NULL continua válido.
-- ============================================================

-- ------------------------------------------------------------
-- 1) UNIQUE referenciada: grupos_fiscais (id, empresa_id)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
  v_cols text[];
BEGIN
  SELECT
    c.contype::text,
    (
      SELECT array_agg(a.attname ORDER BY k.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute AS a
        ON a.attrelid = c.conrelid
       AND a.attnum = k.attnum
    )
  INTO v_tipo, v_cols
  FROM pg_constraint AS c
  WHERE c.conrelid = 'public.grupos_fiscais'::regclass
    AND c.conname = 'grupos_fiscais_id_empresa_unique';

  IF FOUND THEN
    IF v_tipo IS DISTINCT FROM 'u'
       OR v_cols IS DISTINCT FROM ARRAY['id', 'empresa_id']::text[] THEN
      RAISE EXCEPTION
        'grupos_fiscais_id_empresa_unique existe com definição divergente (tipo=%, colunas=%). Esperado UNIQUE (id, empresa_id).',
        v_tipo,
        v_cols;
    END IF;
  ELSE
    ALTER TABLE public.grupos_fiscais
      ADD CONSTRAINT grupos_fiscais_id_empresa_unique
      UNIQUE (id, empresa_id);
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 2) Dados cruzados: só impede criar a FK; não corrige registro.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_cruzados integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.produtos'::regclass
      AND c.conname = 'produtos_grupo_fiscal_empresa_fkey'
  ) THEN
    NULL;
  ELSE
    SELECT count(*)::integer
    INTO v_cruzados
    FROM public.produtos AS p
    JOIN public.grupos_fiscais AS gf
      ON gf.id = p.grupo_fiscal_id
    WHERE p.grupo_fiscal_id IS NOT NULL
      AND p.empresa_id IS DISTINCT FROM gf.empresa_id;

    IF coalesce(v_cruzados, 0) > 0 THEN
      RAISE EXCEPTION
        'Não é possível criar produtos_grupo_fiscal_empresa_fkey: existem % produto(s) com grupo fiscal de outra empresa. Corrija os dados antes.',
        v_cruzados;
    END IF;
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 3) FK composta em produtos
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
  v_cols text[];
  v_ref oid;
  v_refcols text[];
BEGIN
  SELECT
    c.contype::text,
    (
      SELECT array_agg(a.attname ORDER BY k.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute AS a
        ON a.attrelid = c.conrelid
       AND a.attnum = k.attnum
    ),
    c.confrelid,
    (
      SELECT array_agg(a.attname ORDER BY k.ord)
      FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute AS a
        ON a.attrelid = c.confrelid
       AND a.attnum = k.attnum
    )
  INTO v_tipo, v_cols, v_ref, v_refcols
  FROM pg_constraint AS c
  WHERE c.conrelid = 'public.produtos'::regclass
    AND c.conname = 'produtos_grupo_fiscal_empresa_fkey';

  IF FOUND THEN
    IF v_tipo IS DISTINCT FROM 'f'
       OR v_cols IS DISTINCT FROM ARRAY['grupo_fiscal_id', 'empresa_id']::text[]
       OR v_ref IS DISTINCT FROM 'public.grupos_fiscais'::regclass
       OR v_refcols IS DISTINCT FROM ARRAY['id', 'empresa_id']::text[] THEN
      RAISE EXCEPTION
        'produtos_grupo_fiscal_empresa_fkey existe com definição divergente (tipo=%, colunas=%, ref=%, refcols=%). Esperado FOREIGN KEY (grupo_fiscal_id, empresa_id) REFERENCES grupos_fiscais (id, empresa_id).',
        v_tipo,
        v_cols,
        v_ref::regclass,
        v_refcols;
    END IF;
  ELSE
    ALTER TABLE public.produtos
      ADD CONSTRAINT produtos_grupo_fiscal_empresa_fkey
      FOREIGN KEY (grupo_fiscal_id, empresa_id)
      REFERENCES public.grupos_fiscais (id, empresa_id);
  END IF;
END
$$;

COMMIT;
