BEGIN;

-- ============================================================
-- UltraPDV — Corrigir ambiguidade em rpc_editar_venda_pdv
-- Data: 2026-08-15
--
-- Erro remoto:
--   column reference "venda_id" is ambiguous
--
-- Causa:
--   RETURNS TABLE declara venda_id, numero, valor_produtos,
--   desconto, acrescimo, frete, valor_total, troco e status
--   como variáveis PL/pgSQL. SQLs sem alias colidem com esses
--   nomes.
--
-- Escopo:
--   CREATE OR REPLACE somente de public.rpc_editar_venda_pdv.
--   Semântica de edição/estoque inalterada.
--   Grants existentes são preservados.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_editar_venda_pdv(
  p_empresa_id uuid,
  p_venda_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_desconto numeric DEFAULT 0,
  p_troco numeric DEFAULT 0,
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
SET search_path = public, auth
AS $function$
DECLARE
  v_usuario_id uuid;
  v_venda public.vendas%rowtype;

  v_item jsonb;
  v_pagamento jsonb;
  v_resolvidos jsonb := '[]'::jsonb;

  v_produto record;
  v_item_antigo record;
  v_item_resolvido jsonb;

  v_produto_id uuid;
  v_venda_item_id uuid;
  v_qtd numeric;
  v_valor_unitario numeric;
  v_desconto_item numeric;
  v_acrescimo_item numeric;
  v_total_item numeric;

  v_valor_produtos numeric := 0;
  v_desconto_itens numeric := 0;
  v_acrescimo_itens numeric := 0;
  v_desconto_total numeric := 0;
  v_total_venda numeric := 0;

  v_forma record;
  v_forma_id uuid;
  v_valor_pagamento numeric;
  v_total_pagamentos numeric := 0;
  v_parcelas integer;
  v_indicador text;
  v_tem_troco boolean := false;
  v_tem_fiado boolean := false;

  v_lock record;
  v_saldo numeric;
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios AS u
    WHERE u.id = v_usuario_id
      AND u.ativo = true
  ) THEN
    RAISE EXCEPTION 'Usuário ativo não encontrado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = v_usuario_id
      AND ue.empresa_id = p_empresa_id
      AND ue.ativo = true
  ) THEN
    RAISE EXCEPTION 'Usuário não possui acesso à empresa informada.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_empresa_id::text),
    hashtext(p_venda_id::text)
  );

  SELECT v.*
  INTO v_venda
  FROM public.vendas AS v
  WHERE v.empresa_id = p_empresa_id
    AND v.id = p_venda_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.';
  END IF;

  IF v_venda.status <> 'finalizada' THEN
    RAISE EXCEPTION 'Somente venda finalizada pode ser editada.';
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
      'Esta venda possui documento fiscal autorizado ou em estado sensível. Cancele/reconcilie o documento fiscal antes de editar.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.carteira_cliente_titulos AS ct
    WHERE ct.empresa_id = p_empresa_id
      AND ct.venda_id = p_venda_id
  ) THEN
    RAISE EXCEPTION
      'Venda com histórico FIADO/Carteira não pode ser editada diretamente. Cancele a venda e refaça o lançamento.';
  END IF;

  IF p_cliente_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.clientes AS c
       WHERE c.empresa_id = p_empresa_id
         AND c.id = p_cliente_id
         AND c.ativo = true
     ) THEN
    RAISE EXCEPTION
      'Cliente não encontrado, inativo ou pertence a outra empresa.';
  END IF;

  IF coalesce(p_desconto, 0) < 0 THEN
    RAISE EXCEPTION 'Desconto não pode ser negativo.';
  END IF;

  IF coalesce(p_troco, 0) < 0 THEN
    RAISE EXCEPTION 'Troco não pode ser negativo.';
  END IF;

  IF coalesce(jsonb_typeof(p_itens), '') <> 'array'
     OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'A venda deve possuir ao menos um item.';
  END IF;

  IF coalesce(jsonb_typeof(p_pagamentos), '') <> 'array'
     OR jsonb_array_length(p_pagamentos) = 0 THEN
    RAISE EXCEPTION 'A venda deve possuir ao menos um pagamento.';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_itens)
  LOOP
    BEGIN
      v_produto_id := (v_item ->> 'produto_id')::uuid;
      v_qtd := (v_item ->> 'quantidade')::numeric;
      v_venda_item_id :=
        NULLIF(v_item ->> 'venda_item_id', '')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Item inválido na edição da venda.';
    END;

    IF v_qtd IS NULL OR v_qtd <= 0 THEN
      RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
    END IF;

    SELECT
      p.id,
      p.codigo,
      p.nome,
      p.unidade_medida,
      p.preco_venda,
      p.grupo_fiscal_id,
      pf.ncm,
      pf.cest,
      pf.origem_produto
    INTO v_produto
    FROM public.produtos AS p
    LEFT JOIN public.produtos_fiscal AS pf
      ON pf.empresa_id = p_empresa_id
     AND pf.produto_id = p.id
    WHERE p.empresa_id = p_empresa_id
      AND p.id = v_produto_id
      AND p.ativo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Produto não encontrado, inativo ou pertence a outra empresa: %.',
        v_produto_id;
    END IF;

    v_desconto_item := 0;
    v_acrescimo_item := 0;

    IF v_venda_item_id IS NOT NULL THEN
      SELECT vi.*
      INTO v_item_antigo
      FROM public.vendas_itens AS vi
      WHERE vi.empresa_id = p_empresa_id
        AND vi.venda_id = p_venda_id
        AND vi.id = v_venda_item_id
        AND vi.produto_id = v_produto_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Um item original informado não pertence a esta venda.';
      END IF;

      v_valor_unitario := v_item_antigo.valor_unitario;
      v_desconto_item := coalesce(v_item_antigo.desconto, 0);
      v_acrescimo_item := coalesce(v_item_antigo.acrescimo, 0);
    ELSE
      v_valor_unitario := coalesce(v_produto.preco_venda, 0);
    END IF;

    IF v_valor_unitario < 0 THEN
      RAISE EXCEPTION
        'Preço inválido para o produto %.',
        v_produto.nome;
    END IF;

    v_total_item := round(
      (v_qtd * v_valor_unitario)
      - v_desconto_item
      + v_acrescimo_item,
      2
    );

    IF v_total_item < 0 THEN
      RAISE EXCEPTION
        'Total inválido para o produto %.',
        v_produto.nome;
    END IF;

    v_valor_produtos :=
      v_valor_produtos +
      round(v_qtd * v_valor_unitario, 2);

    v_desconto_itens :=
      v_desconto_itens + v_desconto_item;

    v_acrescimo_itens :=
      v_acrescimo_itens + v_acrescimo_item;

    v_resolvidos := v_resolvidos || jsonb_build_array(
      jsonb_build_object(
        'produto_id', v_produto.id,
        'produto_codigo', v_produto.codigo,
        'produto_nome', v_produto.nome,
        'unidade_medida', v_produto.unidade_medida,
        'quantidade', v_qtd,
        'valor_unitario', v_valor_unitario,
        'desconto', v_desconto_item,
        'acrescimo', v_acrescimo_item,
        'valor_total', v_total_item,
        'grupo_fiscal_id', v_produto.grupo_fiscal_id,
        'ncm', v_produto.ncm,
        'cest', v_produto.cest,
        'origem_produto', v_produto.origem_produto
      )
    );
  END LOOP;

  v_desconto_total := round(
    v_desconto_itens + coalesce(p_desconto, 0),
    2
  );

  v_total_venda := round(
    v_valor_produtos
    - v_desconto_total
    + v_acrescimo_itens
    + coalesce(v_venda.frete, 0)
    + greatest(
        coalesce(v_venda.acrescimo, 0) - v_acrescimo_itens,
        0
      ),
    2
  );

  IF v_total_venda <= 0 THEN
    RAISE EXCEPTION 'O total da venda deve ser maior que zero.';
  END IF;

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(p_pagamentos)
  LOOP
    BEGIN
      v_forma_id := (v_pagamento ->> 'forma_pagamento_id')::uuid;
      v_valor_pagamento := (v_pagamento ->> 'valor')::numeric;
      v_parcelas := coalesce(
        NULLIF(v_pagamento ->> 'quantidade_parcelas', '')::integer,
        1
      );
      v_indicador := coalesce(
        NULLIF(btrim(v_pagamento ->> 'indicador_pagamento'), ''),
        '0'
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Pagamento inválido na edição da venda.';
    END;

    SELECT fp.*
    INTO v_forma
    FROM public.formas_pagamento AS fp
    WHERE fp.empresa_id = p_empresa_id
      AND fp.id = v_forma_id
      AND fp.ativo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Forma de pagamento não encontrada ou inativa.';
    END IF;

    IF v_valor_pagamento IS NULL OR v_valor_pagamento <= 0 THEN
      RAISE EXCEPTION 'Valor do pagamento deve ser maior que zero.';
    END IF;

    IF v_parcelas < 1 THEN
      RAISE EXCEPTION 'Quantidade de parcelas inválida.';
    END IF;

    IF v_parcelas > 1 AND NOT v_forma.permite_parcelamento THEN
      RAISE EXCEPTION
        'A forma de pagamento % não permite parcelamento.',
        v_forma.nome;
    END IF;

    IF v_indicador NOT IN ('0', '1') THEN
      RAISE EXCEPTION 'Indicador de pagamento inválido.';
    END IF;

    IF v_forma.permite_fiado THEN
      v_tem_fiado := true;
      IF p_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Pagamento fiado exige cliente.';
      END IF;
    END IF;

    IF v_forma.permite_troco THEN
      v_tem_troco := true;
    END IF;

    v_total_pagamentos :=
      v_total_pagamentos + v_valor_pagamento;
  END LOOP;

  IF coalesce(p_troco, 0) > 0 AND NOT v_tem_troco THEN
    RAISE EXCEPTION
      'Foi informado troco, mas nenhuma forma selecionada permite troco.';
  END IF;

  IF abs(
    v_total_pagamentos -
    (v_total_venda + coalesce(p_troco, 0))
  ) > 0.01 THEN
    RAISE EXCEPTION
      'Pagamentos não conferem. Total da venda: %, troco: %, informado: %.',
      v_total_venda,
      coalesce(p_troco, 0),
      v_total_pagamentos;
  END IF;

  -- Lock dos produtos envolvidos (atual ∪ nova) em ordem estável.
  FOR v_lock IN
    SELECT x.produto_id
    FROM (
      SELECT vi.produto_id
      FROM public.vendas_itens AS vi
      WHERE vi.empresa_id = p_empresa_id
        AND vi.venda_id = p_venda_id
      UNION
      SELECT (value ->> 'produto_id')::uuid
      FROM jsonb_array_elements(v_resolvidos)
    ) AS x
    ORDER BY x.produto_id
  LOOP
    PERFORM 1
    FROM public.estoque_atual AS ea
    WHERE ea.empresa_id = p_empresa_id
      AND ea.produto_id = v_lock.produto_id
    FOR UPDATE;
  END LOOP;

  FOR v_lock IN
    SELECT
      nova.produto_id,
      nova.quantidade AS qtd_nova,
      coalesce(atual.quantidade, 0) AS qtd_atual,
      p.nome AS nome
    FROM (
      SELECT
        (value ->> 'produto_id')::uuid AS produto_id,
        SUM((value ->> 'quantidade')::numeric) AS quantidade
      FROM jsonb_array_elements(v_resolvidos)
      GROUP BY 1
    ) AS nova
    LEFT JOIN (
      SELECT
        vi.produto_id,
        SUM(vi.quantidade) AS quantidade
      FROM public.vendas_itens AS vi
      WHERE vi.empresa_id = p_empresa_id
        AND vi.venda_id = p_venda_id
      GROUP BY vi.produto_id
    ) AS atual
      ON atual.produto_id = nova.produto_id
    JOIN public.produtos AS p
      ON p.empresa_id = p_empresa_id
     AND p.id = nova.produto_id
  LOOP
    SELECT ea.quantidade
    INTO v_saldo
    FROM public.estoque_atual AS ea
    WHERE ea.empresa_id = p_empresa_id
      AND ea.produto_id = v_lock.produto_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Estoque atual não encontrado para o produto %.',
        v_lock.nome;
    END IF;

    IF coalesce(v_saldo, 0) + v_lock.qtd_atual < v_lock.qtd_nova THEN
      RAISE EXCEPTION
        'Estoque insuficiente para o produto %. Disponível: %, necessário: %.',
        v_lock.nome,
        coalesce(v_saldo, 0) + v_lock.qtd_atual,
        v_lock.qtd_nova;
    END IF;
  END LOOP;

  PERFORM public.estoque_estornar_composicao_venda_interno(
    p_empresa_id,
    p_venda_id,
    v_usuario_id,
    'ESTORNO_EDICAO',
    'EDICAO_VENDA',
    concat(
      'Estorno da composição anterior na edição da venda nº ',
      coalesce(v_venda.numero::text, p_venda_id::text),
      '.'
    )
  );

  UPDATE public.vendas_pagamentos AS vp
  SET status = 'cancelado'
  WHERE vp.empresa_id = p_empresa_id
    AND vp.venda_id = p_venda_id
    AND vp.status = 'confirmado';

  DELETE FROM public.vendas_itens AS vi
  WHERE vi.empresa_id = p_empresa_id
    AND vi.venda_id = p_venda_id;

  FOR v_item_resolvido IN
    SELECT value
    FROM jsonb_array_elements(v_resolvidos)
  LOOP
    INSERT INTO public.vendas_itens (
      empresa_id,
      venda_id,
      produto_id,
      produto_codigo,
      produto_nome,
      unidade_medida,
      quantidade,
      valor_unitario,
      desconto,
      acrescimo,
      valor_total,
      grupo_fiscal_id,
      ncm,
      cest,
      origem_produto
    )
    VALUES (
      p_empresa_id,
      p_venda_id,
      (v_item_resolvido ->> 'produto_id')::uuid,
      v_item_resolvido ->> 'produto_codigo',
      v_item_resolvido ->> 'produto_nome',
      coalesce(NULLIF(v_item_resolvido ->> 'unidade_medida', ''), 'UN'),
      (v_item_resolvido ->> 'quantidade')::numeric,
      (v_item_resolvido ->> 'valor_unitario')::numeric,
      (v_item_resolvido ->> 'desconto')::numeric,
      (v_item_resolvido ->> 'acrescimo')::numeric,
      (v_item_resolvido ->> 'valor_total')::numeric,
      NULLIF(v_item_resolvido ->> 'grupo_fiscal_id', '')::uuid,
      NULLIF(v_item_resolvido ->> 'ncm', ''),
      NULLIF(v_item_resolvido ->> 'cest', ''),
      NULLIF(v_item_resolvido ->> 'origem_produto', '')
    );
  END LOOP;

  PERFORM public.estoque_baixar_composicao_venda_interno(
    p_empresa_id,
    p_venda_id,
    v_usuario_id,
    'EDICAO_VENDA',
    concat(
      'Baixa da nova composição após edição da venda nº ',
      coalesce(v_venda.numero::text, p_venda_id::text),
      '.'
    )
  );

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(p_pagamentos)
  LOOP
    v_forma_id := (v_pagamento ->> 'forma_pagamento_id')::uuid;
    v_valor_pagamento := (v_pagamento ->> 'valor')::numeric;
    v_parcelas := coalesce(
      NULLIF(v_pagamento ->> 'quantidade_parcelas', '')::integer,
      1
    );
    v_indicador := coalesce(
      NULLIF(btrim(v_pagamento ->> 'indicador_pagamento'), ''),
      '0'
    );

    SELECT fp.*
    INTO v_forma
    FROM public.formas_pagamento AS fp
    WHERE fp.empresa_id = p_empresa_id
      AND fp.id = v_forma_id
      AND fp.ativo = true;

    INSERT INTO public.vendas_pagamentos (
      empresa_id,
      venda_id,
      forma_pagamento_id,
      valor,
      quantidade_parcelas,
      forma_pagamento_codigo,
      forma_pagamento_nome,
      codigo_fiscal,
      indicador_pagamento,
      bandeira,
      autorizacao,
      troco,
      status
    )
    VALUES (
      p_empresa_id,
      p_venda_id,
      v_forma.id,
      v_valor_pagamento,
      v_parcelas,
      v_forma.codigo,
      v_forma.nome,
      v_forma.codigo_fiscal,
      v_indicador,
      NULLIF(v_pagamento ->> 'bandeira', ''),
      NULLIF(v_pagamento ->> 'autorizacao', ''),
      0,
      'confirmado'
    );
  END LOOP;

  UPDATE public.vendas AS v
  SET
    cliente_id = p_cliente_id,
    valor_produtos = round(v_valor_produtos, 2),
    desconto = round(v_desconto_total, 2),
    acrescimo = round(coalesce(v_venda.acrescimo, 0), 2),
    valor_total = round(v_total_venda, 2),
    troco = round(coalesce(p_troco, 0), 2),
    usuario_id = v_usuario_id,
    updated_at = now()
  WHERE v.empresa_id = p_empresa_id
    AND v.id = p_venda_id;

  IF v_tem_fiado THEN
    PERFORM public.carteira_criar_debito_venda_interno(
      p_empresa_id,
      p_venda_id
    );
  END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.numero,
    v.valor_produtos,
    v.desconto,
    v.acrescimo,
    v.frete,
    v.valor_total,
    v.troco,
    v.status
  FROM public.vendas AS v
  WHERE v.empresa_id = p_empresa_id
    AND v.id = p_venda_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
