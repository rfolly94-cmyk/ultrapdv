BEGIN;

-- ============================================================
-- UltraPDV — Proteção de corpo das RPCs P0
-- Data: 2026-08-18
--
-- rpc_criar_empresa_onboarding: chamada legítima é service_role
-- (app/api/onboarding/empresa via createAdminClient). Não exigir
-- auth.uid() IS NOT NULL. Se houver JWT, uid deve = p_usuario_id.
--
-- rpc_cancelar_venda_comercial: chamada legítima é service_role
-- (app/api/vendas/[id]/cancelar via admin.rpc). Mesma regra.
-- Semântica comercial do cancelamento permanece idêntica.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_criar_empresa_onboarding(
  p_usuario_id uuid,
  p_email text,
  p_nome text,
  p_razao_social text,
  p_nome_fantasia text,
  p_cnpj text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nome text := btrim(coalesce(p_nome, ''));
  v_razao_social text := btrim(coalesce(p_razao_social, ''));
  v_nome_fantasia text := btrim(coalesce(p_nome_fantasia, ''));
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário inválido.';
  END IF;

  -- service_role (Next.js admin client) não possui auth.uid().
  -- Se a chamada vier com JWT, p_usuario_id não pode ser de outra pessoa.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_usuario_id THEN
    RAISE EXCEPTION 'Não autorizado a criar empresa para outro usuário.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_usuario_id
  ) THEN
    RAISE EXCEPTION 'Usuário autenticado não encontrado.';
  END IF;

  IF length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Informe o nome do responsável.';
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'E-mail do usuário não encontrado.';
  END IF;

  IF length(v_razao_social) < 2 THEN
    RAISE EXCEPTION 'Informe a razão social.';
  END IF;

  IF length(v_nome_fantasia) < 2 THEN
    RAISE EXCEPTION 'Informe o nome fantasia.';
  END IF;

  IF length(v_cnpj) <> 14 THEN
    RAISE EXCEPTION 'CNPJ deve possuir 14 dígitos.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('ultrapdv:onboarding:user:' || p_usuario_id::text)::bigint
  );

  PERFORM pg_advisory_xact_lock(
    hashtext('ultrapdv:onboarding:cnpj:' || v_cnpj)::bigint
  );

  IF EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = p_usuario_id
      AND ue.principal = true
      AND ue.ativo = true
  ) THEN
    RAISE EXCEPTION
      'Este usuário já possui uma empresa principal ativa.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.empresas e
    WHERE regexp_replace(coalesce(e.cnpj, ''), '[^0-9]', '', 'g') = v_cnpj
  ) THEN
    RAISE EXCEPTION
      'Este CNPJ já está cadastrado no UltraPDV.';
  END IF;

  v_empresa_id := gen_random_uuid();

  INSERT INTO public.empresas (
    id,
    razao_social,
    nome_fantasia,
    cnpj,
    ativo
  )
  VALUES (
    v_empresa_id,
    v_razao_social,
    v_nome_fantasia,
    v_cnpj,
    true
  );

  INSERT INTO public.usuarios (
    id,
    nome,
    email,
    ativo
  )
  VALUES (
    p_usuario_id,
    v_nome,
    v_email,
    true
  )
  ON CONFLICT (id)
  DO UPDATE SET
    nome = EXCLUDED.nome,
    email = EXCLUDED.email,
    ativo = true,
    updated_at = now();

  INSERT INTO public.usuarios_empresas (
    usuario_id,
    empresa_id,
    perfil,
    principal,
    ativo
  )
  VALUES (
    p_usuario_id,
    v_empresa_id,
    'administrador',
    true,
    true
  );

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'usuario_id', p_usuario_id,
    'perfil', 'administrador'
  );
END;
$function$;


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

  IF EXISTS (
    SELECT 1
    FROM public.fiscal_emissoes AS fe
    WHERE fe.empresa_id = p_empresa_id
      AND fe.origem_tipo = 'venda'
      AND fe.origem_id = p_venda_id
      AND fe.status IN (
        'autorizada',
        'enviando',
        'erro_comunicacao',
        'aguardando_reconciliacao'
      )
  ) THEN
    RAISE EXCEPTION
      'A venda possui documento fiscal autorizado ou em estado fiscal pendente/ambíguo. Resolva o fiscal antes do cancelamento comercial.';
  END IF;

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


REVOKE ALL ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_criar_empresa_onboarding(uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cancelar_venda_comercial(uuid, uuid, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
