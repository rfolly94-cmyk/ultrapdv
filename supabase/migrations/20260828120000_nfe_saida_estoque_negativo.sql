BEGIN;

-- NF-e: a baixa posterior (bonificação/transferência) não bloqueia
-- por falta de saldo. O estoque pode ficar negativo.
-- Não altera o motor do PDV nem a NFC-e.

CREATE OR REPLACE FUNCTION public.rpc_confirmar_saida_operacao_fiscal(
  p_empresa_id uuid,
  p_operacao_id uuid
)
RETURNS TABLE (
  operacao_id uuid,
  status text,
  itens_movimentados integer,
  quantidade_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid;
  v_op public.fiscal_operacoes%ROWTYPE;
  v_emissao_status text;
  v_item record;
  v_anterior numeric(14,4);
  v_atual numeric(14,4);
  v_movimentados integer := 0;
  v_quantidade numeric(14,4) := 0;
  v_tipo_mov text;
  v_status_final text;
BEGIN
  v_usuario := auth.uid();
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;
  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  SELECT o.*
    INTO v_op
  FROM public.fiscal_operacoes o
  WHERE o.id = p_operacao_id
    AND o.empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operação fiscal não encontrada nesta empresa.';
  END IF;

  IF v_op.saida_estoque_processada_at IS NOT NULL
     OR v_op.status IN ('em_transito', 'recebida', 'concluida') THEN
    RETURN QUERY
    SELECT
      p_operacao_id,
      v_op.status,
      0::integer,
      0::numeric;
    RETURN;
  END IF;

  IF v_op.status = 'cancelada' THEN
    RAISE EXCEPTION 'Operação fiscal cancelada.';
  END IF;

  IF v_op.emissao_fiscal_id IS NULL THEN
    RAISE EXCEPTION 'A NF-e ainda não foi emitida.';
  END IF;

  SELECT e.status INTO v_emissao_status
  FROM public.fiscal_emissoes e
  WHERE e.id = v_op.emissao_fiscal_id
    AND e.empresa_id = p_empresa_id;

  IF v_emissao_status IS DISTINCT FROM 'autorizada' THEN
    RAISE EXCEPTION 'A saída só pode ser confirmada depois que a NF-e estiver autorizada.';
  END IF;

  IF v_op.tipo_operacao_interno = 'bonificacao' THEN
    v_tipo_mov := 'BONIFICACAO_SAIDA';
    v_status_final := 'concluida';
  ELSIF v_op.tipo_operacao_interno = 'transferencia' THEN
    v_tipo_mov := 'TRANSFERENCIA_SAIDA';
    IF v_op.destino_gerenciado_no_ultra THEN
      v_status_final := 'em_transito';
    ELSE
      v_status_final := 'concluida';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de operação sem saída de estoque nesta etapa.';
  END IF;

  FOR v_item IN
    SELECT i.*
    FROM public.fiscal_operacoes_itens i
    WHERE i.empresa_id = p_empresa_id
      AND i.operacao_id = p_operacao_id
    ORDER BY i.created_at
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.estoque_movimentacoes em
      WHERE em.empresa_id = p_empresa_id
        AND em.fiscal_operacao_item_id = v_item.id
        AND em.tipo IN ('BONIFICACAO_SAIDA', 'TRANSFERENCIA_SAIDA')
    ) THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.produtos p
      WHERE p.id = v_item.produto_id
        AND p.empresa_id = p_empresa_id
    ) THEN
      RAISE EXCEPTION 'Produto da operação não pertence à empresa ativa.';
    END IF;

    INSERT INTO public.estoque_atual (empresa_id, produto_id, quantidade, estoque_minimo)
    VALUES (p_empresa_id, v_item.produto_id, 0, 0)
    ON CONFLICT (empresa_id, produto_id) DO NOTHING;

    SELECT ea.quantidade
      INTO v_anterior
    FROM public.estoque_atual ea
    WHERE ea.empresa_id = p_empresa_id
      AND ea.produto_id = v_item.produto_id
    FOR UPDATE;

    IF v_anterior IS NULL THEN
      RAISE EXCEPTION 'Estoque do produto não encontrado.';
    END IF;

    -- Saldo insuficiente não impede a NF-e. Resultado pode ser negativo.
    v_atual := v_anterior - v_item.quantidade;

    UPDATE public.estoque_atual
    SET quantidade = v_atual
    WHERE empresa_id = p_empresa_id
      AND produto_id = v_item.produto_id;

    INSERT INTO public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao,
      fiscal_operacao_id,
      fiscal_operacao_item_id
    )
    VALUES (
      p_empresa_id,
      v_item.produto_id,
      v_usuario,
      v_tipo_mov,
      'NFE_OPERACAO_FISCAL',
      v_item.quantidade,
      v_anterior,
      v_atual,
      CASE
        WHEN v_tipo_mov = 'BONIFICACAO_SAIDA' THEN 'Saída por bonificação'
        ELSE 'Saída por transferência'
      END,
      p_operacao_id,
      v_item.id
    );

    v_movimentados := v_movimentados + 1;
    v_quantidade := v_quantidade + v_item.quantidade;
  END LOOP;

  IF v_movimentados = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.estoque_movimentacoes em
       WHERE em.empresa_id = p_empresa_id
         AND em.fiscal_operacao_id = p_operacao_id
         AND em.tipo IN ('BONIFICACAO_SAIDA', 'TRANSFERENCIA_SAIDA')
     ) THEN
    RAISE EXCEPTION 'A operação não possui itens para saída de estoque.';
  END IF;

  UPDATE public.fiscal_operacoes AS o
  SET
    status = v_status_final,
    saida_estoque_processada_at = coalesce(o.saida_estoque_processada_at, now()),
    saida_estoque_processada_por = coalesce(o.saida_estoque_processada_por, v_usuario)
  WHERE o.id = p_operacao_id
    AND o.empresa_id = p_empresa_id;

  RETURN QUERY
  SELECT
    p_operacao_id,
    v_status_final,
    v_movimentados,
    v_quantidade;
END;
$$;

COMMENT ON FUNCTION public.rpc_confirmar_saida_operacao_fiscal(uuid, uuid) IS
  'Confirma saída de estoque da NF-e (bonificação/transferência). Permite saldo negativo. Não cria estoque artificial nem altera a quantidade da operação.';

REVOKE ALL ON FUNCTION public.rpc_confirmar_saida_operacao_fiscal(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_confirmar_saida_operacao_fiscal(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_confirmar_saida_operacao_fiscal(uuid, uuid)
  TO service_role;

COMMIT;
