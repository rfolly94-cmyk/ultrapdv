BEGIN;

-- ============================================================
-- UltraPDV — Cadastro transacional de produto
-- Data: 2026-08-15
--
-- INSERT em produtos + trigger de produtos_fiscal +
-- trigger de estoque_atual (saldo 0) + movimentação oficial
-- quando estoque_inicial > 0.
--
-- Não duplica a regra de estoque: chama
-- public.rpc_movimentar_estoque_produto e só ajusta a origem
-- para ESTOQUE_INICIAL na mesma transação.
--
-- Qualquer erro faz rollback de tudo.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'produtos'
      AND column_name = 'categoria_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.produtos
      ALTER COLUMN categoria_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'produtos'
      AND column_name = 'marca_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.produtos
      ALTER COLUMN marca_id DROP NOT NULL;
  END IF;
END
$$;


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
AS $$
DECLARE
  v_usuario_id uuid;
  v_codigo text;
  v_nome text;
  v_unidade text;
  v_estoque numeric(14,4);
  v_produto_id uuid;
  v_quantidade numeric(14,4);
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  v_codigo := btrim(COALESCE(p_codigo, ''));
  v_nome := btrim(COALESCE(p_nome, ''));
  v_unidade := upper(btrim(COALESCE(p_unidade_medida, 'UN')));
  v_estoque := COALESCE(p_estoque_inicial, 0);

  IF v_codigo = '' THEN
    RAISE EXCEPTION 'Informe o código do produto.';
  END IF;

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
$$;

REVOKE ALL
ON FUNCTION public.rpc_cadastrar_produto(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.rpc_cadastrar_produto(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric
)
TO authenticated;

COMMIT;
