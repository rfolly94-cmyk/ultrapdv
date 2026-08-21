BEGIN;

-- ============================================================
-- UltraPDV — Carteira: cancelar SOMENTE itens selecionados
-- Data: 2026-08-21
--
-- NÃO altera migrations antigas.
-- NÃO atualiza fiscal_emissoes / Geranet / numeração.
-- Reutiliza estoque_atual + estoque_movimentacoes (mesmo
-- contrato de CANCELAMENTO_VENDA da rotina oficial).
-- ============================================================

ALTER TABLE public.estoque_movimentacoes
  ADD COLUMN IF NOT EXISTS venda_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'estoque_movimentacoes_venda_item_fkey'
  ) THEN
    ALTER TABLE public.estoque_movimentacoes
      ADD CONSTRAINT estoque_movimentacoes_venda_item_fkey
      FOREIGN KEY (venda_item_id)
      REFERENCES public.vendas_itens(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_mov_cancelamento_venda_item
  ON public.estoque_movimentacoes (empresa_id, venda_item_id)
  WHERE venda_item_id IS NOT NULL
    AND tipo = 'CANCELAMENTO_VENDA';

CREATE OR REPLACE FUNCTION public.estoque_estornar_itens_venda_interno(
  p_empresa_id uuid,
  p_venda_id uuid,
  p_usuario_id uuid,
  p_venda_item_ids uuid[],
  p_observacao text
)
RETURNS TABLE (
  produtos_afetados integer,
  quantidade_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
  v_estoque record;
  v_saldo_anterior numeric;
  v_saldo_posterior numeric;
  v_produtos integer := 0;
  v_quantidade numeric := 0;
BEGIN
  IF p_empresa_id IS NULL OR p_venda_id IS NULL THEN
    RAISE EXCEPTION
      'Empresa e venda são obrigatórios para estorno de estoque.';
  END IF;

  IF p_venda_item_ids IS NULL OR cardinality(p_venda_item_ids) = 0 THEN
    RAISE EXCEPTION 'Informe os itens da venda para estorno de estoque.';
  END IF;

  FOR v_item IN
    SELECT
      vi.id,
      vi.produto_id,
      vi.quantidade,
      vi.produto_nome
    FROM public.vendas_itens AS vi
    WHERE vi.empresa_id = p_empresa_id
      AND vi.venda_id = p_venda_id
      AND vi.id = ANY (p_venda_item_ids)
    ORDER BY vi.id
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.estoque_movimentacoes AS em
      WHERE em.empresa_id = p_empresa_id
        AND em.venda_id = p_venda_id
        AND em.venda_item_id = v_item.id
        AND em.tipo = 'CANCELAMENTO_VENDA'
    ) THEN
      RAISE EXCEPTION
        'Já existe estorno de estoque para o item %.',
        coalesce(v_item.produto_nome, v_item.id::text);
    END IF;

    IF coalesce(v_item.quantidade, 0) <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida na composição da venda.';
    END IF;

    SELECT ea.*
    INTO v_estoque
    FROM public.estoque_atual AS ea
    WHERE ea.empresa_id = p_empresa_id
      AND ea.produto_id = v_item.produto_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Estoque atual não encontrado para o produto %.',
        coalesce(v_item.produto_nome, v_item.produto_id::text);
    END IF;

    v_saldo_anterior := coalesce(v_estoque.quantidade, 0);
    v_saldo_posterior := v_saldo_anterior + v_item.quantidade;

    UPDATE public.estoque_atual
    SET
      quantidade = v_saldo_posterior,
      updated_at = now()
    WHERE id = v_estoque.id;

    INSERT INTO public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      venda_id,
      venda_item_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao
    )
    VALUES (
      p_empresa_id,
      v_item.produto_id,
      p_venda_id,
      v_item.id,
      p_usuario_id,
      'CANCELAMENTO_VENDA',
      'CANCELAMENTO_VENDA',
      v_item.quantidade,
      v_saldo_anterior,
      v_saldo_posterior,
      p_observacao
    );

    v_produtos := v_produtos + 1;
    v_quantidade := v_quantidade + v_item.quantidade;
  END LOOP;

  IF v_produtos = 0 THEN
    RAISE EXCEPTION
      'Nenhum item da venda foi encontrado para estorno de estoque.';
  END IF;

  produtos_afetados := v_produtos;
  quantidade_total := v_quantidade;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.estoque_estornar_itens_venda_interno(uuid, uuid, uuid, uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.estoque_estornar_itens_venda_interno(uuid, uuid, uuid, uuid[], text) FROM anon;
REVOKE ALL ON FUNCTION public.estoque_estornar_itens_venda_interno(uuid, uuid, uuid, uuid[], text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.estoque_estornar_itens_venda_interno(uuid, uuid, uuid, uuid[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_cancelar_itens_carteira(
  p_empresa_id uuid,
  p_usuario_id uuid,
  p_cliente_id uuid,
  p_item_ids uuid[],
  p_motivo text,
  p_destino_recebido text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_motivo text := NULLIF(btrim(p_motivo), '');
  v_destino text :=
    NULLIF(upper(btrim(coalesce(p_destino_recebido, ''))), '');
  v_ids uuid[];
  v_item record;
  v_titulo public.carteira_cliente_titulos%rowtype;
  v_venda public.vendas%rowtype;
  v_alocado numeric(14,2);
  v_pago_item numeric(14,2);
  v_pago_total numeric(14,2) := 0;
  v_aberto_cancelado numeric(14,2) := 0;
  v_original_cancelado numeric(14,2) := 0;
  v_qtd_itens integer := 0;
  v_itens_venda integer := 0;
  v_itens_ja_cancelados integer := 0;
  v_venda_item_ids uuid[] := ARRAY[]::uuid[];
  v_aloc record;
  v_credito_id uuid;
  v_credito_gerado numeric(14,2) := 0;
  v_devolucao_registrada numeric(14,2) := 0;
  v_restante_aberto numeric(14,2) := 0;
  v_restante_original numeric(14,2) := 0;
  v_restante_ativos integer := 0;
  v_novo_status text;
  v_saldo_anterior numeric(14,2) := 0;
  v_saldo_atual numeric(14,2) := 0;
  v_credito_atual numeric(14,2) := 0;
  v_qtd_estoque numeric := 0;
  v_produtos_estoque integer := 0;
  v_venda_final_cancelada boolean := false;
BEGIN
  -- Cancelamento comercial de itens. NAO altera fiscal_emissoes / Geranet.

  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() IS DISTINCT FROM p_usuario_id THEN
      RAISE EXCEPTION 'Não autorizado.';
    END IF;
    IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
      RAISE EXCEPTION 'Usuário não possui acesso à empresa informada.';
    END IF;
  END IF;

  IF p_empresa_id IS NULL
     OR p_usuario_id IS NULL
     OR p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Empresa, usuário e cliente são obrigatórios.';
  END IF;

  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION
      'Informe o motivo do cancelamento com pelo menos 5 caracteres.';
  END IF;

  IF v_destino IS NOT NULL
     AND v_destino NOT IN ('DEVOLUCAO', 'CREDITO') THEN
    RAISE EXCEPTION 'Destino do valor recebido inválido.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios AS u
    WHERE u.id = p_usuario_id
      AND u.ativo = true
  ) THEN
    RAISE EXCEPTION 'Usuário interno não encontrado ou inativo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = p_usuario_id
      AND ue.empresa_id = p_empresa_id
      AND ue.ativo = true
  ) THEN
    RAISE EXCEPTION 'Usuário não possui vínculo ativo com a empresa.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clientes AS c
    WHERE c.empresa_id = p_empresa_id
      AND c.id = p_cliente_id
  ) THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT x
    FROM unnest(coalesce(p_item_ids, ARRAY[]::uuid[])) AS x
    WHERE x IS NOT NULL
  )
  INTO v_ids;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um item.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_ids) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.carteira_cliente_itens AS ci
      WHERE ci.empresa_id = p_empresa_id
        AND ci.cliente_id = p_cliente_id
        AND ci.id = x
    )
  ) THEN
    RAISE EXCEPTION 'Item não encontrado na carteira desta empresa/cliente.';
  END IF;

  IF (
    SELECT count(DISTINCT ci.titulo_id)
    FROM public.carteira_cliente_itens AS ci
    WHERE ci.empresa_id = p_empresa_id
      AND ci.id = ANY (v_ids)
  ) <> 1 THEN
    RAISE EXCEPTION 'Selecione itens de uma única venda para cancelar.';
  END IF;

  SELECT t.*
  INTO v_titulo
  FROM public.carteira_cliente_titulos AS t
  JOIN public.carteira_cliente_itens AS ci
    ON ci.empresa_id = t.empresa_id
   AND ci.titulo_id = t.id
  WHERE t.empresa_id = p_empresa_id
    AND ci.id = v_ids[1]
  FOR UPDATE OF t;

  IF v_titulo.cliente_id IS DISTINCT FROM p_cliente_id THEN
    RAISE EXCEPTION 'Título não pertence ao cliente informado.';
  END IF;

  IF v_titulo.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Esta venda já está cancelada na carteira.';
  END IF;

  SELECT v.*
  INTO v_venda
  FROM public.vendas AS v
  WHERE v.empresa_id = p_empresa_id
    AND v.id = v_titulo.venda_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.';
  END IF;

  IF v_venda.status = 'cancelada' THEN
    RAISE EXCEPTION 'A venda já estava cancelada.';
  END IF;

  IF v_venda.cliente_id IS DISTINCT FROM p_cliente_id THEN
    RAISE EXCEPTION 'A venda não pertence ao cliente informado.';
  END IF;

  SELECT count(*)
  INTO v_itens_venda
  FROM public.carteira_cliente_itens AS ci
  WHERE ci.empresa_id = p_empresa_id
    AND ci.titulo_id = v_titulo.id;

  SELECT count(*)
  INTO v_itens_ja_cancelados
  FROM public.carteira_cliente_itens AS ci
  WHERE ci.empresa_id = p_empresa_id
    AND ci.titulo_id = v_titulo.id
    AND ci.status = 'CANCELADO';

  -- Todos os itens da venda, nenhum cancelado antes: rotina oficial completa.
  IF v_itens_ja_cancelados = 0
     AND cardinality(v_ids) = v_itens_venda THEN
    RETURN public.rpc_cancelar_venda_comercial(
      p_empresa_id,
      p_usuario_id,
      v_venda.id,
      v_motivo,
      v_destino
    ) || jsonb_build_object(
      'cancelamento_completo', true,
      'itens_cancelados', cardinality(v_ids)
    );
  END IF;

  FOR v_item IN
    SELECT ci.*
    FROM public.carteira_cliente_itens AS ci
    WHERE ci.empresa_id = p_empresa_id
      AND ci.id = ANY (v_ids)
    ORDER BY ci.id
    FOR UPDATE
  LOOP
    IF v_item.status = 'CANCELADO' THEN
      RAISE EXCEPTION
        'O item % já está cancelado.',
        v_item.produto_nome;
    END IF;

    IF v_item.venda_item_id IS NULL THEN
      RAISE EXCEPTION
        'O item % não possui vínculo seguro com o item da venda. Cancelamento bloqueado.',
        v_item.produto_nome;
    END IF;

    SELECT coalesce(SUM(a.valor), 0)::numeric(14,2)
    INTO v_alocado
    FROM public.carteira_cliente_recebimento_alocacoes AS a
    WHERE a.empresa_id = p_empresa_id
      AND a.item_id = v_item.id
      AND NOT EXISTS (
        SELECT 1
        FROM public.carteira_cliente_recebimento_estornos AS e
        WHERE e.empresa_id = p_empresa_id
          AND e.alocacao_id = a.id
      );

    IF abs(
         (v_alocado + coalesce(v_item.valor_aberto, 0))
         - coalesce(v_item.valor_original, 0)
       ) > 0.009 THEN
      RAISE EXCEPTION
        'Não há vínculo seguro entre o recebimento e o item %. O cancelamento foi bloqueado para não inventar um rateio.',
        v_item.produto_nome;
    END IF;

    v_pago_item := v_alocado;
    v_pago_total := v_pago_total + v_pago_item;
    v_aberto_cancelado :=
      v_aberto_cancelado + coalesce(v_item.valor_aberto, 0);
    v_original_cancelado :=
      v_original_cancelado + coalesce(v_item.valor_original, 0);
    v_qtd_itens := v_qtd_itens + 1;

    IF v_item.venda_item_id IS NOT NULL THEN
      v_venda_item_ids := array_append(v_venda_item_ids, v_item.venda_item_id);
    END IF;
  END LOOP;

  IF v_pago_total > 0 AND v_destino IS NULL THEN
    RAISE EXCEPTION
      'Há R$ % já pagos nos itens selecionados. Escolha DEVOLUCAO ou CREDITO.',
      to_char(v_pago_total, 'FM999999990D00');
  END IF;

  IF v_destino = 'CREDITO' AND v_venda.cliente_id IS NULL THEN
    RAISE EXCEPTION
      'Não é possível gerar crédito sem cliente identificado na venda.';
  END IF;

  v_saldo_anterior :=
    public.carteira_recalcular_saldo_cliente_interno(
      p_empresa_id,
      p_cliente_id
    );

  IF cardinality(v_venda_item_ids) > 0 THEN
    SELECT
      produtos_afetados,
      quantidade_total
    INTO
      v_produtos_estoque,
      v_qtd_estoque
    FROM public.estoque_estornar_itens_venda_interno(
      p_empresa_id,
      v_venda.id,
      p_usuario_id,
      v_venda_item_ids,
      format(
        'Estorno de estoque pelo cancelamento de item da venda nº %s.',
        coalesce(v_venda.numero::text, v_venda.id::text)
      )
    );
  END IF;

  IF v_pago_total > 0 AND v_destino = 'CREDITO' THEN
    INSERT INTO public.carteira_cliente_creditos (
      empresa_id,
      cliente_id,
      origem,
      venda_id,
      recebimento_id,
      valor_original,
      valor_disponivel,
      status,
      observacao
    )
    VALUES (
      p_empresa_id,
      p_cliente_id,
      'CANCELAMENTO_VENDA',
      v_venda.id,
      NULL,
      v_pago_total,
      v_pago_total,
      'DISPONIVEL',
      concat(
        'Crédito gerado pelo cancelamento de item da venda nº ',
        coalesce(v_venda.numero::text, 'sem número')
      )
    )
    RETURNING id
    INTO v_credito_id;

    v_credito_gerado := v_pago_total;

    INSERT INTO public.carteira_cliente_movimentacoes (
      empresa_id,
      cliente_id,
      usuario_id,
      tipo,
      origem,
      valor,
      venda_id,
      titulo_id,
      descricao
    )
    VALUES (
      p_empresa_id,
      p_cliente_id,
      p_usuario_id,
      'CREDITO',
      'CREDITO_CANCELAMENTO_VENDA',
      v_pago_total,
      v_venda.id,
      v_titulo.id,
      concat(
        'Crédito ao cliente pelo cancelamento de item da venda nº ',
        coalesce(v_venda.numero::text, 'sem número')
      )
    );
  END IF;

  FOR v_aloc IN
    SELECT
      a.id AS alocacao_id,
      a.recebimento_id,
      a.valor,
      a.item_id
    FROM public.carteira_cliente_recebimento_alocacoes AS a
    WHERE a.empresa_id = p_empresa_id
      AND a.item_id = ANY (v_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.carteira_cliente_recebimento_estornos AS e
        WHERE e.empresa_id = p_empresa_id
          AND e.alocacao_id = a.id
      )
    ORDER BY a.id
    FOR UPDATE OF a
  LOOP
    INSERT INTO public.carteira_cliente_recebimento_estornos (
      empresa_id,
      cliente_id,
      recebimento_id,
      alocacao_id,
      venda_id,
      titulo_id,
      usuario_id,
      valor,
      destino,
      status,
      credito_id,
      motivo,
      concluido_at,
      venda_pagamento_id,
      origem
    )
    VALUES (
      p_empresa_id,
      p_cliente_id,
      v_aloc.recebimento_id,
      v_aloc.alocacao_id,
      v_venda.id,
      v_titulo.id,
      p_usuario_id,
      v_aloc.valor,
      coalesce(v_destino, 'CREDITO'),
      CASE
        WHEN v_destino = 'DEVOLUCAO' THEN 'PENDENTE'
        ELSE 'CONVERTIDO_CREDITO'
      END,
      v_credito_id,
      v_motivo,
      CASE
        WHEN v_destino = 'DEVOLUCAO' THEN NULL
        ELSE now()
      END,
      NULL,
      'RECEBIMENTO_FIADO'
    )
    ON CONFLICT (empresa_id, alocacao_id)
    DO NOTHING;
  END LOOP;

  IF v_pago_total > 0 AND v_destino = 'DEVOLUCAO' THEN
    v_devolucao_registrada := v_pago_total;

    INSERT INTO public.carteira_cliente_movimentacoes (
      empresa_id,
      cliente_id,
      usuario_id,
      tipo,
      origem,
      valor,
      venda_id,
      titulo_id,
      descricao
    )
    VALUES (
      p_empresa_id,
      p_cliente_id,
      p_usuario_id,
      'ESTORNO',
      'DEVOLUCAO_CANCELAMENTO_VENDA',
      v_pago_total,
      v_venda.id,
      v_titulo.id,
      concat(
        'Devolução pendente pelo cancelamento de item da venda nº ',
        coalesce(v_venda.numero::text, 'sem número')
      )
    );
  END IF;

  UPDATE public.carteira_cliente_itens AS ci
  SET
    valor_aberto = 0,
    status = 'CANCELADO',
    updated_at = now()
  WHERE ci.empresa_id = p_empresa_id
    AND ci.id = ANY (v_ids);

  IF v_aberto_cancelado > 0 THEN
    INSERT INTO public.carteira_cliente_movimentacoes (
      empresa_id,
      cliente_id,
      usuario_id,
      tipo,
      origem,
      valor,
      venda_id,
      titulo_id,
      descricao
    )
    VALUES (
      p_empresa_id,
      p_cliente_id,
      p_usuario_id,
      'ESTORNO',
      'CANCELAMENTO_ITEM',
      v_aberto_cancelado,
      v_venda.id,
      v_titulo.id,
      concat(
        'Cancelamento de item da venda nº ',
        coalesce(v_venda.numero::text, 'sem número'),
        '. Motivo: ',
        v_motivo
      )
    );
  END IF;

  SELECT
    coalesce(SUM(ci.valor_aberto), 0)::numeric(14,2),
    coalesce(SUM(ci.valor_original), 0)::numeric(14,2),
    count(*)::integer
  INTO
    v_restante_aberto,
    v_restante_original,
    v_restante_ativos
  FROM public.carteira_cliente_itens AS ci
  WHERE ci.empresa_id = p_empresa_id
    AND ci.titulo_id = v_titulo.id
    AND ci.status <> 'CANCELADO';

  IF v_restante_ativos = 0 THEN
    v_novo_status := 'CANCELADO';
  ELSIF v_restante_aberto <= 0 THEN
    v_novo_status := 'QUITADO';
  ELSIF v_restante_aberto < v_restante_original THEN
    v_novo_status := 'PARCIAL';
  ELSE
    v_novo_status := 'ABERTO';
  END IF;

  UPDATE public.carteira_cliente_titulos AS t
  SET
    valor_aberto = v_restante_aberto,
    status = v_novo_status,
    updated_at = now()
  WHERE t.empresa_id = p_empresa_id
    AND t.id = v_titulo.id;

  IF v_restante_ativos = 0 THEN
    UPDATE public.vendas_pagamentos AS vp
    SET
      status = 'cancelado',
      updated_at = now()
    FROM public.formas_pagamento AS fp
    WHERE vp.empresa_id = p_empresa_id
      AND vp.venda_id = v_venda.id
      AND vp.status = 'confirmado'
      AND fp.empresa_id = vp.empresa_id
      AND fp.id = vp.forma_pagamento_id
      AND fp.permite_fiado = true;

    UPDATE public.vendas AS v
    SET
      status = 'cancelada',
      cancelada_at = now(),
      cancelada_por = p_usuario_id,
      motivo_cancelamento = v_motivo,
      updated_at = now()
    WHERE v.empresa_id = p_empresa_id
      AND v.id = v_venda.id;

    v_venda_final_cancelada := true;
  END IF;

  v_saldo_atual :=
    public.carteira_recalcular_saldo_cliente_interno(
      p_empresa_id,
      p_cliente_id
    );

  v_credito_atual :=
    public.carteira_credito_disponivel_cliente_interno(
      p_empresa_id,
      p_cliente_id
    );

  RETURN jsonb_build_object(
    'ok', true,
    'cancelamento_completo', false,
    'venda_id', v_venda.id,
    'numero', v_venda.numero,
    'status_venda',
      CASE
        WHEN v_venda_final_cancelada THEN 'cancelada'
        ELSE v_venda.status
      END,
    'itens_cancelados', v_qtd_itens,
    'valor_itens_cancelados', v_original_cancelado,
    'fiado_saldo_aberto_cancelado', v_aberto_cancelado,
    'valor_pago_cliente_tratado', v_pago_total,
    'valor_permanecera_aberto', v_restante_aberto,
    'estoque_quantidade_estornada', coalesce(v_qtd_estoque, 0),
    'estoque_movimentos_estornados', coalesce(v_produtos_estoque, 0),
    'destino_valor_recebido', v_destino,
    'credito_gerado', v_credito_gerado,
    'credito_cliente_disponivel', v_credito_atual,
    'devolucao_registrada', v_devolucao_registrada,
    'devolucao_status',
      CASE
        WHEN v_devolucao_registrada > 0 THEN 'PENDENTE'
        ELSE NULL
      END,
    'saldo_cliente_anterior', v_saldo_anterior,
    'saldo_cliente_atual', v_saldo_atual,
    'motivo', v_motivo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_cancelar_itens_carteira(uuid, uuid, uuid, uuid[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancelar_itens_carteira(uuid, uuid, uuid, uuid[], text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_cancelar_itens_carteira(uuid, uuid, uuid, uuid[], text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancelar_itens_carteira(uuid, uuid, uuid, uuid[], text, text) TO service_role;

COMMIT;
