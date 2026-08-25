BEGIN;

-- UltraPDV — Fase 2A: vendas do PDV web no caixa aberto.
-- Não altera rpc_finalizar_venda (idempotência). Wrapper transacional
-- trava a sessão, finaliza e lança os movimentos no mesmo commit.
-- Mobile / NF-e continuam em rpc_finalizar_venda.

-- ------------------------------------------------------------
-- tipo=venda no livro
-- ------------------------------------------------------------

ALTER TABLE public.caixa_movimentacoes
  DROP CONSTRAINT IF EXISTS caixa_movimentacoes_tipo_check;

ALTER TABLE public.caixa_movimentacoes
  ADD CONSTRAINT caixa_movimentacoes_tipo_check CHECK (
    tipo = ANY (
      ARRAY['abertura', 'suprimento', 'sangria', 'ajuste', 'venda']::text[]
    )
  );

COMMENT ON COLUMN public.caixa_movimentacoes.tipo IS
  'abertura, suprimento, sangria, ajuste ou venda. venda = recebimento de vendas_pagamentos.';

COMMENT ON COLUMN public.caixa_movimentacoes.origem_tipo IS
  'Para venda: origem_tipo=venda e origem_id=vendas_pagamentos.id (chave idempotente do pagamento). venda_id fica no snapshot do movimento.';

-- Uma linha de pagamento nunca gera dois movimentos (retry / duplo clique).
CREATE UNIQUE INDEX IF NOT EXISTS ux_caixa_movimentacoes_origem_pagamento
  ON public.caixa_movimentacoes (empresa_id, origem_tipo, origem_id)
  WHERE origem_tipo = 'venda'
    AND origem_id IS NOT NULL;

ALTER TABLE public.caixa_movimentacoes
  ADD COLUMN IF NOT EXISTS forma_tipo text,
  ADD COLUMN IF NOT EXISTS forma_codigo text,
  ADD COLUMN IF NOT EXISTS forma_nome text,
  ADD COLUMN IF NOT EXISTS venda_id uuid,
  ADD COLUMN IF NOT EXISTS venda_numero bigint,
  ADD COLUMN IF NOT EXISTS cliente_nome text;

COMMENT ON COLUMN public.caixa_movimentacoes.forma_tipo IS
  'Snapshot da forma no momento do lançamento. Histórico não relê o cadastro atual.';
COMMENT ON COLUMN public.caixa_movimentacoes.venda_id IS
  'Venda de origem. origem_id continua sendo vendas_pagamentos.id para não colidir em pagamento misto.';

-- ------------------------------------------------------------
-- Saldo físico: só dinheiro (abertura/suprimento/sangria e venda em dinheiro)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.caixa_forma_eh_dinheiro(
  p_empresa_id uuid,
  p_forma_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.formas_pagamento AS fp
    WHERE fp.empresa_id = p_empresa_id
      AND fp.id = p_forma_id
      AND (
        upper(btrim(COALESCE(fp.tipo, ''))) = 'DINHEIRO'
        OR upper(btrim(COALESCE(fp.codigo, ''))) IN ('DINHEIRO', '01')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.caixa_saldo_dinheiro(
  p_empresa_id uuid,
  p_caixa_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(m.entrada) - SUM(m.saida), 0)::numeric(14, 2)
  FROM public.caixa_movimentacoes AS m
  WHERE m.empresa_id = p_empresa_id
    AND m.caixa_id = p_caixa_id
    AND (
      m.tipo IN ('abertura', 'suprimento', 'sangria')
      OR upper(btrim(COALESCE(m.forma_tipo, ''))) = 'DINHEIRO'
      OR upper(btrim(COALESCE(m.forma_codigo, ''))) IN ('DINHEIRO', '01')
      OR (
        m.forma_tipo IS NULL
        AND m.forma_codigo IS NULL
        AND public.caixa_forma_eh_dinheiro(m.empresa_id, m.forma_pagamento_id)
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.caixa_forma_eh_dinheiro(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_forma_eh_dinheiro(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.caixa_saldo_dinheiro(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_saldo_dinheiro(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- Wrapper: caixa aberto + rpc_finalizar_venda + movimentos
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_finalizar_venda_com_caixa(
  p_empresa_id uuid,
  p_idempotency_key uuid,
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
  valor_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_caixa public.caixas%ROWTYPE;
  v_fin record;
  v_venda_id uuid;
  v_numero bigint;
  v_valor_total numeric;
  v_troco_restante numeric(14, 2);
  v_pag record;
  v_entrada numeric(14, 2);
  v_descricao text;
  v_cliente_nome text;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'Empresa da sessão não confere.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('caixa-venda:' || v_empresa_id::text));

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.status = 'aberto'
    AND c.filial_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O caixa foi fechado. Abra um caixa para continuar.';
  END IF;

  SELECT f.*
  INTO v_fin
  FROM public.rpc_finalizar_venda(
    p_empresa_id => p_empresa_id,
    p_idempotency_key => p_idempotency_key,
    p_cliente_id => p_cliente_id,
    p_tipo_venda => p_tipo_venda,
    p_modelo_fiscal_intencao => p_modelo_fiscal_intencao,
    p_desconto => p_desconto,
    p_acrescimo => p_acrescimo,
    p_frete => p_frete,
    p_troco => p_troco,
    p_observacao => p_observacao,
    p_itens => p_itens,
    p_pagamentos => p_pagamentos
  ) AS f
  LIMIT 1;

  IF v_fin.venda_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível finalizar a venda.';
  END IF;

  v_venda_id := v_fin.venda_id;
  v_numero := v_fin.numero;
  v_valor_total := v_fin.valor_total;
  v_descricao := 'Venda #' || COALESCE(v_numero::text, '');

  SELECT COALESCE(v.troco, 0)
  INTO v_troco_restante
  FROM public.vendas AS v
  WHERE v.empresa_id = v_empresa_id
    AND v.id = v_venda_id;

  v_troco_restante := COALESCE(v_troco_restante, 0);

  SELECT NULLIF(btrim(c.nome), '')
  INTO v_cliente_nome
  FROM public.vendas AS v
  LEFT JOIN public.clientes AS c
    ON c.empresa_id = v.empresa_id
   AND c.id = v.cliente_id
  WHERE v.empresa_id = v_empresa_id
    AND v.id = v_venda_id;

  FOR v_pag IN
    SELECT
      vp.id,
      vp.forma_pagamento_id,
      vp.valor,
      fp.permite_fiado,
      fp.permite_troco,
      fp.tipo,
      fp.codigo,
      fp.nome
    FROM public.vendas_pagamentos AS vp
    JOIN public.formas_pagamento AS fp
      ON fp.empresa_id = vp.empresa_id
     AND fp.id = vp.forma_pagamento_id
    WHERE vp.empresa_id = v_empresa_id
      AND vp.venda_id = v_venda_id
      AND vp.status = 'confirmado'
    ORDER BY
      CASE WHEN COALESCE(fp.permite_troco, false) THEN 0 ELSE 1 END,
      vp.id
  LOOP
    -- Fiado / carteira: não gera entrada de caixa nesta fase.
    -- movimenta_caixa NÃO significa gaveta: PIX/cartão também são true.
    IF COALESCE(v_pag.permite_fiado, false) THEN
      CONTINUE;
    END IF;

    v_entrada := round(COALESCE(v_pag.valor, 0), 2);

    IF v_entrada <= 0 THEN
      CONTINUE;
    END IF;

    -- Troco: entrada líquida no dinheiro (constraint impede entrada+saída
    -- na mesma linha; unique por pagamento impede segunda linha de troco).
    -- Reusa permite_troco, regra oficial já usada no cancelamento.
    IF COALESCE(v_pag.permite_troco, false) AND v_troco_restante > 0 THEN
      IF v_entrada >= v_troco_restante THEN
        v_entrada := round(v_entrada - v_troco_restante, 2);
        v_troco_restante := 0;
      ELSE
        v_troco_restante := round(v_troco_restante - v_entrada, 2);
        v_entrada := 0;
      END IF;
    END IF;

    IF v_entrada <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.caixa_movimentacoes (
      empresa_id,
      filial_id,
      caixa_id,
      tipo,
      origem_tipo,
      origem_id,
      forma_pagamento_id,
      forma_tipo,
      forma_codigo,
      forma_nome,
      venda_id,
      venda_numero,
      cliente_nome,
      entrada,
      saida,
      descricao,
      usuario_id
    )
    VALUES (
      v_empresa_id,
      v_caixa.filial_id,
      v_caixa.id,
      'venda',
      'venda',
      v_pag.id,
      v_pag.forma_pagamento_id,
      v_pag.tipo,
      v_pag.codigo,
      v_pag.nome,
      v_venda_id,
      v_numero,
      v_cliente_nome,
      v_entrada,
      0,
      v_descricao,
      v_usuario_id
    )
    ON CONFLICT (empresa_id, origem_tipo, origem_id)
      WHERE origem_tipo = 'venda' AND origem_id IS NOT NULL
    DO NOTHING;
  END LOOP;

  UPDATE public.caixas
  SET updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id
    AND status = 'aberto';

  venda_id := v_venda_id;
  numero := v_numero;
  valor_total := v_valor_total;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_finalizar_venda_com_caixa(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_finalizar_venda_com_caixa(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, jsonb
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_finalizar_venda_com_caixa(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, jsonb
) TO service_role;

COMMENT ON FUNCTION public.rpc_finalizar_venda_com_caixa(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, jsonb
) IS
  'PDV web: trava o caixa aberto, chama rpc_finalizar_venda e lança pagamentos no livro. Troco = entrada líquida no permite_troco. Fiado não entra. Snapshot da forma na linha. Idempotente por vendas_pagamentos.id.';

NOTIFY pgrst, 'reload schema';

COMMIT;
