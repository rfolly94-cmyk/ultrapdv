BEGIN;

-- ============================================================
-- UltraPDV — Código automático de produto por empresa
-- Data: 2026-08-16
--
-- Sequência numérica por empresa_id, com lock transacional.
-- Não altera códigos existentes.
-- UNIQUE (empresa_id, codigo) já existe:
--   produtos_codigo_empresa_unique
-- ============================================================

CREATE OR REPLACE FUNCTION public.gerar_proximo_codigo_produto(
  p_empresa_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_maximo bigint;
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_id é obrigatório';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('produtos_codigo'),
    hashtext(p_empresa_id::text)
  );

  SELECT COALESCE(MAX(p.codigo::bigint), 0)
  INTO v_maximo
  FROM public.produtos AS p
  WHERE p.empresa_id = p_empresa_id
    AND p.codigo ~ '^[0-9]+$'
    AND char_length(p.codigo) <= 18;

  RETURN (COALESCE(v_maximo, 0) + 1)::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.gerar_proximo_codigo_produto(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.rpc_cadastrar_produto(
  p_empresa_id uuid,
  p_codigo text,
  p_codigo_barras text DEFAULT NULL,
  p_nome text DEFAULT NULL,
  p_descricao text DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL,
  p_marca_id uuid DEFAULT NULL,
  p_grupo_fiscal_id uuid DEFAULT NULL,
  p_unidade_medida text DEFAULT 'UN',
  p_preco_custo numeric DEFAULT 0,
  p_preco_venda numeric DEFAULT 0,
  p_estoque_inicial numeric DEFAULT 0
)
RETURNS TABLE (
  produto_id uuid,
  codigo text,
  quantidade_atual numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_usuario_id uuid;
  v_codigo text;
  v_nome text;
  v_unidade text;
  v_estoque numeric(14,4);
  v_produto_id uuid;
  v_quantidade numeric(14,4);
  v_auto boolean;
  v_tentativa integer;
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  v_codigo := btrim(COALESCE(p_codigo, ''));
  v_auto := v_codigo = '';
  v_nome := btrim(COALESCE(p_nome, ''));
  v_unidade := upper(btrim(COALESCE(p_unidade_medida, 'UN')));
  v_estoque := COALESCE(p_estoque_inicial, 0);

  IF char_length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Informe o nome do produto.';
  END IF;

  IF v_unidade = '' THEN
    RAISE EXCEPTION 'Informe a unidade de medida.';
  END IF;

  IF COALESCE(p_preco_custo, 0) < 0
     OR COALESCE(p_preco_venda, 0) < 0 THEN
    RAISE EXCEPTION 'Os preços não podem ser negativos.';
  END IF;

  IF v_estoque < 0 THEN
    RAISE EXCEPTION 'O estoque inicial não pode ser negativo.';
  END IF;

  IF v_estoque > 0
     AND NOT public.eh_admin_empresa(p_empresa_id) THEN
    RAISE EXCEPTION
      'Somente administrador pode informar estoque inicial.';
  END IF;

  IF p_categoria_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.categorias AS c
       WHERE c.id = p_categoria_id
         AND c.empresa_id = p_empresa_id
         AND c.ativo = true
     ) THEN
    RAISE EXCEPTION 'Categoria inválida ou inativa.';
  END IF;

  IF p_marca_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.marcas AS m
       WHERE m.id = p_marca_id
         AND m.empresa_id = p_empresa_id
         AND m.ativo = true
     ) THEN
    RAISE EXCEPTION 'Marca inválida ou inativa.';
  END IF;

  IF p_grupo_fiscal_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.grupos_fiscais AS g
       WHERE g.id = p_grupo_fiscal_id
         AND g.empresa_id = p_empresa_id
         AND g.ativo = true
     ) THEN
    RAISE EXCEPTION 'Grupo fiscal inválido ou inativo.';
  END IF;

  FOR v_tentativa IN 1..8 LOOP
    BEGIN
      IF v_auto THEN
        v_codigo := public.gerar_proximo_codigo_produto(p_empresa_id);
      END IF;

      IF v_codigo IS NULL OR btrim(v_codigo) = '' THEN
        RAISE EXCEPTION
          'Não foi possível gerar o código automático do produto.';
      END IF;

      INSERT INTO public.produtos (
        empresa_id,
        codigo,
        codigo_barras,
        nome,
        descricao,
        categoria_id,
        marca_id,
        grupo_fiscal_id,
        unidade_medida,
        tipo_item,
        preco_custo,
        preco_venda,
        ativo
      )
      VALUES (
        p_empresa_id,
        v_codigo,
        NULLIF(btrim(COALESCE(p_codigo_barras, '')), ''),
        v_nome,
        NULLIF(btrim(COALESCE(p_descricao, '')), ''),
        p_categoria_id,
        p_marca_id,
        p_grupo_fiscal_id,
        v_unidade,
        '00',
        COALESCE(p_preco_custo, 0),
        COALESCE(p_preco_venda, 0),
        true
      )
      RETURNING id INTO v_produto_id;

      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF NOT v_auto OR v_tentativa = 8 THEN
          RAISE EXCEPTION
            'Já existe um produto com o código % nesta empresa.',
            v_codigo;
        END IF;
    END;
  END LOOP;

  IF v_produto_id IS NULL THEN
    RAISE EXCEPTION
      'Não foi possível gerar o código automático do produto.';
  END IF;

  IF v_estoque > 0 THEN
    PERFORM 1
    FROM public.rpc_movimentar_estoque_produto(
      p_empresa_id,
      v_produto_id,
      'ENTRADA',
      v_estoque,
      'Estoque inicial no cadastro do produto'
    );

    UPDATE public.estoque_movimentacoes AS em
    SET origem = 'ESTOQUE_INICIAL'
    WHERE em.empresa_id = p_empresa_id
      AND em.produto_id = v_produto_id
      AND em.origem = 'AJUSTE_MANUAL'
      AND em.observacao =
        'Estoque inicial no cadastro do produto';
  END IF;

  SELECT ea.quantidade
  INTO v_quantidade
  FROM public.estoque_atual AS ea
  WHERE ea.empresa_id = p_empresa_id
    AND ea.produto_id = v_produto_id;

  RETURN QUERY
  SELECT
    v_produto_id,
    v_codigo,
    COALESCE(v_quantidade, 0);
END;
$function$;

COMMIT;
