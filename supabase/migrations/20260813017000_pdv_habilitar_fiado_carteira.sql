BEGIN;

-- ============================================================
-- UltraPDV — Habilitar Fiado no PDV + Carteira atômica
-- Data: 2026-08-13
--
-- Substitui o wrapper que bloqueava Fiado.
--
-- Fluxo:
--   1) sanitiza itens e remove valor_unitario vindo do frontend
--   2) finaliza a venda comercial pela função original (_v1)
--   3) se houver forma permite_fiado=true:
--        cria título + itens + débito na Carteira
--        valida cliente, bloqueio e limite de crédito
--
-- Tudo ocorre na MESMA transação PostgreSQL.
-- Se a Carteira falhar, a venda também é desfeita.
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalizar_venda_comercial_interno(
  p_empresa_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_tipo_venda text DEFAULT 'balcao',
  p_modelo_fiscal_intencao text DEFAULT NULL,
  p_desconto numeric DEFAULT 0,
  p_acrescimo numeric DEFAULT 0,
  p_frete numeric DEFAULT 0,
  p_troco numeric DEFAULT 0,
  p_observacao text DEFAULT NULL,
  p_itens jsonb DEFAULT '[]'::jsonb,
  p_pagamentos jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  venda_id uuid,
  numero bigint,
  valor_produtos numeric,
  desconto numeric,
  acrescimo numeric,
  frete numeric,
  valor_total numeric,
  troco numeric,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_itens_sanitizados jsonb := '[]'::jsonb;

  v_pagamento jsonb;
  v_forma_id uuid;
  v_tem_fiado boolean := false;

  v_venda record;
BEGIN
  -- ----------------------------------------------------------
  -- Itens: preço comercial vem do banco.
  -- ----------------------------------------------------------

  IF COALESCE(
    jsonb_typeof(p_itens),
    ''
  ) <> 'array' THEN
    RAISE EXCEPTION
      'Itens da venda devem ser um array.';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_itens)
  LOOP
    v_itens_sanitizados :=
      v_itens_sanitizados
      || jsonb_build_array(
        v_item - 'valor_unitario'
      );
  END LOOP;

  -- ----------------------------------------------------------
  -- Detecta Fiado.
  -- A função original continuará validando todas as formas.
  -- ----------------------------------------------------------

  IF COALESCE(
    jsonb_typeof(p_pagamentos),
    ''
  ) <> 'array' THEN
    RAISE EXCEPTION
      'Pagamentos da venda devem ser um array.';
  END IF;

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(p_pagamentos)
  LOOP
    BEGIN
      v_forma_id :=
        NULLIF(
          btrim(
            v_pagamento ->> 'forma_pagamento_id'
          ),
          ''
        )::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'forma_pagamento_id inválido.';
    END;

    IF v_forma_id IS NULL THEN
      RAISE EXCEPTION
        'forma_pagamento_id é obrigatório.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.formas_pagamento AS fp
      WHERE fp.empresa_id = p_empresa_id
        AND fp.id = v_forma_id
        AND fp.ativo = true
        AND fp.permite_fiado = true
    ) THEN
      v_tem_fiado := true;
    END IF;
  END LOOP;

  IF v_tem_fiado
     AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION
      'Pagamento fiado exige cliente.';
  END IF;

  -- ----------------------------------------------------------
  -- Finalização comercial original.
  -- Qualquer erro posterior ainda fará rollback desta venda.
  -- ----------------------------------------------------------

  SELECT *
  INTO v_venda
  FROM public.finalizar_venda_comercial_interno_v1(
    p_empresa_id,
    p_cliente_id,
    p_tipo_venda,
    p_modelo_fiscal_intencao,
    p_desconto,
    p_acrescimo,
    p_frete,
    p_troco,
    p_observacao,
    v_itens_sanitizados,
    p_pagamentos
  );

  IF v_venda.venda_id IS NULL THEN
    RAISE EXCEPTION
      'A finalização comercial não retornou a venda.';
  END IF;

  -- ----------------------------------------------------------
  -- Carteira:
  -- valida limite/bloqueio e cria somente o valor efetivamente
  -- pago na forma marcada como Fiado.
  -- ----------------------------------------------------------

  IF v_tem_fiado THEN
    PERFORM
      public.carteira_criar_debito_venda_interno(
        p_empresa_id,
        v_venda.venda_id
      );
  END IF;

  RETURN QUERY
  SELECT
    v_venda.venda_id::uuid,
    v_venda.numero::bigint,
    v_venda.valor_produtos::numeric,
    v_venda.desconto::numeric,
    v_venda.acrescimo::numeric,
    v_venda.frete::numeric,
    v_venda.valor_total::numeric,
    v_venda.troco::numeric,
    v_venda.status::text;
END;
$$;

REVOKE ALL
ON FUNCTION public.finalizar_venda_comercial_interno(
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  jsonb,
  jsonb
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.finalizar_venda_comercial_interno(
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  jsonb,
  jsonb
)
FROM authenticated;

COMMIT;
