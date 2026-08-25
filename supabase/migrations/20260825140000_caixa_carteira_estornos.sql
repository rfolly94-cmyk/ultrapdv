BEGIN;

-- UltraPDV — Fase 2B: Carteira no livro do Caixa.
-- Não altera rpc_receber_carteira_cliente, rpc_estornar_recebimento_carteira,
-- rpc_cancelar_venda_comercial nem a Fase 2A.
-- Cancelamento comercial NÃO lança Caixa: devolução fica PENDENTE e não há
-- prova de refund PIX/cartão.

-- ------------------------------------------------------------
-- Tipos do livro
-- ------------------------------------------------------------

ALTER TABLE public.caixa_movimentacoes
  DROP CONSTRAINT IF EXISTS caixa_movimentacoes_tipo_check;

ALTER TABLE public.caixa_movimentacoes
  ADD CONSTRAINT caixa_movimentacoes_tipo_check CHECK (
    tipo = ANY (
      ARRAY[
        'abertura',
        'suprimento',
        'sangria',
        'ajuste',
        'venda',
        'recebimento_carteira',
        'estorno_recebimento'
      ]::text[]
    )
  );

COMMENT ON COLUMN public.caixa_movimentacoes.tipo IS
  'abertura, suprimento, sangria, ajuste, venda, recebimento_carteira, estorno_recebimento. Troco nunca é sangria. Cancelamento de venda não gera tipo próprio enquanto a devolução financeira não for efetiva.';

ALTER TABLE public.caixa_movimentacoes
  DROP CONSTRAINT IF EXISTS caixa_movimentacoes_valores_check;

ALTER TABLE public.caixa_movimentacoes
  ADD CONSTRAINT caixa_movimentacoes_valores_check CHECK (
    entrada >= 0
    AND saida >= 0
    AND (
      tipo = ANY (ARRAY['venda', 'recebimento_carteira', 'estorno_recebimento']::text[])
      OR NOT (entrada > 0 AND saida > 0)
    )
    AND (
      tipo = 'abertura'
      OR entrada > 0
      OR saida > 0
    )
  );

ALTER TABLE public.caixa_movimentacoes
  DROP CONSTRAINT IF EXISTS caixa_movimentacoes_troco_permite_check;

ALTER TABLE public.caixa_movimentacoes
  ADD CONSTRAINT caixa_movimentacoes_troco_permite_check CHECK (
    tipo NOT IN ('venda', 'recebimento_carteira')
    OR saida = 0
    OR COALESCE(permite_troco_snapshot, false)
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_caixa_movimentacoes_origem_recebimento_carteira
  ON public.caixa_movimentacoes (empresa_id, origem_tipo, origem_id)
  WHERE origem_tipo = 'recebimento_carteira'
    AND origem_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_caixa_movimentacoes_origem_estorno_recebimento
  ON public.caixa_movimentacoes (empresa_id, origem_tipo, origem_id)
  WHERE origem_tipo = 'estorno_recebimento'
    AND origem_id IS NOT NULL;

-- ------------------------------------------------------------
-- Recebimento Carteira + caixa aberto
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_receber_carteira_com_caixa(
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_forma_pagamento_id uuid,
  p_modo text,
  p_valor numeric DEFAULT NULL,
  p_item_ids jsonb DEFAULT '[]'::jsonb,
  p_observacao text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS TABLE (
  recebimento_id uuid,
  valor_recebido numeric,
  saldo_anterior numeric,
  saldo_atual numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_caixa public.caixas%ROWTYPE;
  v_fin record;
  v_recebimento public.carteira_cliente_recebimentos%ROWTYPE;
  v_forma public.formas_pagamento%ROWTYPE;
  v_cliente_nome text;
  v_entrada numeric(14, 2);
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'Empresa da sessão não confere.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('caixa-carteira:' || v_empresa_id::text));

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.status = 'aberto'
    AND c.filial_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O caixa foi fechado. Abra um caixa para continuar.';
  END IF;

  SELECT f.*
  INTO v_fin
  FROM public.rpc_receber_carteira_cliente(
    p_empresa_id => p_empresa_id,
    p_cliente_id => p_cliente_id,
    p_forma_pagamento_id => p_forma_pagamento_id,
    p_modo => p_modo,
    p_valor => p_valor,
    p_item_ids => p_item_ids,
    p_observacao => p_observacao,
    p_idempotency_key => p_idempotency_key
  ) AS f
  LIMIT 1;

  IF v_fin.recebimento_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível registrar o recebimento.';
  END IF;

  SELECT r.*
  INTO v_recebimento
  FROM public.carteira_cliente_recebimentos AS r
  WHERE r.empresa_id = v_empresa_id
    AND r.id = v_fin.recebimento_id;

  v_entrada := round(COALESCE(v_recebimento.valor, v_fin.valor_recebido, 0), 2);

  IF v_entrada > 0 THEN
    SELECT fp.*
    INTO v_forma
    FROM public.formas_pagamento AS fp
    WHERE fp.empresa_id = v_empresa_id
      AND fp.id = v_recebimento.forma_pagamento_id;

    SELECT NULLIF(btrim(c.nome), '')
    INTO v_cliente_nome
    FROM public.clientes AS c
    WHERE c.empresa_id = v_empresa_id
      AND c.id = p_cliente_id;

    INSERT INTO public.caixa_movimentacoes (
      empresa_id,
      filial_id,
      caixa_id,
      tipo,
      origem_tipo,
      origem_id,
      forma_pagamento_id,
      forma_tipo,
      forma_codigo,
      forma_nome,
      permite_troco_snapshot,
      afeta_caixa_fisico_snapshot,
      venda_id,
      venda_numero,
      cliente_nome,
      entrada,
      saida,
      descricao,
      usuario_id
    )
    VALUES (
      v_empresa_id,
      v_caixa.filial_id,
      v_caixa.id,
      'recebimento_carteira',
      'recebimento_carteira',
      v_recebimento.id,
      v_recebimento.forma_pagamento_id,
      v_forma.tipo,
      COALESCE(v_forma.codigo, v_recebimento.forma_pagamento_codigo),
      COALESCE(v_forma.nome, v_recebimento.forma_pagamento_nome),
      COALESCE(v_forma.permite_troco, false),
      COALESCE(v_forma.afeta_caixa_fisico, false),
      NULL,
      NULL,
      v_cliente_nome,
      v_entrada,
      0,
      'Recebimento Carteira',
      v_usuario_id
    )
    ON CONFLICT (empresa_id, origem_tipo, origem_id)
      WHERE origem_tipo = 'recebimento_carteira' AND origem_id IS NOT NULL
    DO NOTHING;

    UPDATE public.carteira_cliente_recebimentos
    SET integrado_caixa = true
    WHERE empresa_id = v_empresa_id
      AND id = v_recebimento.id;
  END IF;

  UPDATE public.caixas
  SET updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id
    AND status = 'aberto';

  recebimento_id := v_fin.recebimento_id;
  valor_recebido := v_fin.valor_recebido;
  saldo_anterior := v_fin.saldo_anterior;
  saldo_atual := v_fin.saldo_atual;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_receber_carteira_com_caixa(
  uuid, uuid, uuid, text, numeric, jsonb, text, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_receber_carteira_com_caixa(
  uuid, uuid, uuid, text, numeric, jsonb, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_receber_carteira_com_caixa(
  uuid, uuid, uuid, text, numeric, jsonb, text, uuid
) TO service_role;

-- ------------------------------------------------------------
-- Estorno de recebimento: movimento compensatório, nunca apaga
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_estornar_recebimento_carteira_com_caixa(
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_recebimento_id uuid,
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
  v_caixa public.caixas%ROWTYPE;
  v_resultado jsonb;
  v_ja_estornado boolean := false;
  v_tem_original boolean := false;
  v_original public.caixa_movimentacoes%ROWTYPE;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'Empresa da sessão não confere.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('caixa-carteira:' || v_empresa_id::text));

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.status = 'aberto'
    AND c.filial_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O caixa foi fechado. Abra um caixa para continuar.';
  END IF;

  BEGIN
    v_resultado := public.rpc_estornar_recebimento_carteira(
      p_empresa_id,
      p_cliente_id,
      p_recebimento_id,
      p_motivo
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%já foi estornado%' THEN
        v_ja_estornado := true;
        v_resultado := jsonb_build_object(
          'ok', true,
          'recebimento_id', p_recebimento_id,
          'reutilizado', true
        );
      ELSE
        RAISE;
      END IF;
  END;

  SELECT m.*
  INTO v_original
  FROM public.caixa_movimentacoes AS m
  WHERE m.empresa_id = v_empresa_id
    AND m.origem_tipo = 'recebimento_carteira'
    AND m.origem_id = p_recebimento_id
  ORDER BY m.created_at
  LIMIT 1;

  v_tem_original := FOUND;

  IF v_tem_original THEN
    INSERT INTO public.caixa_movimentacoes (
      empresa_id,
      filial_id,
      caixa_id,
      tipo,
      origem_tipo,
      origem_id,
      forma_pagamento_id,
      forma_tipo,
      forma_codigo,
      forma_nome,
      permite_troco_snapshot,
      afeta_caixa_fisico_snapshot,
      venda_id,
      venda_numero,
      cliente_nome,
      entrada,
      saida,
      descricao,
      usuario_id,
      estorno_de_id
    )
    VALUES (
      v_empresa_id,
      v_caixa.filial_id,
      v_caixa.id,
      'estorno_recebimento',
      'estorno_recebimento',
      p_recebimento_id,
      v_original.forma_pagamento_id,
      v_original.forma_tipo,
      v_original.forma_codigo,
      v_original.forma_nome,
      v_original.permite_troco_snapshot,
      v_original.afeta_caixa_fisico_snapshot,
      v_original.venda_id,
      v_original.venda_numero,
      v_original.cliente_nome,
      v_original.saida,
      v_original.entrada,
      'Estorno de recebimento Carteira',
      v_usuario_id,
      v_original.id
    )
    ON CONFLICT (empresa_id, origem_tipo, origem_id)
      WHERE origem_tipo = 'estorno_recebimento' AND origem_id IS NOT NULL
    DO NOTHING;
  END IF;

  UPDATE public.caixas
  SET updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id
    AND status = 'aberto';

  IF v_resultado IS NULL THEN
    v_resultado := jsonb_build_object('ok', true, 'recebimento_id', p_recebimento_id);
  END IF;

  RETURN v_resultado || jsonb_build_object(
    'caixa_compensado', v_tem_original
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_estornar_recebimento_carteira_com_caixa(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_estornar_recebimento_carteira_com_caixa(
  uuid, uuid, uuid, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_estornar_recebimento_carteira_com_caixa(
  uuid, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.rpc_receber_carteira_com_caixa(
  uuid, uuid, uuid, text, numeric, jsonb, text, uuid
) IS
  'Carteira web: exige caixa aberto, chama rpc_receber_carteira_cliente e lança o recebimento no livro. Idempotente por carteira_cliente_recebimentos.id.';

COMMENT ON FUNCTION public.rpc_estornar_recebimento_carteira_com_caixa(
  uuid, uuid, uuid, text
) IS
  'Estorno de recebimento: chama a RPC comercial e lança movimento compensatório vinculado (estorno_de_id). Não apaga o original. Copia snapshot. Idempotente por recebimento_id.';

NOTIFY pgrst, 'reload schema';

COMMIT;
