BEGIN;

-- UltraPDV — item avulso / venda rápida no PDV.
-- Multiempresa: config em pdv_configuracoes; produto fiscal padrão da MESMA empresa.
-- Vendas só com produto continuam em finalizar_venda_comercial_interno_v1.
-- Item avulso NÃO cria produto e NÃO movimenta estoque.

ALTER TABLE public.vendas_itens
  ALTER COLUMN produto_id DROP NOT NULL;

ALTER TABLE public.vendas_itens
  ADD COLUMN IF NOT EXISTS origem_item text NOT NULL DEFAULT 'produto';

UPDATE public.vendas_itens
SET origem_item = 'produto'
WHERE origem_item IS NULL
   OR btrim(origem_item) = '';

ALTER TABLE public.vendas_itens
  DROP CONSTRAINT IF EXISTS vendas_itens_origem_item_check;

ALTER TABLE public.vendas_itens
  ADD CONSTRAINT vendas_itens_origem_item_check
  CHECK (origem_item IN ('produto', 'avulso'));

ALTER TABLE public.vendas_itens
  DROP CONSTRAINT IF EXISTS vendas_itens_avulso_produto_id_check;

ALTER TABLE public.vendas_itens
  ADD CONSTRAINT vendas_itens_avulso_produto_id_check
  CHECK (
    (origem_item = 'produto' AND produto_id IS NOT NULL)
    OR (origem_item = 'avulso' AND produto_id IS NULL)
  );

COMMENT ON COLUMN public.vendas_itens.origem_item IS
  'produto = item de catálogo (movimenta estoque). avulso = descrição digitada, sem produto_id e sem estoque.';

CREATE INDEX IF NOT EXISTS ix_vendas_itens_empresa_origem
  ON public.vendas_itens (empresa_id, origem_item);

ALTER TABLE public.pdv_configuracoes
  ADD COLUMN IF NOT EXISTS permitir_item_avulso boolean NOT NULL DEFAULT true;

ALTER TABLE public.pdv_configuracoes
  ADD COLUMN IF NOT EXISTS produto_fiscal_padrao_item_avulso_id uuid
    REFERENCES public.produtos (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pdv_configuracoes.permitir_item_avulso IS
  'Se true, a empresa ativa pode vender item sem cadastro de produto. empresa_id da linha.';

COMMENT ON COLUMN public.pdv_configuracoes.produto_fiscal_padrao_item_avulso_id IS
  'Produto da MESMA empresa usado só como fonte fiscal/tributária do item avulso. Não substitui descrição, preço nem estoque.';

CREATE INDEX IF NOT EXISTS ix_pdv_configuracoes_produto_fiscal_avulso
  ON public.pdv_configuracoes (empresa_id, produto_fiscal_padrao_item_avulso_id)
  WHERE produto_fiscal_padrao_item_avulso_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pdv_assert_produto_fiscal_padrao_item_avulso()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_empresa uuid;
BEGIN
  IF NEW.produto_fiscal_padrao_item_avulso_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.empresa_id
  INTO v_empresa
  FROM public.produtos AS p
  WHERE p.id = NEW.produto_fiscal_padrao_item_avulso_id;

  IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION
      'O produto fiscal padrão para item avulso deve pertencer à empresa ativa.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pdv_assert_produto_fiscal_padrao_item_avulso
  ON public.pdv_configuracoes;

CREATE TRIGGER trg_pdv_assert_produto_fiscal_padrao_item_avulso
BEFORE INSERT OR UPDATE OF empresa_id, produto_fiscal_padrao_item_avulso_id
ON public.pdv_configuracoes
FOR EACH ROW
EXECUTE FUNCTION public.pdv_assert_produto_fiscal_padrao_item_avulso();

CREATE OR REPLACE FUNCTION public.vendas_item_payload_eh_avulso(p_item jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT lower(btrim(coalesce(
    p_item ->> 'origem',
    p_item ->> 'origem_item',
    ''
  ))) IN ('avulso', 'item_avulso');
$function$;

CREATE OR REPLACE FUNCTION public.pdv_fonte_fiscal_item_avulso(p_empresa_id uuid)
RETURNS TABLE (
  grupo_fiscal_id uuid,
  ncm text,
  cest text,
  origem_produto text,
  unidade_medida text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  v_produto_id uuid;
BEGIN
  SELECT c.produto_fiscal_padrao_item_avulso_id
  INTO v_produto_id
  FROM public.pdv_configuracoes AS c
  WHERE c.empresa_id = p_empresa_id;

  IF v_produto_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.grupo_fiscal_id,
    pf.ncm,
    pf.cest,
    pf.origem_produto,
    coalesce(NULLIF(btrim(p.unidade_medida), ''), 'UN')
  FROM public.produtos AS p
  LEFT JOIN public.produtos_fiscal AS pf
    ON pf.empresa_id = p_empresa_id
   AND pf.produto_id = p.id
  WHERE p.empresa_id = p_empresa_id
    AND p.id = v_produto_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vendas_resolver_item_avulso_interno(
  p_empresa_id uuid,
  p_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_permitir boolean := true;
  v_descricao text;
  v_qtd numeric;
  v_valor numeric;
  v_desconto numeric := 0;
  v_acrescimo numeric := 0;
  v_total numeric;
  v_fonte record;
BEGIN
  SELECT coalesce(c.permitir_item_avulso, true)
  INTO v_permitir
  FROM public.pdv_configuracoes AS c
  WHERE c.empresa_id = p_empresa_id;

  IF v_permitir IS NOT TRUE THEN
    RAISE EXCEPTION
      'A venda de item avulso não está permitida para esta empresa.';
  END IF;

  IF NULLIF(btrim(coalesce(p_item ->> 'produto_id', '')), '') IS NOT NULL THEN
    RAISE EXCEPTION
      'Item avulso não pode informar produto_id.';
  END IF;

  v_descricao := NULLIF(btrim(coalesce(
    p_item ->> 'descricao',
    p_item ->> 'produto_nome',
    ''
  )), '');

  IF v_descricao IS NULL THEN
    RAISE EXCEPTION 'Informe a descrição do item avulso.';
  END IF;

  BEGIN
    v_qtd := (p_item ->> 'quantidade')::numeric;
    v_valor := (p_item ->> 'valor_unitario')::numeric;
    v_desconto := coalesce((p_item ->> 'desconto')::numeric, 0);
    v_acrescimo := coalesce((p_item ->> 'acrescimo')::numeric, 0);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Item avulso inválido.';
  END;

  IF v_qtd IS NULL OR v_qtd <= 0 THEN
    RAISE EXCEPTION 'A quantidade do item avulso deve ser maior que zero.';
  END IF;

  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'O valor unitário do item avulso deve ser maior que zero.';
  END IF;

  IF v_desconto < 0 OR v_acrescimo < 0 THEN
    RAISE EXCEPTION 'Desconto/acréscimo inválido no item avulso.';
  END IF;

  v_total := round((v_qtd * v_valor) - v_desconto + v_acrescimo, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total inválido para o item avulso.';
  END IF;

  SELECT *
  INTO v_fonte
  FROM public.pdv_fonte_fiscal_item_avulso(p_empresa_id);

  RETURN jsonb_strip_nulls(
    jsonb_build_object(
      'origem_item', 'avulso',
      'produto_id', NULL,
      'produto_codigo', NULL,
      'produto_nome', v_descricao,
      'unidade_medida', coalesce(v_fonte.unidade_medida, 'UN'),
      'quantidade', v_qtd,
      'valor_unitario', v_valor,
      'desconto', v_desconto,
      'acrescimo', v_acrescimo,
      'valor_total', v_total,
      'grupo_fiscal_id', v_fonte.grupo_fiscal_id,
      'ncm', v_fonte.ncm,
      'cest', v_fonte.cest,
      'origem_produto', v_fonte.origem_produto
    )
  );
END;
$function$;

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
  v_permitir boolean := false;
BEGIN
  IF p_empresa_id IS NULL OR p_venda_id IS NULL THEN
    RAISE EXCEPTION
      'Empresa e venda são obrigatórios para baixa de estoque.';
  END IF;

  IF NULLIF(btrim(coalesce(p_origem, '')), '') IS NULL THEN
    RAISE EXCEPTION
      'Origem da baixa de estoque é obrigatória.';
  END IF;

  SELECT coalesce(c.permitir_venda_sem_estoque, false)
  INTO v_permitir
  FROM public.pdv_configuracoes AS c
  WHERE c.empresa_id = p_empresa_id;

  v_permitir := coalesce(v_permitir, false);

  FOR v_item IN
    SELECT
      vi.produto_id,
      SUM(vi.quantidade)::numeric AS quantidade,
      MIN(vi.produto_nome) AS produto_nome
    FROM public.vendas_itens AS vi
    WHERE vi.empresa_id = p_empresa_id
      AND vi.venda_id = p_venda_id
      AND vi.produto_id IS NOT NULL
      AND coalesce(vi.origem_item, 'produto') <> 'avulso'
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

    IF v_permitir IS NOT TRUE AND v_saldo_anterior < v_item.quantidade THEN
      RAISE EXCEPTION
        'Estoque insuficiente para este produto. Disponível: %.',
        v_saldo_anterior;
    END IF;

    v_saldo_posterior :=
      v_saldo_anterior - v_item.quantidade;

    UPDATE public.estoque_atual
    SET
      quantidade = v_saldo_posterior,
      updated_at = now()
    WHERE id = v_estoque.id
      AND empresa_id = p_empresa_id;

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
END;
$function$;

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
      AND vi.produto_id IS NOT NULL
      AND coalesce(vi.origem_item, 'produto') <> 'avulso'
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

  produtos_afetados := v_produtos;
  quantidade_total := v_quantidade;
  RETURN NEXT;
END;
$function$;

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
      vi.produto_nome,
      coalesce(vi.origem_item, 'produto') AS origem_item
    FROM public.vendas_itens AS vi
    WHERE vi.empresa_id = p_empresa_id
      AND vi.venda_id = p_venda_id
      AND vi.id = ANY (p_venda_item_ids)
    ORDER BY vi.id
    FOR UPDATE
  LOOP
    IF v_item.produto_id IS NULL
       OR v_item.origem_item = 'avulso' THEN
      CONTINUE;
    END IF;

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

  produtos_afetados := v_produtos;
  quantidade_total := v_quantidade;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalizar_venda_comercial_com_avulsos_interno(
  p_empresa_id uuid,
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
  v_item jsonb;
  v_resolvido jsonb;
  v_resolvidos jsonb := '[]'::jsonb;
  v_produto record;
  v_qtd numeric;
  v_produto_id uuid;
  v_valor_unitario numeric;
  v_total_item numeric;
  v_valor_produtos numeric := 0;
  v_desconto numeric := 0;
  v_acrescimo numeric := 0;
  v_frete numeric := 0;
  v_troco numeric := 0;
  v_total_venda numeric := 0;
  v_pagamento jsonb;
  v_forma record;
  v_forma_id uuid;
  v_valor_pagamento numeric;
  v_total_pagamentos numeric := 0;
  v_parcelas integer;
  v_indicador text;
  v_tem_troco boolean := false;
  v_venda_id uuid;
  v_numero bigint;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_desconto := coalesce(p_desconto, 0);
  v_acrescimo := coalesce(p_acrescimo, 0);
  v_frete := coalesce(p_frete, 0);
  v_troco := coalesce(p_troco, 0);

  IF v_desconto < 0 OR v_acrescimo < 0 OR v_frete < 0 OR v_troco < 0 THEN
    RAISE EXCEPTION 'Valores da venda inválidos.';
  END IF;

  IF coalesce(jsonb_typeof(p_itens), '') <> 'array'
     OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'A venda deve possuir ao menos um item.';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_itens)
  LOOP
    IF public.vendas_item_payload_eh_avulso(v_item) THEN
      v_resolvido := public.vendas_resolver_item_avulso_interno(
        p_empresa_id,
        v_item
      );
    ELSE
      BEGIN
        v_produto_id := (v_item ->> 'produto_id')::uuid;
        v_qtd := (v_item ->> 'quantidade')::numeric;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE EXCEPTION 'Item inválido na venda.';
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

      v_valor_unitario := coalesce(v_produto.preco_venda, 0);
      IF v_valor_unitario < 0 THEN
        RAISE EXCEPTION 'Preço inválido para o produto %.', v_produto.nome;
      END IF;

      v_total_item := round(v_qtd * v_valor_unitario, 2);
      v_resolvido := jsonb_build_object(
        'origem_item', 'produto',
        'produto_id', v_produto.id,
        'produto_codigo', v_produto.codigo,
        'produto_nome', v_produto.nome,
        'unidade_medida', coalesce(NULLIF(btrim(v_produto.unidade_medida), ''), 'UN'),
        'quantidade', v_qtd,
        'valor_unitario', v_valor_unitario,
        'desconto', 0,
        'acrescimo', 0,
        'valor_total', v_total_item,
        'grupo_fiscal_id', v_produto.grupo_fiscal_id,
        'ncm', v_produto.ncm,
        'cest', v_produto.cest,
        'origem_produto', v_produto.origem_produto
      );
    END IF;

    v_valor_produtos :=
      v_valor_produtos + (v_resolvido ->> 'valor_unitario')::numeric
        * (v_resolvido ->> 'quantidade')::numeric;
    v_resolvidos := v_resolvidos || jsonb_build_array(v_resolvido);
  END LOOP;

  v_valor_produtos := round(v_valor_produtos, 2);
  v_total_venda := round(
    v_valor_produtos - v_desconto + v_acrescimo + v_frete,
    2
  );

  IF v_total_venda <= 0 THEN
    RAISE EXCEPTION 'O total da venda deve ser maior que zero.';
  END IF;

  IF coalesce(jsonb_typeof(p_pagamentos), '') <> 'array'
     OR jsonb_array_length(p_pagamentos) = 0 THEN
    RAISE EXCEPTION 'A venda deve possuir ao menos um pagamento.';
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
        RAISE EXCEPTION 'Pagamento inválido.';
    END;

    SELECT fp.*
    INTO v_forma
    FROM public.formas_pagamento AS fp
    WHERE fp.empresa_id = p_empresa_id
      AND fp.id = v_forma_id
      AND fp.ativo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Forma de pagamento não encontrada ou inativa.';
    END IF;

    IF v_valor_pagamento IS NULL OR v_valor_pagamento <= 0 THEN
      RAISE EXCEPTION 'Valor do pagamento deve ser maior que zero.';
    END IF;

    IF v_parcelas < 1 THEN
      RAISE EXCEPTION 'Quantidade de parcelas inválida.';
    END IF;

    IF v_indicador NOT IN ('0', '1') THEN
      RAISE EXCEPTION 'Indicador de pagamento inválido.';
    END IF;

    IF v_forma.permite_troco THEN
      v_tem_troco := true;
    END IF;

    v_total_pagamentos := v_total_pagamentos + v_valor_pagamento;
  END LOOP;

  IF v_troco > 0 AND NOT v_tem_troco THEN
    RAISE EXCEPTION
      'Foi informado troco, mas nenhuma forma selecionada permite troco.';
  END IF;

  IF abs(v_total_pagamentos - (v_total_venda + v_troco)) > 0.01 THEN
    RAISE EXCEPTION
      'Pagamentos não conferem. Total da venda: %, troco: %, informado: %.',
      v_total_venda,
      v_troco,
      v_total_pagamentos;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_empresa_id::text));

  SELECT coalesce(max(v.numero), 0) + 1
  INTO v_numero
  FROM public.vendas AS v
  WHERE v.empresa_id = p_empresa_id;

  INSERT INTO public.vendas (
    empresa_id,
    cliente_id,
    usuario_id,
    tipo_venda,
    modelo_fiscal_intencao,
    valor_produtos,
    desconto,
    acrescimo,
    frete,
    valor_total,
    troco,
    observacao,
    status,
    finalizada_at,
    numero
  )
  VALUES (
    p_empresa_id,
    p_cliente_id,
    v_usuario_id,
    coalesce(NULLIF(btrim(p_tipo_venda), ''), 'balcao'),
    p_modelo_fiscal_intencao,
    v_valor_produtos,
    v_desconto,
    v_acrescimo,
    v_frete,
    v_total_venda,
    v_troco,
    p_observacao,
    'finalizada',
    now(),
    v_numero
  )
  RETURNING id
  INTO v_venda_id;

  FOR v_resolvido IN
    SELECT value
    FROM jsonb_array_elements(v_resolvidos)
  LOOP
    INSERT INTO public.vendas_itens (
      empresa_id,
      venda_id,
      origem_item,
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
      v_venda_id,
      coalesce(NULLIF(v_resolvido ->> 'origem_item', ''), 'produto'),
      NULLIF(v_resolvido ->> 'produto_id', '')::uuid,
      NULLIF(v_resolvido ->> 'produto_codigo', ''),
      v_resolvido ->> 'produto_nome',
      coalesce(NULLIF(v_resolvido ->> 'unidade_medida', ''), 'UN'),
      (v_resolvido ->> 'quantidade')::numeric,
      (v_resolvido ->> 'valor_unitario')::numeric,
      (v_resolvido ->> 'desconto')::numeric,
      (v_resolvido ->> 'acrescimo')::numeric,
      (v_resolvido ->> 'valor_total')::numeric,
      NULLIF(v_resolvido ->> 'grupo_fiscal_id', '')::uuid,
      NULLIF(v_resolvido ->> 'ncm', ''),
      NULLIF(v_resolvido ->> 'cest', ''),
      NULLIF(v_resolvido ->> 'origem_produto', '')
    );
  END LOOP;

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
      v_venda_id,
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
    AND v.id = v_venda_id;
END;
$function$;

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
  v_pagamentos_sanitizados jsonb := '[]'::jsonb;
  v_forma_id uuid;
  v_tem_fiado boolean := false;
  v_venda record;
  v_tem_avulso boolean := false;
BEGIN
  IF COALESCE(jsonb_typeof(p_itens), '') <> 'array' THEN
    RAISE EXCEPTION 'Itens da venda devem ser um array.';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_itens)
  LOOP
    IF public.vendas_item_payload_eh_avulso(v_item) THEN
      v_tem_avulso := true;
      v_itens_sanitizados :=
        v_itens_sanitizados
        || jsonb_build_array(
          v_item
          - 'empresa_id'
          - 'ncm'
          - 'cest'
          - 'grupo_fiscal_id'
          - 'snapshot_fiscal'
          - 'cfop'
          - 'icms_cst_csosn'
          - 'pis_cst'
          - 'cofins_cst'
          - 'cst_ibscbs'
        );
    ELSE
      v_itens_sanitizados :=
        v_itens_sanitizados || jsonb_build_array(v_item - 'valor_unitario');
    END IF;
  END LOOP;

  IF COALESCE(jsonb_typeof(p_pagamentos), '') <> 'array' THEN
    RAISE EXCEPTION 'Pagamentos da venda devem ser um array.';
  END IF;

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(p_pagamentos)
  LOOP
    BEGIN
      v_forma_id :=
        NULLIF(btrim(v_pagamento ->> 'forma_pagamento_id'), '')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'forma_pagamento_id inválido.';
    END;

    IF v_forma_id IS NULL THEN
      RAISE EXCEPTION 'forma_pagamento_id é obrigatório.';
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

    v_pagamentos_sanitizados :=
      v_pagamentos_sanitizados
      || jsonb_build_array(
        v_pagamento
        - 'pix_local_recebimento_id'
        - 'pix_geranet_cobranca_id'
      );
  END LOOP;

  IF v_tem_fiado AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Pagamento fiado exige cliente.';
  END IF;

  PERFORM public.pix_local_validar_na_finalizacao(
    p_empresa_id,
    p_pagamentos,
    NULL
  );

  PERFORM public.pix_geranet_validar_na_finalizacao(
    p_empresa_id,
    p_pagamentos,
    NULL
  );

  IF v_tem_avulso THEN
    SELECT *
    INTO v_venda
    FROM public.finalizar_venda_comercial_com_avulsos_interno(
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
      v_pagamentos_sanitizados
    );
  ELSE
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
      v_pagamentos_sanitizados
    );
  END IF;

  IF v_venda.venda_id IS NULL THEN
    RAISE EXCEPTION 'A finalização comercial não retornou a venda.';
  END IF;

  PERFORM public.estoque_baixar_composicao_venda_interno(
    p_empresa_id,
    v_venda.venda_id,
    auth.uid(),
    'VENDA',
    concat(
      'Baixa de estoque da venda nº ',
      coalesce(v_venda.numero::text, v_venda.venda_id::text),
      '.'
    )
  );

  IF v_tem_fiado THEN
    PERFORM public.carteira_criar_debito_venda_interno(
      p_empresa_id,
      v_venda.venda_id
    );
  END IF;

  PERFORM public.pix_local_vincular_na_finalizacao(
    p_empresa_id,
    v_venda.venda_id,
    p_pagamentos
  );

  PERFORM public.pix_geranet_vincular_na_finalizacao(
    p_empresa_id,
    v_venda.venda_id,
    p_pagamentos
  );

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

CREATE OR REPLACE FUNCTION public.rpc_definir_pdv_item_avulso(
  p_permitir boolean,
  p_produto_fiscal_padrao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_permitir boolean := COALESCE(p_permitir, true);
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT ue.empresa_id
  INTO v_empresa_id
  FROM public.usuarios_empresas AS ue
  WHERE ue.usuario_id = v_usuario_id
    AND ue.principal = true
    AND ue.ativo = true;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa ativa não encontrada.';
  END IF;

  IF NOT public.tem_acesso_empresa(v_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  IF p_produto_fiscal_padrao_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.produtos AS p
       WHERE p.empresa_id = v_empresa_id
         AND p.id = p_produto_fiscal_padrao_id
     ) THEN
    RAISE EXCEPTION
      'O produto fiscal padrão para item avulso deve pertencer à empresa ativa.';
  END IF;

  INSERT INTO public.pdv_configuracoes (
    empresa_id,
    permitir_item_avulso,
    produto_fiscal_padrao_item_avulso_id,
    updated_at
  )
  VALUES (
    v_empresa_id,
    v_permitir,
    p_produto_fiscal_padrao_id,
    now()
  )
  ON CONFLICT (empresa_id) DO UPDATE
  SET
    permitir_item_avulso = EXCLUDED.permitir_item_avulso,
    produto_fiscal_padrao_item_avulso_id =
      EXCLUDED.produto_fiscal_padrao_item_avulso_id,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'permitir_item_avulso', v_permitir,
    'produto_fiscal_padrao_item_avulso_id', p_produto_fiscal_padrao_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_definir_pdv_item_avulso(boolean, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_definir_pdv_item_avulso(boolean, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_definir_pdv_item_avulso(boolean, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.vendas_item_payload_eh_avulso(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendas_item_payload_eh_avulso(jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.pdv_fonte_fiscal_item_avulso(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pdv_fonte_fiscal_item_avulso(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.vendas_resolver_item_avulso_interno(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendas_resolver_item_avulso_interno(uuid, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalizar_venda_comercial_com_avulsos_interno(
  uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_venda_comercial_com_avulsos_interno(
  uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.estoque_baixar_composicao_venda_interno(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estoque_baixar_composicao_venda_interno(uuid, uuid, uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.estoque_estornar_composicao_venda_interno(uuid, uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.estoque_estornar_itens_venda_interno(uuid, uuid, uuid, uuid[], text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.rpc_definir_pdv_item_avulso(boolean, uuid) IS
  'Define item avulso da empresa ativa. empresa_id vem da sessão, nunca do cliente.';

NOTIFY pgrst, 'reload schema';

COMMIT;
