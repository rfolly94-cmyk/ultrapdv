BEGIN;

-- ============================================================
-- UltraPDV — Correção de ambiguidade nas RPCs de estoque
-- Data: 2026-08-13
--
-- Corrige:
--   column reference "produto_id" is ambiguous
--
-- Motivo:
-- RETURNS TABLE cria variáveis PL/pgSQL com os mesmos nomes
-- das colunas retornadas. Referências não qualificadas a
-- produto_id/empresa_id dentro da função podem ficar ambíguas.
-- ============================================================


CREATE OR REPLACE FUNCTION public.rpc_movimentar_estoque_produto(
  p_empresa_id uuid,
  p_produto_id uuid,
  p_operacao text,
  p_quantidade numeric,
  p_observacao text DEFAULT NULL
)
RETURNS TABLE (
  produto_id uuid,
  quantidade_anterior numeric,
  quantidade_atual numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id uuid;
  v_operacao text;
  v_anterior numeric(14,4);
  v_atual numeric(14,4);
  v_movimento numeric(14,4);
  v_tipo text;
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  IF NOT public.eh_admin_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Somente administrador pode ajustar estoque manualmente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.produtos AS p
    WHERE p.id = p_produto_id
      AND p.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado na empresa.';
  END IF;

  v_operacao := upper(btrim(COALESCE(p_operacao, '')));

  IF v_operacao NOT IN ('ENTRADA', 'SAIDA', 'AJUSTE') THEN
    RAISE EXCEPTION 'Operação de estoque inválida.';
  END IF;

  IF p_quantidade IS NULL THEN
    RAISE EXCEPTION 'Quantidade é obrigatória.';
  END IF;

  IF v_operacao IN ('ENTRADA', 'SAIDA')
     AND p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  IF v_operacao = 'AJUSTE'
     AND p_quantidade < 0 THEN
    RAISE EXCEPTION 'Novo saldo não pode ser negativo.';
  END IF;

  INSERT INTO public.estoque_atual (
    empresa_id,
    produto_id,
    quantidade,
    estoque_minimo
  )
  VALUES (
    p_empresa_id,
    p_produto_id,
    0,
    0
  )
  ON CONFLICT ON CONSTRAINT estoque_atual_empresa_produto_key
  DO NOTHING;

  SELECT ea.quantidade
  INTO v_anterior
  FROM public.estoque_atual AS ea
  WHERE ea.empresa_id = p_empresa_id
    AND ea.produto_id = p_produto_id
  FOR UPDATE;

  IF v_operacao = 'ENTRADA' THEN
    v_atual := v_anterior + p_quantidade;
    v_movimento := p_quantidade;
    v_tipo := 'ENTRADA';

  ELSIF v_operacao = 'SAIDA' THEN
    IF p_quantidade > v_anterior THEN
      RAISE EXCEPTION
        'Estoque insuficiente. Saldo atual: %.',
        v_anterior;
    END IF;

    v_atual := v_anterior - p_quantidade;
    v_movimento := p_quantidade;
    v_tipo := 'SAIDA';

  ELSE
    v_atual := p_quantidade;

    IF v_atual = v_anterior THEN
      RETURN QUERY
      SELECT
        p_produto_id,
        v_anterior,
        v_atual;

      RETURN;
    END IF;

    v_movimento := abs(v_atual - v_anterior);

    IF v_atual > v_anterior THEN
      v_tipo := 'AJUSTE_POSITIVO';
    ELSE
      v_tipo := 'AJUSTE_NEGATIVO';
    END IF;
  END IF;

  UPDATE public.estoque_atual AS ea
  SET quantidade = v_atual
  WHERE ea.empresa_id = p_empresa_id
    AND ea.produto_id = p_produto_id;

  INSERT INTO public.estoque_movimentacoes (
    empresa_id,
    produto_id,
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
    p_produto_id,
    v_usuario_id,
    v_tipo,
    'AJUSTE_MANUAL',
    v_movimento,
    v_anterior,
    v_atual,
    NULLIF(
      btrim(
        COALESCE(p_observacao, '')
      ),
      ''
    )
  );

  RETURN QUERY
  SELECT
    p_produto_id,
    v_anterior,
    v_atual;
END;
$$;

REVOKE ALL
ON FUNCTION public.rpc_movimentar_estoque_produto(
  uuid,
  uuid,
  text,
  numeric,
  text
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.rpc_movimentar_estoque_produto(
  uuid,
  uuid,
  text,
  numeric,
  text
)
TO authenticated;


CREATE OR REPLACE FUNCTION public.rpc_atualizar_limites_estoque_produto(
  p_empresa_id uuid,
  p_produto_id uuid,
  p_estoque_minimo numeric,
  p_estoque_maximo numeric DEFAULT NULL
)
RETURNS TABLE (
  produto_id uuid,
  estoque_minimo numeric,
  estoque_maximo numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  IF NOT public.eh_admin_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Somente administrador pode alterar limites de estoque.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.produtos AS p
    WHERE p.id = p_produto_id
      AND p.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado na empresa.';
  END IF;

  IF p_estoque_minimo IS NULL
     OR p_estoque_minimo < 0 THEN
    RAISE EXCEPTION 'Estoque mínimo inválido.';
  END IF;

  IF p_estoque_maximo IS NOT NULL
     AND p_estoque_maximo < p_estoque_minimo THEN
    RAISE EXCEPTION 'Estoque máximo não pode ser menor que o mínimo.';
  END IF;

  INSERT INTO public.estoque_atual (
    empresa_id,
    produto_id,
    quantidade,
    estoque_minimo,
    estoque_maximo
  )
  VALUES (
    p_empresa_id,
    p_produto_id,
    0,
    p_estoque_minimo,
    p_estoque_maximo
  )
  ON CONFLICT ON CONSTRAINT estoque_atual_empresa_produto_key
  DO UPDATE
  SET
    estoque_minimo = EXCLUDED.estoque_minimo,
    estoque_maximo = EXCLUDED.estoque_maximo;

  RETURN QUERY
  SELECT
    ea.produto_id,
    ea.estoque_minimo,
    ea.estoque_maximo
  FROM public.estoque_atual AS ea
  WHERE ea.empresa_id = p_empresa_id
    AND ea.produto_id = p_produto_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.rpc_atualizar_limites_estoque_produto(
  uuid,
  uuid,
  numeric,
  numeric
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.rpc_atualizar_limites_estoque_produto(
  uuid,
  uuid,
  numeric,
  numeric
)
TO authenticated;

COMMIT;
