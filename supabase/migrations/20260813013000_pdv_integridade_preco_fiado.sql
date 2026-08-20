BEGIN;

-- ============================================================
-- UltraPDV — Integridade do PDV antes da primeira venda real
-- Data: 2026-08-13
--
-- CORREÇÃO:
-- Esta versão é reexecutável.
-- Se finalizar_venda_comercial_interno_v1 já existir,
-- não tenta renomear novamente.
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure(
    'public.finalizar_venda_comercial_interno_v1(uuid,uuid,text,text,numeric,numeric,numeric,numeric,text,jsonb,jsonb)'
  ) IS NULL THEN

    IF to_regprocedure(
      'public.finalizar_venda_comercial_interno(uuid,uuid,text,text,numeric,numeric,numeric,numeric,text,jsonb,jsonb)'
    ) IS NULL THEN
      RAISE EXCEPTION
        'Função base finalizar_venda_comercial_interno não encontrada.';
    END IF;

    ALTER FUNCTION public.finalizar_venda_comercial_interno(
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
    RENAME TO finalizar_venda_comercial_interno_v1;
  END IF;
END
$$;

REVOKE ALL
ON FUNCTION public.finalizar_venda_comercial_interno_v1(
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
ON FUNCTION public.finalizar_venda_comercial_interno_v1(
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
BEGIN
  -- Remove qualquer valor_unitario vindo do frontend.
  -- A função original usa produtos.preco_venda.
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

  -- Fiado permanece bloqueado até a Carteira do Cliente existir.
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
      FROM public.formas_pagamento fp
      WHERE fp.empresa_id = p_empresa_id
        AND fp.id = v_forma_id
        AND fp.ativo = true
        AND fp.permite_fiado = true
    ) THEN
      RAISE EXCEPTION
        'Fiado estará disponível após a implantação da Carteira do Cliente.';
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT *
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
