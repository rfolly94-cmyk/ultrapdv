BEGIN;

-- ============================================================
-- UltraPDV — Estoque transacional na venda / edição / cancelamento
--
-- Contrato:
--   estoque_atual              = saldo atual
--   vendas_itens               = composição atual da venda
--   estoque_movimentacoes      = ledger / auditoria
--
--   rpc_finalizar_venda        = NÃO ALTERAR (idempotência)
--   finalizar_venda_comercial_interno_v1 = NÃO ALTERAR
--
--   finalizar_venda_comercial_interno
--     depois de _v1, baixa vendas_itens (tipo=VENDA, origem=VENDA)
--
--   rpc_editar_venda_pdv
--     estorna composição atual (ESTORNO_EDICAO)
--     substitui itens
--     baixa a nova composição uma vez (VENDA / EDICAO_VENDA)
--
--   rpc_cancelar_venda_comercial
--     devolve a composição atual de vendas_itens
--     (NÃO soma histórico tipo=VENDA)
-- ============================================================

ALTER TABLE public.estoque_movimentacoes
  DROP CONSTRAINT IF EXISTS estoque_movimentacoes_tipo_check;

ALTER TABLE public.estoque_movimentacoes
  ADD CONSTRAINT estoque_movimentacoes_tipo_check
  CHECK (
    tipo IN (
      'ENTRADA',
      'SAIDA',
      'AJUSTE_POSITIVO',
      'AJUSTE_NEGATIVO',
      'VENDA',
      'ESTORNO_EDICAO',
      'CANCELAMENTO_VENDA'
    )
  );

CREATE INDEX IF NOT EXISTS ix_estoque_movimentacoes_venda_tipo
  ON public.estoque_movimentacoes (
    empresa_id,
    venda_id,
    tipo
  )
  WHERE venda_id IS NOT NULL;

-- ------------------------------------------------------------
-- Baixa a composição ATUAL de vendas_itens.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estoque_baixar_composicao_venda_interno(
  p_empresa_id uuid,
  p_venda_id uuid,
  p_usuario_id uuid,
  p_origem text,
  p_observacao text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_item record;
  v_estoque record;
  v_saldo_anterior numeric;
  v_saldo_posterior numeric;
  v_produtos integer := 0;
BEGIN
  IF p_empresa_id IS NULL OR p_venda_id IS NULL THEN
    RAISE EXCEPTION
      'Empresa e venda são obrigatórios para baixa de estoque.';
  END IF;

  IF NULLIF(btrim(coalesce(p_origem, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'Origem da baixa de estoque é obrigatória.';
  END IF;

  FOR v_item IN
    SELECT
      vi.produto_id,
      SUM(vi.quantidade)::numeric AS quantidade,
      MIN(vi.produto_nome) AS produto_nome
    FROM public.vendas_itens AS vi
    WHERE vi.empresa_id = p_empresa_id
      AND vi.venda_id = p_venda_id
    GROUP BY vi.produto_id
    ORDER BY vi.produto_id
  LOOP
    v_produtos := v_produtos + 1;

    IF coalesce(v_item.quantidade, 0) <= 0 THEN
      RAISE EXCEPTION
        'Quantidade inválida na composição da venda.';
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
        coalesce(
          v_item.produto_nome,
          v_item.produto_id::text
        );
    END IF;

    v_saldo_anterior := coalesce(v_estoque.quantidade, 0);

    IF v_saldo_anterior < v_item.quantidade THEN
      RAISE EXCEPTION
        'Estoque insuficiente para o produto %. Disponível: %, necessário: %.',
        coalesce(
          v_item.produto_nome,
          v_item.produto_id::text
        ),
        v_saldo_anterior,
        v_item.quantidade;
    END IF;

    v_saldo_posterior :=
      v_saldo_anterior - v_item.quantidade;

    UPDATE public.estoque_atual
    SET
      quantidade = v_saldo_posterior,
      updated_at = now()
    WHERE id = v_estoque.id;

    INSERT INTO public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      venda_id,
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
      p_usuario_id,
      'VENDA',
      p_origem,
      v_item.quantidade,
      v_saldo_anterior,
      v_saldo_posterior,
      p_observacao
    );
  END LOOP;

  IF v_produtos = 0 THEN
    RAISE EXCEPTION
      'A venda não possui itens para baixa de estoque.';
  END IF;
END;
$function$;

-- ------------------------------------------------------------
-- Estorna a composição ATUAL de vendas_itens.
-- p_tipo: ESTORNO_EDICAO | CANCELAMENTO_VENDA
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estoque_estornar_composicao_venda_interno(
  p_empresa_id uuid,
  p_venda_id uuid,
  p_usuario_id uuid,
  p_tipo text,
  p_origem text,
  p_observacao text
)
RETURNS TABLE (
  produtos_afetados integer,
  quantidade_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  IF p_tipo NOT IN (
    'ESTORNO_EDICAO',
    'CANCELAMENTO_VENDA'
  ) THEN
    RAISE EXCEPTION
      'Tipo de estorno de estoque inválido.';
  END IF;

  IF NULLIF(btrim(coalesce(p_origem, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'Origem do estorno de estoque é obrigatória.';
  END IF;

  FOR v_item IN
    SELECT
      vi.produto_id,
      SUM(vi.quantidade)::numeric AS quantidade,
      MIN(vi.produto_nome) AS produto_nome
    FROM public.vendas_itens AS vi
    WHERE vi.empresa_id = p_empresa_id
      AND vi.venda_id = p_venda_id
    GROUP BY vi.produto_id
    ORDER BY vi.produto_id
  LOOP
    IF coalesce(v_item.quantidade, 0) <= 0 THEN
      RAISE EXCEPTION
        'Quantidade inválida na composição da venda.';
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
        coalesce(
          v_item.produto_nome,
          v_item.produto_id::text
        );
    END IF;

    v_saldo_anterior := coalesce(v_estoque.quantidade, 0);
    v_saldo_posterior :=
      v_saldo_anterior + v_item.quantidade;

    UPDATE public.estoque_atual
    SET
      quantidade = v_saldo_posterior,
      updated_at = now()
    WHERE id = v_estoque.id;

    INSERT INTO public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      venda_id,
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
      p_usuario_id,
      p_tipo,
      p_origem,
      v_item.quantidade,
      v_saldo_anterior,
      v_saldo_posterior,
      p_observacao
    );

    v_produtos := v_produtos + 1;
    v_quantidade :=
      v_quantidade + v_item.quantidade;
  END LOOP;

  IF v_produtos = 0 THEN
    RAISE EXCEPTION
      'A venda não possui itens para estorno de estoque.';
  END IF;

  produtos_afetados := v_produtos;
  quantidade_total := v_quantidade;
  RETURN NEXT;
END;
$function$;

-- CREATE FUNCTION concede EXECUTE a PUBLIC por padrão.
-- Estas funções são apenas internas (chamadas por outras SECURITY DEFINER).
REVOKE EXECUTE ON FUNCTION public.estoque_baixar_composicao_venda_interno(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.estoque_baixar_composicao_venda_interno(uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.estoque_baixar_composicao_venda_interno(uuid, uuid, uuid, text, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.estoque_estornar_composicao_venda_interno(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.estoque_estornar_composicao_venda_interno(uuid, uuid, uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.estoque_estornar_composicao_venda_interno(uuid, uuid, uuid, text, text, text) FROM authenticated;

-- ------------------------------------------------------------
-- Wrapper da finalização: baixa estoque após _v1, antes da carteira.
-- ------------------------------------------------------------

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
SET search_path = public, auth
AS $function$
DECLARE
  v_item jsonb;
  v_itens_sanitizados jsonb := '[]'::jsonb;

  v_pagamento jsonb;
  v_forma_id uuid;
  v_tem_fiado boolean := false;

  v_venda record;
BEGIN
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

  PERFORM public.estoque_baixar_composicao_venda_interno(
    p_empresa_id,
    v_venda.venda_id,
    auth.uid(),
    'VENDA',
    concat(
      'Baixa de estoque da venda nº ',
      coalesce(
        v_venda.numero::text,
        v_venda.venda_id::text
      ),
      '.'
    )
  );

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
$function$;

-- ------------------------------------------------------------
-- Edição: estorna composição atual, substitui itens, baixa uma vez.
-- ------------------------------------------------------------

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

  UPDATE public.vendas_pagamentos
  SET status = 'cancelado'
  WHERE empresa_id = p_empresa_id
    AND venda_id = p_venda_id
    AND status = 'confirmado';

  DELETE FROM public.vendas_itens
  WHERE empresa_id = p_empresa_id
    AND venda_id = p_venda_id;

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

  UPDATE public.vendas
  SET
    cliente_id = p_cliente_id,
    valor_produtos = round(v_valor_produtos, 2),
    desconto = round(v_desconto_total, 2),
    acrescimo = round(coalesce(v_venda.acrescimo, 0), 2),
    valor_total = round(v_total_venda, 2),
    troco = round(coalesce(p_troco, 0), 2),
    usuario_id = v_usuario_id,
    updated_at = now()
  WHERE empresa_id = p_empresa_id
    AND id = p_venda_id;

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

-- ------------------------------------------------------------
-- Cancelamento: devolve vendas_itens atuais, não o histórico VENDA.
-- Corpo comercial/carteira permanece o da RPC canônica 132205.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_cancelar_venda_comercial(
  p_empresa_id uuid,
  p_usuario_id uuid,
  p_venda_id uuid,
  p_motivo text,
  p_destino_recebido text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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

NOTIFY pgrst, 'reload schema';

COMMIT;
