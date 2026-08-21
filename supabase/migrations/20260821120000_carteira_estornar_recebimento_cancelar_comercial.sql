BEGIN;

-- ============================================================
-- UltraPDV — Carteira: estorno de recebimento e cancelamento
-- comercial sem mutar documento fiscal.
-- Data: 2026-08-21
--
-- NÃO altera migrations antigas.
-- NÃO atualiza fiscal_emissoes.
-- NÃO chama Geranet.
-- ============================================================

-- ============================================================
-- UltraPDV — Carteira: estorno de recebimento + cancelamento
-- comercial sem alterar documento fiscal
--
-- Reutiliza:
--   carteira_cliente_recebimento_estornos
--   carteira_cliente_recebimento_alocacoes
--   carteira_recalcular_saldo_cliente_interno
--   carteira_credito_disponivel_cliente_interno
--   rpc_cancelar_venda_comercial (estoque/carteira/pagamentos)
--
-- NÃO altera fiscal_emissoes, protocolo, chave, numeração
-- nem chama Geranet.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_estornar_recebimento_carteira(
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
  v_usuario_id uuid;
  v_motivo text := NULLIF(btrim(p_motivo), '');
  v_recebimento public.carteira_cliente_recebimentos%rowtype;
  v_aloc record;
  v_item public.carteira_cliente_itens%rowtype;
  v_titulo public.carteira_cliente_titulos%rowtype;
  v_venda_status text;
  v_estornado numeric(14,2) := 0;
  v_alocacoes integer := 0;
  v_saldo_anterior numeric(14,2) := 0;
  v_saldo_atual numeric(14,2) := 0;
  v_credito_atual numeric(14,2) := 0;
  v_novo_aberto numeric(14,2);
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF p_empresa_id IS NULL
     OR p_cliente_id IS NULL
     OR p_recebimento_id IS NULL THEN
    RAISE EXCEPTION 'Empresa, cliente e recebimento são obrigatórios.';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = v_usuario_id
      AND ue.empresa_id = p_empresa_id
      AND ue.ativo = true
  ) THEN
    RAISE EXCEPTION 'Usuário não possui vínculo ativo com a empresa.';
  END IF;

  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION
      'Informe o motivo do cancelamento do recebimento com pelo menos 5 caracteres.';
  END IF;

  SELECT r.*
  INTO v_recebimento
  FROM public.carteira_cliente_recebimentos AS r
  WHERE r.empresa_id = p_empresa_id
    AND r.cliente_id = p_cliente_id
    AND r.id = p_recebimento_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recebimento não encontrado.';
  END IF;

  IF coalesce(v_recebimento.valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Recebimento sem valor para estornar.';
  END IF;

  v_saldo_anterior :=
    public.carteira_recalcular_saldo_cliente_interno(
      p_empresa_id,
      p_cliente_id
    );

  FOR v_aloc IN
    SELECT
      a.id,
      a.item_id,
      a.valor
    FROM public.carteira_cliente_recebimento_alocacoes AS a
    WHERE a.empresa_id = p_empresa_id
      AND a.recebimento_id = p_recebimento_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.carteira_cliente_recebimento_estornos AS e
        WHERE e.empresa_id = p_empresa_id
          AND e.alocacao_id = a.id
      )
    ORDER BY a.created_at, a.id
    FOR UPDATE OF a
  LOOP
    SELECT ci.*
    INTO v_item
    FROM public.carteira_cliente_itens AS ci
    WHERE ci.empresa_id = p_empresa_id
      AND ci.id = v_aloc.item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item da carteira não encontrado para o recebimento.';
    END IF;

    IF v_item.status = 'CANCELADO' THEN
      RAISE EXCEPTION
        'Não é possível estornar recebimento de item cancelado. Use o cancelamento da venda se ainda estiver pendente.';
    END IF;

    SELECT ct.*
    INTO v_titulo
    FROM public.carteira_cliente_titulos AS ct
    WHERE ct.empresa_id = p_empresa_id
      AND ct.id = v_item.titulo_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Título da carteira não encontrado.';
    END IF;

    IF v_titulo.status = 'CANCELADO' THEN
      RAISE EXCEPTION
        'Não é possível estornar recebimento de venda já cancelada.';
    END IF;

    IF v_titulo.venda_id IS NULL THEN
      RAISE EXCEPTION
        'Recebimento sem venda vinculada não pode ser estornado automaticamente.';
    END IF;

    SELECT v.status
    INTO v_venda_status
    FROM public.vendas AS v
    WHERE v.empresa_id = p_empresa_id
      AND v.id = v_titulo.venda_id;

    IF v_venda_status = 'cancelada' THEN
      RAISE EXCEPTION
        'Não é possível estornar recebimento de venda já cancelada.';
    END IF;

    v_novo_aberto :=
      least(
        v_item.valor_original,
        coalesce(v_item.valor_aberto, 0) + v_aloc.valor
      );

    UPDATE public.carteira_cliente_itens AS ci
    SET
      valor_aberto = v_novo_aberto,
      status =
        CASE
          WHEN v_novo_aberto <= 0 THEN 'QUITADO'
          WHEN v_novo_aberto < ci.valor_original THEN 'PARCIAL'
          ELSE 'ABERTO'
        END
    WHERE ci.empresa_id = p_empresa_id
      AND ci.id = v_item.id;

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
      p_recebimento_id,
      v_aloc.id,
      v_titulo.venda_id,
      v_titulo.id,
      v_usuario_id,
      v_aloc.valor,
      'DEVOLUCAO',
      'CONCLUIDO',
      NULL,
      v_motivo,
      now(),
      NULL,
      'RECEBIMENTO_FIADO'
    );

    v_estornado := v_estornado + v_aloc.valor;
    v_alocacoes := v_alocacoes + 1;
  END LOOP;

  IF v_alocacoes = 0 THEN
    RAISE EXCEPTION 'Este recebimento já foi estornado.';
  END IF;

  UPDATE public.carteira_cliente_titulos AS ct
  SET
    valor_aberto =
      COALESCE(
        (
          SELECT SUM(ci.valor_aberto)
          FROM public.carteira_cliente_itens AS ci
          WHERE ci.empresa_id = ct.empresa_id
            AND ci.titulo_id = ct.id
            AND ci.status <> 'CANCELADO'
        ),
        0
      ),
    status =
      CASE
        WHEN COALESCE(
          (
            SELECT SUM(ci.valor_aberto)
            FROM public.carteira_cliente_itens AS ci
            WHERE ci.empresa_id = ct.empresa_id
              AND ci.titulo_id = ct.id
              AND ci.status <> 'CANCELADO'
          ),
          0
        ) <= 0
          THEN 'QUITADO'
        WHEN COALESCE(
          (
            SELECT SUM(ci.valor_aberto)
            FROM public.carteira_cliente_itens AS ci
            WHERE ci.empresa_id = ct.empresa_id
              AND ci.titulo_id = ct.id
              AND ci.status <> 'CANCELADO'
          ),
          0
        ) < ct.valor_original
          THEN 'PARCIAL'
        ELSE 'ABERTO'
      END
  WHERE ct.empresa_id = p_empresa_id
    AND ct.cliente_id = p_cliente_id
    AND ct.status <> 'CANCELADO'
    AND EXISTS (
      SELECT 1
      FROM public.carteira_cliente_itens AS ci
      JOIN public.carteira_cliente_recebimento_alocacoes AS a
        ON a.empresa_id = ci.empresa_id
       AND a.item_id = ci.id
      WHERE ci.empresa_id = ct.empresa_id
        AND ci.titulo_id = ct.id
        AND a.recebimento_id = p_recebimento_id
    );

  INSERT INTO public.carteira_cliente_movimentacoes (
    empresa_id,
    cliente_id,
    usuario_id,
    tipo,
    origem,
    valor,
    recebimento_id,
    descricao
  )
  VALUES (
    p_empresa_id,
    p_cliente_id,
    v_usuario_id,
    'ESTORNO',
    'ESTORNO_RECEBIMENTO',
    v_estornado,
    p_recebimento_id,
    concat(
      'Estorno do recebimento. Motivo: ',
      v_motivo
    )
  );

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
    'recebimento_id', p_recebimento_id,
    'valor_estornado', v_estornado,
    'alocacoes_estornadas', v_alocacoes,
    'saldo_anterior', v_saldo_anterior,
    'saldo_atual', v_saldo_atual,
    'credito_disponivel', v_credito_atual,
    'motivo', v_motivo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_estornar_recebimento_carteira(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_estornar_recebimento_carteira(uuid, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_estornar_recebimento_carteira(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_estornar_recebimento_carteira(uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_cancelar_venda_comercial(p_empresa_id uuid, p_usuario_id uuid, p_venda_id uuid, p_motivo text, p_destino_recebido text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_venda public.vendas%rowtype;
  v_motivo text := NULLIF(btrim(p_motivo), '');
  v_destino text :=
    NULLIF(
      upper(
        btrim(
          coalesce(p_destino_recebido, '')
        )
      ),
      ''
    );

  v_qtd_movimentos integer := 0;
  v_qtd_estoque_estornada numeric := 0;

  v_pag record;
  v_pagamento_liquido numeric(14,2);
  v_pagamento_imediato_bruto numeric(14,2) := 0;
  v_pagamento_imediato_liquido numeric(14,2) := 0;
  v_troco_restante numeric(14,2) := 0;

  v_titulo_id uuid := NULL;
  v_titulo_cliente_id uuid := NULL;
  v_titulo_valor_aberto numeric(14,2) := 0;
  v_titulos_qtd integer := 0;
  v_recebido_fiado numeric(14,2) := 0;
  v_valor_aberto_cancelado numeric(14,2) := 0;
  v_aloc record;

  v_total_pago_cliente numeric(14,2) := 0;
  v_credito_id uuid;
  v_credito_gerado numeric(14,2) := 0;
  v_devolucao_registrada numeric(14,2) := 0;

  v_saldo_cliente_anterior numeric(14,2) := 0;
  v_saldo_cliente_atual numeric(14,2) := 0;
  v_credito_cliente_atual numeric(14,2) := 0;

  v_pagamentos_cancelados integer := 0;
BEGIN
  -- service_role (admin client) não tem auth.uid().
  -- Se houver sessão JWT, não confiar em p_usuario_id do cliente.
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
     OR p_venda_id IS NULL THEN
    RAISE EXCEPTION
      'Empresa, usuário e venda são obrigatórios.';
  END IF;

  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION
      'Informe o motivo do cancelamento com pelo menos 5 caracteres.';
  END IF;

  IF v_destino IS NOT NULL
     AND v_destino NOT IN ('DEVOLUCAO', 'CREDITO') THEN
    RAISE EXCEPTION
      'Destino do valor recebido inválido.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios AS u
    WHERE u.id = p_usuario_id
      AND u.ativo = true
  ) THEN
    RAISE EXCEPTION
      'Usuário interno não encontrado ou inativo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = p_usuario_id
      AND ue.empresa_id = p_empresa_id
      AND ue.ativo = true
  ) THEN
    RAISE EXCEPTION
      'Usuário não possui vínculo ativo com a empresa.';
  END IF;

  SELECT v.*
  INTO v_venda
  FROM public.vendas AS v
  WHERE v.empresa_id = p_empresa_id
    AND v.id = p_venda_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.';
  END IF;

  IF v_venda.status = 'cancelada' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'venda_id', v_venda.id,
      'numero', v_venda.numero,
      'status', 'cancelada',
      'reutilizada', true,
      'mensagem', 'A venda já estava cancelada.'
    );
  END IF;

  IF v_venda.status <> 'finalizada' THEN
    RAISE EXCEPTION
      'Somente venda finalizada pode ser cancelada.';
  END IF;

  -- Cancelamento comercial NAO altera fiscal_emissoes / Geranet.
  -- Consulta do documento fiscal permanece somente leitura.

  IF EXISTS (
    SELECT 1
    FROM public.estoque_movimentacoes AS em
    WHERE em.empresa_id = p_empresa_id
      AND em.venda_id = p_venda_id
      AND em.tipo = 'CANCELAMENTO_VENDA'
  ) THEN
    RAISE EXCEPTION
      'Já existe movimento de cancelamento de estoque para esta venda, mas a venda ainda não está cancelada. Revise a consistência.';
  END IF;

  IF v_venda.cliente_id IS NOT NULL THEN
    SELECT coalesce(SUM(vp.valor), 0)::numeric(14,2)
    INTO v_pagamento_imediato_bruto
    FROM public.vendas_pagamentos AS vp
    JOIN public.formas_pagamento AS fp
      ON fp.empresa_id = vp.empresa_id
     AND fp.id = vp.forma_pagamento_id
    WHERE vp.empresa_id = p_empresa_id
      AND vp.venda_id = p_venda_id
      AND vp.status = 'confirmado'
      AND fp.permite_fiado = false
      AND fp.movimenta_caixa = true;

    v_pagamento_imediato_liquido :=
      greatest(
        v_pagamento_imediato_bruto
        - coalesce(v_venda.troco, 0),
        0
      );
  END IF;

  SELECT count(*)
  INTO v_titulos_qtd
  FROM public.carteira_cliente_titulos AS t
  WHERE t.empresa_id = p_empresa_id
    AND t.venda_id = p_venda_id;

  IF v_titulos_qtd > 1 THEN
    RAISE EXCEPTION
      'Foram encontrados múltiplos títulos de carteira para a mesma venda. Cancelamento bloqueado para revisão.';
  END IF;

  IF v_titulos_qtd = 1 THEN
    SELECT
      t.id,
      t.cliente_id,
      t.valor_aberto
    INTO
      v_titulo_id,
      v_titulo_cliente_id,
      v_titulo_valor_aberto
    FROM public.carteira_cliente_titulos AS t
    WHERE t.empresa_id = p_empresa_id
      AND t.venda_id = p_venda_id
    FOR UPDATE;

    SELECT coalesce(SUM(a.valor), 0)::numeric(14,2)
    INTO v_recebido_fiado
    FROM public.carteira_cliente_recebimento_alocacoes AS a
    JOIN public.carteira_cliente_itens AS ci
      ON ci.empresa_id = a.empresa_id
     AND ci.id = a.item_id
    WHERE a.empresa_id = p_empresa_id
      AND ci.titulo_id = v_titulo_id;

    v_valor_aberto_cancelado :=
      coalesce(v_titulo_valor_aberto, 0);
  END IF;

  IF v_venda.cliente_id IS NOT NULL THEN
    v_total_pago_cliente :=
      round(
        v_pagamento_imediato_liquido + v_recebido_fiado,
        2
      );
  END IF;

  IF v_total_pago_cliente > 0 AND v_destino IS NULL THEN
    RAISE EXCEPTION
      'O cliente já pagou R$ % desta venda. Escolha DEVOLUCAO ou CREDITO.',
      to_char(v_total_pago_cliente, 'FM999999990D00');
  END IF;

  IF v_destino = 'CREDITO' AND v_venda.cliente_id IS NULL THEN
    RAISE EXCEPTION
      'Não é possível gerar crédito sem cliente identificado na venda.';
  END IF;

  SELECT
    produtos_afetados,
    quantidade_total
  INTO
    v_qtd_movimentos,
    v_qtd_estoque_estornada
  FROM public.estoque_estornar_composicao_venda_interno(
    p_empresa_id,
    p_venda_id,
    p_usuario_id,
    'CANCELAMENTO_VENDA',
    'CANCELAMENTO_VENDA',
    format(
      'Estorno de estoque pelo cancelamento da venda nº %s.',
      coalesce(v_venda.numero::text, p_venda_id::text)
    )
  );

  IF v_total_pago_cliente > 0 AND v_destino = 'CREDITO' THEN
    SELECT c.id
    INTO v_credito_id
    FROM public.carteira_cliente_creditos AS c
    WHERE c.empresa_id = p_empresa_id
      AND c.venda_id = p_venda_id
      AND c.origem = 'CANCELAMENTO_VENDA'
    FOR UPDATE;

    IF v_credito_id IS NULL THEN
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
        v_venda.cliente_id,
        'CANCELAMENTO_VENDA',
        p_venda_id,
        NULL,
        v_total_pago_cliente,
        v_total_pago_cliente,
        'DISPONIVEL',
        concat(
          'Crédito gerado pelo cancelamento da venda nº ',
          coalesce(v_venda.numero::text, 'sem número')
        )
      )
      RETURNING id
      INTO v_credito_id;
    END IF;

    v_credito_gerado := v_total_pago_cliente;

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
      v_venda.cliente_id,
      p_usuario_id,
      'CREDITO',
      'CREDITO_CANCELAMENTO_VENDA',
      v_total_pago_cliente,
      p_venda_id,
      CASE
        WHEN v_titulos_qtd = 1 THEN v_titulo_id
        ELSE NULL
      END,
      concat(
        'Crédito ao cliente pelo cancelamento da venda nº ',
        coalesce(v_venda.numero::text, 'sem número')
      )
    );
  END IF;

  IF v_venda.cliente_id IS NOT NULL
     AND v_pagamento_imediato_liquido > 0 THEN
    v_troco_restante := coalesce(v_venda.troco, 0);

    FOR v_pag IN
      SELECT
        vp.id,
        vp.valor,
        fp.permite_troco
      FROM public.vendas_pagamentos AS vp
      JOIN public.formas_pagamento AS fp
        ON fp.empresa_id = vp.empresa_id
       AND fp.id = vp.forma_pagamento_id
      WHERE vp.empresa_id = p_empresa_id
        AND vp.venda_id = p_venda_id
        AND vp.status = 'confirmado'
        AND fp.permite_fiado = false
        AND fp.movimenta_caixa = true
      ORDER BY
        CASE WHEN fp.permite_troco THEN 0 ELSE 1 END,
        vp.id
    LOOP
      v_pagamento_liquido := coalesce(v_pag.valor, 0);

      IF v_pag.permite_troco AND v_troco_restante > 0 THEN
        IF v_pagamento_liquido >= v_troco_restante THEN
          v_pagamento_liquido :=
            v_pagamento_liquido - v_troco_restante;
          v_troco_restante := 0;
        ELSE
          v_troco_restante :=
            v_troco_restante - v_pagamento_liquido;
          v_pagamento_liquido := 0;
        END IF;
      END IF;

      IF v_pagamento_liquido > 0 THEN
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
        SELECT
          p_empresa_id,
          v_venda.cliente_id,
          NULL,
          NULL,
          p_venda_id,
          CASE
            WHEN v_titulos_qtd = 1 THEN v_titulo_id
            ELSE NULL
          END,
          p_usuario_id,
          v_pagamento_liquido,
          v_destino,
          CASE
            WHEN v_destino = 'CREDITO'
              THEN 'CONVERTIDO_CREDITO'
            ELSE 'PENDENTE'
          END,
          CASE
            WHEN v_destino = 'CREDITO'
              THEN v_credito_id
            ELSE NULL
          END,
          v_motivo,
          CASE
            WHEN v_destino = 'CREDITO' THEN now()
            ELSE NULL
          END,
          v_pag.id,
          'PAGAMENTO_VENDA'
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.carteira_cliente_recebimento_estornos AS e
          WHERE e.empresa_id = p_empresa_id
            AND e.venda_pagamento_id = v_pag.id
        );
      END IF;
    END LOOP;
  END IF;

  IF v_titulos_qtd = 1 AND v_recebido_fiado > 0 THEN
    FOR v_aloc IN
      SELECT
        a.id AS alocacao_id,
        a.recebimento_id,
        a.valor
      FROM public.carteira_cliente_recebimento_alocacoes AS a
      JOIN public.carteira_cliente_itens AS ci
        ON ci.empresa_id = a.empresa_id
       AND ci.id = a.item_id
      WHERE a.empresa_id = p_empresa_id
        AND ci.titulo_id = v_titulo_id
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
        v_titulo_cliente_id,
        v_aloc.recebimento_id,
        v_aloc.alocacao_id,
        p_venda_id,
        v_titulo_id,
        p_usuario_id,
        v_aloc.valor,
        v_destino,
        CASE
          WHEN v_destino = 'CREDITO'
            THEN 'CONVERTIDO_CREDITO'
          ELSE 'PENDENTE'
        END,
        CASE
          WHEN v_destino = 'CREDITO'
            THEN v_credito_id
          ELSE NULL
        END,
        v_motivo,
        CASE
          WHEN v_destino = 'CREDITO' THEN now()
          ELSE NULL
        END,
        NULL,
        'RECEBIMENTO_FIADO'
      )
      ON CONFLICT (empresa_id, alocacao_id)
      DO NOTHING;
    END LOOP;
  END IF;

  IF v_total_pago_cliente > 0 AND v_destino = 'DEVOLUCAO' THEN
    v_devolucao_registrada := v_total_pago_cliente;

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
      v_venda.cliente_id,
      p_usuario_id,
      'ESTORNO',
      'DEVOLUCAO_CANCELAMENTO_VENDA',
      v_total_pago_cliente,
      p_venda_id,
      CASE
        WHEN v_titulos_qtd = 1 THEN v_titulo_id
        ELSE NULL
      END,
      concat(
        'Devolução pendente pelo cancelamento da venda nº ',
        coalesce(v_venda.numero::text, 'sem número')
      )
    );
  END IF;

  IF v_titulos_qtd = 1 THEN
    v_saldo_cliente_anterior :=
      public.carteira_recalcular_saldo_cliente_interno(
        p_empresa_id,
        v_titulo_cliente_id
      );

    IF v_valor_aberto_cancelado > 0 THEN
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
        v_titulo_cliente_id,
        p_usuario_id,
        'ESTORNO',
        'CANCELAMENTO_VENDA',
        v_valor_aberto_cancelado,
        p_venda_id,
        v_titulo_id,
        concat(
          'Estorno do saldo aberto pelo cancelamento da venda nº ',
          coalesce(v_venda.numero::text, 'sem número')
        )
      );
    END IF;

    UPDATE public.carteira_cliente_itens AS ci
    SET
      valor_aberto = 0,
      status = 'CANCELADO'
    WHERE ci.empresa_id = p_empresa_id
      AND ci.titulo_id = v_titulo_id
      AND ci.status <> 'CANCELADO';

    UPDATE public.carteira_cliente_titulos AS t
    SET
      valor_aberto = 0,
      status = 'CANCELADO'
    WHERE t.empresa_id = p_empresa_id
      AND t.id = v_titulo_id;

    v_saldo_cliente_atual :=
      public.carteira_recalcular_saldo_cliente_interno(
        p_empresa_id,
        v_titulo_cliente_id
      );
  ELSIF v_venda.cliente_id IS NOT NULL THEN
    SELECT coalesce(c.saldo_devedor, 0)
    INTO v_saldo_cliente_atual
    FROM public.clientes AS c
    WHERE c.empresa_id = p_empresa_id
      AND c.id = v_venda.cliente_id;

    v_saldo_cliente_anterior := v_saldo_cliente_atual;
  END IF;

  IF v_venda.cliente_id IS NOT NULL THEN
    v_credito_cliente_atual :=
      public.carteira_credito_disponivel_cliente_interno(
        p_empresa_id,
        v_venda.cliente_id
      );
  END IF;

  UPDATE public.vendas_pagamentos AS vp
  SET
    status = 'cancelado',
    updated_at = now()
  WHERE vp.empresa_id = p_empresa_id
    AND vp.venda_id = p_venda_id
    AND vp.status = 'confirmado';

  GET DIAGNOSTICS
    v_pagamentos_cancelados = ROW_COUNT;

  UPDATE public.vendas AS v
  SET
    status = 'cancelada',
    cancelada_at = now(),
    cancelada_por = p_usuario_id,
    motivo_cancelamento = v_motivo,
    updated_at = now()
  WHERE v.empresa_id = p_empresa_id
    AND v.id = p_venda_id;

  RETURN jsonb_build_object(
    'ok', true,
    'venda_id', p_venda_id,
    'numero', v_venda.numero,
    'status', 'cancelada',
    'cliente_id', v_venda.cliente_id,
    'estoque_quantidade_estornada', v_qtd_estoque_estornada,
    'estoque_movimentos_estornados', v_qtd_movimentos,
    'pagamento_imediato_liquido', v_pagamento_imediato_liquido,
    'fiado_recebido', v_recebido_fiado,
    'fiado_saldo_aberto_cancelado', v_valor_aberto_cancelado,
    'valor_pago_cliente_tratado', v_total_pago_cliente,
    'destino_valor_recebido', v_destino,
    'credito_gerado', v_credito_gerado,
    'credito_cliente_disponivel', v_credito_cliente_atual,
    'devolucao_registrada', v_devolucao_registrada,
    'devolucao_status',
      CASE
        WHEN v_devolucao_registrada > 0 THEN 'PENDENTE'
        ELSE NULL
      END,
    'saldo_cliente_anterior', v_saldo_cliente_anterior,
    'saldo_cliente_atual', v_saldo_cliente_atual,
    'pagamentos_cancelados', v_pagamentos_cancelados,
    'motivo', v_motivo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) TO service_role;

COMMIT;
