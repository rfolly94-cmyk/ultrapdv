BEGIN;

-- UltraPDV — Fase 2A (incremental): snapshot de permite_troco e
-- representação auditável do troco na própria linha da venda.
-- Não altera a migration da Fase 1 nem rpc_finalizar_venda.

ALTER TABLE public.caixa_movimentacoes
  ADD COLUMN IF NOT EXISTS permite_troco boolean;

COMMENT ON COLUMN public.caixa_movimentacoes.permite_troco IS
  'Snapshot de formas_pagamento.permite_troco no lançamento. Histórico não relê o cadastro. Não significa gaveta.';

ALTER TABLE public.caixa_movimentacoes
  DROP CONSTRAINT IF EXISTS caixa_movimentacoes_valores_check;

ALTER TABLE public.caixa_movimentacoes
  ADD CONSTRAINT caixa_movimentacoes_valores_check CHECK (
    entrada >= 0
    AND saida >= 0
    AND (
      tipo = 'venda'
      OR NOT (entrada > 0 AND saida > 0)
    )
    AND (
      tipo = 'abertura'
      OR entrada > 0
      OR saida > 0
    )
  );

COMMENT ON CONSTRAINT caixa_movimentacoes_valores_check ON public.caixa_movimentacoes IS
  'Venda pode ter entrada (valor recebido) e saida (troco) na mesma linha. Troco nunca é sangria.';

-- Gaveta nesta migration ainda usa permite_troco (corrigido em 20260825130000).
CREATE OR REPLACE FUNCTION public.caixa_saldo_dinheiro(
  p_empresa_id uuid,
  p_caixa_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(m.entrada) - SUM(m.saida), 0)::numeric(14, 2)
  FROM public.caixa_movimentacoes AS m
  WHERE m.empresa_id = p_empresa_id
    AND m.caixa_id = p_caixa_id
    AND (
      m.tipo IN ('abertura', 'suprimento', 'sangria')
      OR COALESCE(m.permite_troco, false)
    );
$function$;

CREATE OR REPLACE FUNCTION public.rpc_finalizar_venda_com_caixa(
  p_empresa_id uuid,
  p_idempotency_key uuid,
  p_cliente_id uuid,
  p_tipo_venda text,
  p_modelo_fiscal_intencao text,
  p_desconto numeric,
  p_acrescimo numeric,
  p_frete numeric,
  p_troco numeric,
  p_observacao text,
  p_itens jsonb,
  p_pagamentos jsonb
)
RETURNS TABLE (
  venda_id uuid,
  numero bigint,
  valor_total numeric
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
  v_venda_id uuid;
  v_numero bigint;
  v_valor_total numeric;
  v_troco_restante numeric(14, 2);
  v_pag record;
  v_entrada numeric(14, 2);
  v_troco_linha numeric(14, 2);
  v_descricao text;
  v_cliente_nome text;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'Empresa da sessão não confere.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('caixa-venda:' || v_empresa_id::text));

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
  FROM public.rpc_finalizar_venda(
    p_empresa_id => p_empresa_id,
    p_idempotency_key => p_idempotency_key,
    p_cliente_id => p_cliente_id,
    p_tipo_venda => p_tipo_venda,
    p_modelo_fiscal_intencao => p_modelo_fiscal_intencao,
    p_desconto => p_desconto,
    p_acrescimo => p_acrescimo,
    p_frete => p_frete,
    p_troco => p_troco,
    p_observacao => p_observacao,
    p_itens => p_itens,
    p_pagamentos => p_pagamentos
  ) AS f
  LIMIT 1;

  IF v_fin.venda_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível finalizar a venda.';
  END IF;

  v_venda_id := v_fin.venda_id;
  v_numero := v_fin.numero;
  v_valor_total := v_fin.valor_total;
  v_descricao := 'Venda #' || COALESCE(v_numero::text, '');

  SELECT COALESCE(v.troco, 0)
  INTO v_troco_restante
  FROM public.vendas AS v
  WHERE v.empresa_id = v_empresa_id
    AND v.id = v_venda_id;

  v_troco_restante := COALESCE(v_troco_restante, 0);

  SELECT NULLIF(btrim(c.nome), '')
  INTO v_cliente_nome
  FROM public.vendas AS v
  LEFT JOIN public.clientes AS c
    ON c.empresa_id = v.empresa_id
   AND c.id = v.cliente_id
  WHERE v.empresa_id = v_empresa_id
    AND v.id = v_venda_id;

  FOR v_pag IN
    SELECT
      vp.id,
      vp.forma_pagamento_id,
      vp.valor,
      fp.permite_fiado,
      fp.permite_troco,
      fp.tipo,
      fp.codigo,
      fp.nome
    FROM public.vendas_pagamentos AS vp
    JOIN public.formas_pagamento AS fp
      ON fp.empresa_id = vp.empresa_id
     AND fp.id = vp.forma_pagamento_id
    WHERE vp.empresa_id = v_empresa_id
      AND vp.venda_id = v_venda_id
      AND vp.status = 'confirmado'
    ORDER BY
      CASE WHEN COALESCE(fp.permite_troco, false) THEN 0 ELSE 1 END,
      vp.id
  LOOP
    IF COALESCE(v_pag.permite_fiado, false) THEN
      CONTINUE;
    END IF;

    v_entrada := round(COALESCE(v_pag.valor, 0), 2);
    v_troco_linha := 0;

    IF v_entrada <= 0 THEN
      CONTINUE;
    END IF;

    -- Troco só em permite_troco. Permanece na linha da venda (saida),
    -- não vira sangria. entrada = valor entregue pelo cliente.
    IF COALESCE(v_pag.permite_troco, false) AND v_troco_restante > 0 THEN
      IF v_entrada >= v_troco_restante THEN
        v_troco_linha := v_troco_restante;
        v_troco_restante := 0;
      ELSE
        v_troco_linha := v_entrada;
        v_troco_restante := round(v_troco_restante - v_entrada, 2);
      END IF;
    END IF;

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
      permite_troco,
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
      'venda',
      'venda',
      v_pag.id,
      v_pag.forma_pagamento_id,
      v_pag.tipo,
      v_pag.codigo,
      v_pag.nome,
      COALESCE(v_pag.permite_troco, false),
      v_venda_id,
      v_numero,
      v_cliente_nome,
      v_entrada,
      v_troco_linha,
      v_descricao,
      v_usuario_id
    )
    ON CONFLICT (empresa_id, origem_tipo, origem_id)
      WHERE origem_tipo = 'venda' AND origem_id IS NOT NULL
    DO NOTHING;
  END LOOP;

  IF v_troco_restante > 0 THEN
    RAISE EXCEPTION
      'Foi informado troco, mas nenhuma forma selecionada permite troco.';
  END IF;

  UPDATE public.caixas
  SET updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id
    AND status = 'aberto';

  venda_id := v_venda_id;
  numero := v_numero;
  valor_total := v_valor_total;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.rpc_finalizar_venda_com_caixa(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, jsonb
) IS
  'PDV web: venda + livro atômicos. entrada=valor recebido, saida=troco na mesma linha tipo=venda. Snapshot permite_troco. Idempotente por vendas_pagamentos.id.';

NOTIFY pgrst, 'reload schema';

COMMIT;
