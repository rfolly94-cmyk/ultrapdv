BEGIN;

-- ============================================================
-- UltraPDV — Carteira do Cliente / Fase 1
-- Data: 2026-08-13
--
-- Estrutura preparada para:
--   - venda fiado vinculada à venda comercial
--   - saldo por título
--   - saldo aberto por item comprado
--   - baixa total
--   - baixa parcial (FIFO)
--   - baixa de itens selecionados
--   - histórico contábil da carteira
--   - idempotência de recebimentos
--   - forma de pagamento preservada para futura integração Caixa
--
-- Nesta fase o PDV ainda NÃO cria dívida fiado.
-- A função interna de criação do débito já fica pronta para ser
-- chamada atomicamente na próxima etapa.
-- ============================================================


-- ------------------------------------------------------------
-- TÍTULOS / DÍVIDAS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.carteira_cliente_titulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  empresa_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  venda_id uuid,

  numero_venda bigint,

  valor_original numeric(14,2) NOT NULL,
  valor_aberto numeric(14,2) NOT NULL,

  vencimento date,

  status text NOT NULL DEFAULT 'ABERTO',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carteira_titulos_valor_original_check
    CHECK (valor_original > 0),

  CONSTRAINT carteira_titulos_valor_aberto_check
    CHECK (
      valor_aberto >= 0
      AND valor_aberto <= valor_original
    ),

  CONSTRAINT carteira_titulos_status_check
    CHECK (
      status IN (
        'ABERTO',
        'PARCIAL',
        'QUITADO',
        'CANCELADO'
      )
    ),

  CONSTRAINT carteira_titulos_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT carteira_titulos_cliente_empresa_fkey
    FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES public.clientes(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_titulos_venda_empresa_fkey
    FOREIGN KEY (empresa_id, venda_id)
    REFERENCES public.vendas(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_titulos_empresa_id_key
    UNIQUE (empresa_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_carteira_titulo_venda
ON public.carteira_cliente_titulos(
  empresa_id,
  venda_id
)
WHERE venda_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_carteira_titulos_cliente_status
ON public.carteira_cliente_titulos(
  empresa_id,
  cliente_id,
  status,
  created_at DESC
);


-- ------------------------------------------------------------
-- ITENS DA DÍVIDA
-- Um título pode ter vários itens.
-- valor_aberto permite baixar um item inteiro ou parcialmente.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.carteira_cliente_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  empresa_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  titulo_id uuid NOT NULL,

  venda_item_id uuid,
  produto_id uuid,

  produto_codigo text,
  produto_nome text NOT NULL,
  unidade_medida text,

  quantidade numeric(14,4) NOT NULL DEFAULT 1,

  valor_original numeric(14,2) NOT NULL,
  valor_aberto numeric(14,2) NOT NULL,

  status text NOT NULL DEFAULT 'ABERTO',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carteira_itens_quantidade_check
    CHECK (quantidade > 0),

  CONSTRAINT carteira_itens_valor_original_check
    CHECK (valor_original > 0),

  CONSTRAINT carteira_itens_valor_aberto_check
    CHECK (
      valor_aberto >= 0
      AND valor_aberto <= valor_original
    ),

  CONSTRAINT carteira_itens_status_check
    CHECK (
      status IN (
        'ABERTO',
        'PARCIAL',
        'QUITADO',
        'CANCELADO'
      )
    ),

  CONSTRAINT carteira_itens_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT carteira_itens_cliente_empresa_fkey
    FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES public.clientes(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_itens_titulo_empresa_fkey
    FOREIGN KEY (empresa_id, titulo_id)
    REFERENCES public.carteira_cliente_titulos(empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT carteira_itens_venda_item_fkey
    FOREIGN KEY (venda_item_id)
    REFERENCES public.vendas_itens(id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_itens_produto_fkey
    FOREIGN KEY (produto_id)
    REFERENCES public.produtos(id)
    ON DELETE SET NULL,

  CONSTRAINT carteira_itens_empresa_id_key
    UNIQUE (empresa_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_carteira_item_venda_item
ON public.carteira_cliente_itens(
  empresa_id,
  venda_item_id
)
WHERE venda_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_carteira_itens_cliente_aberto
ON public.carteira_cliente_itens(
  empresa_id,
  cliente_id,
  status,
  created_at
);


-- ------------------------------------------------------------
-- RECEBIMENTOS
-- Guarda a forma de pagamento usada.
-- integrado_caixa permanece false nesta fase.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.carteira_cliente_recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  empresa_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  usuario_id uuid,

  forma_pagamento_id uuid NOT NULL,
  forma_pagamento_codigo text NOT NULL,
  forma_pagamento_nome text NOT NULL,
  movimenta_caixa boolean NOT NULL DEFAULT false,

  modo text NOT NULL,

  valor numeric(14,2) NOT NULL DEFAULT 0,
  saldo_anterior numeric(14,2) NOT NULL DEFAULT 0,
  saldo_posterior numeric(14,2) NOT NULL DEFAULT 0,

  observacao text,

  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,

  integrado_caixa boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  processado_at timestamptz,

  CONSTRAINT carteira_recebimentos_modo_check
    CHECK (
      modo IN (
        'TOTAL',
        'PARCIAL',
        'ITENS'
      )
    ),

  CONSTRAINT carteira_recebimentos_valor_check
    CHECK (valor >= 0),

  CONSTRAINT carteira_recebimentos_saldos_check
    CHECK (
      saldo_anterior >= 0
      AND saldo_posterior >= 0
    ),

  CONSTRAINT carteira_recebimentos_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT carteira_recebimentos_cliente_empresa_fkey
    FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES public.clientes(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_recebimentos_usuario_fkey
    FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id)
    ON DELETE SET NULL,

  CONSTRAINT carteira_recebimentos_forma_empresa_fkey
    FOREIGN KEY (empresa_id, forma_pagamento_id)
    REFERENCES public.formas_pagamento(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_recebimentos_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT carteira_recebimentos_idempotencia_key
    UNIQUE (empresa_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_carteira_recebimentos_cliente_data
ON public.carteira_cliente_recebimentos(
  empresa_id,
  cliente_id,
  created_at DESC
);


-- ------------------------------------------------------------
-- ALOCAÇÃO DO RECEBIMENTO EM ITENS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.carteira_cliente_recebimento_alocacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  empresa_id uuid NOT NULL,
  recebimento_id uuid NOT NULL,
  item_id uuid NOT NULL,

  valor numeric(14,2) NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carteira_alocacoes_valor_check
    CHECK (valor > 0),

  CONSTRAINT carteira_alocacoes_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT carteira_alocacoes_recebimento_empresa_fkey
    FOREIGN KEY (empresa_id, recebimento_id)
    REFERENCES public.carteira_cliente_recebimentos(empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT carteira_alocacoes_item_empresa_fkey
    FOREIGN KEY (empresa_id, item_id)
    REFERENCES public.carteira_cliente_itens(empresa_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_carteira_alocacoes_recebimento
ON public.carteira_cliente_recebimento_alocacoes(
  recebimento_id
);


-- ------------------------------------------------------------
-- LIVRO / HISTÓRICO DA CARTEIRA
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.carteira_cliente_movimentacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  empresa_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  usuario_id uuid,

  tipo text NOT NULL,
  origem text NOT NULL,

  valor numeric(14,2) NOT NULL,

  venda_id uuid,
  titulo_id uuid,
  recebimento_id uuid,

  descricao text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT carteira_movimentacoes_tipo_check
    CHECK (
      tipo IN (
        'DEBITO',
        'CREDITO',
        'ESTORNO',
        'AJUSTE'
      )
    ),

  CONSTRAINT carteira_movimentacoes_valor_check
    CHECK (valor > 0),

  CONSTRAINT carteira_movimentacoes_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT carteira_movimentacoes_cliente_empresa_fkey
    FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES public.clientes(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_movimentacoes_usuario_fkey
    FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id)
    ON DELETE SET NULL,

  CONSTRAINT carteira_movimentacoes_venda_empresa_fkey
    FOREIGN KEY (empresa_id, venda_id)
    REFERENCES public.vendas(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_movimentacoes_titulo_empresa_fkey
    FOREIGN KEY (empresa_id, titulo_id)
    REFERENCES public.carteira_cliente_titulos(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT carteira_movimentacoes_recebimento_empresa_fkey
    FOREIGN KEY (empresa_id, recebimento_id)
    REFERENCES public.carteira_cliente_recebimentos(empresa_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_carteira_movimentacoes_cliente_data
ON public.carteira_cliente_movimentacoes(
  empresa_id,
  cliente_id,
  created_at DESC
);


-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_carteira_titulos_updated_at
ON public.carteira_cliente_titulos;

CREATE TRIGGER trg_carteira_titulos_updated_at
BEFORE UPDATE ON public.carteira_cliente_titulos
FOR EACH ROW
EXECUTE FUNCTION public.ultrapdv_set_updated_at();

DROP TRIGGER IF EXISTS trg_carteira_itens_updated_at
ON public.carteira_cliente_itens;

CREATE TRIGGER trg_carteira_itens_updated_at
BEFORE UPDATE ON public.carteira_cliente_itens
FOR EACH ROW
EXECUTE FUNCTION public.ultrapdv_set_updated_at();


-- ------------------------------------------------------------
-- RLS
-- Escrita só por RPC.
-- ------------------------------------------------------------

ALTER TABLE public.carteira_cliente_titulos
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.carteira_cliente_itens
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.carteira_cliente_recebimentos
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.carteira_cliente_recebimento_alocacoes
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.carteira_cliente_movimentacoes
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS usuario_visualiza_carteira_titulos
ON public.carteira_cliente_titulos;

CREATE POLICY usuario_visualiza_carteira_titulos
ON public.carteira_cliente_titulos
FOR SELECT
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
);


DROP POLICY IF EXISTS usuario_visualiza_carteira_itens
ON public.carteira_cliente_itens;

CREATE POLICY usuario_visualiza_carteira_itens
ON public.carteira_cliente_itens
FOR SELECT
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
);


DROP POLICY IF EXISTS usuario_visualiza_carteira_recebimentos
ON public.carteira_cliente_recebimentos;

CREATE POLICY usuario_visualiza_carteira_recebimentos
ON public.carteira_cliente_recebimentos
FOR SELECT
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
);


DROP POLICY IF EXISTS usuario_visualiza_carteira_alocacoes
ON public.carteira_cliente_recebimento_alocacoes;

CREATE POLICY usuario_visualiza_carteira_alocacoes
ON public.carteira_cliente_recebimento_alocacoes
FOR SELECT
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
);


DROP POLICY IF EXISTS usuario_visualiza_carteira_movimentacoes
ON public.carteira_cliente_movimentacoes;

CREATE POLICY usuario_visualiza_carteira_movimentacoes
ON public.carteira_cliente_movimentacoes
FOR SELECT
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
);


GRANT SELECT
ON public.carteira_cliente_titulos
TO authenticated;

GRANT SELECT
ON public.carteira_cliente_itens
TO authenticated;

GRANT SELECT
ON public.carteira_cliente_recebimentos
TO authenticated;

GRANT SELECT
ON public.carteira_cliente_recebimento_alocacoes
TO authenticated;

GRANT SELECT
ON public.carteira_cliente_movimentacoes
TO authenticated;

REVOKE INSERT, UPDATE, DELETE
ON public.carteira_cliente_titulos
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
ON public.carteira_cliente_itens
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
ON public.carteira_cliente_recebimentos
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
ON public.carteira_cliente_recebimento_alocacoes
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
ON public.carteira_cliente_movimentacoes
FROM authenticated;


-- ------------------------------------------------------------
-- VENCIMENTO
-- Retorna o próximo dia de vencimento a partir da data-base.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.carteira_calcular_vencimento(
  p_data_base date,
  p_dia smallint
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_inicio_mes date;
  v_ultimo_dia integer;
  v_dia integer;
  v_candidato date;
BEGIN
  IF p_dia IS NULL THEN
    RETURN NULL;
  END IF;

  v_inicio_mes :=
    date_trunc(
      'month',
      p_data_base::timestamp
    )::date;

  v_ultimo_dia :=
    EXTRACT(
      DAY FROM (
        v_inicio_mes
        + INTERVAL '1 month'
        - INTERVAL '1 day'
      )
    )::integer;

  v_dia :=
    LEAST(
      p_dia::integer,
      v_ultimo_dia
    );

  v_candidato :=
    v_inicio_mes
    + (v_dia - 1);

  IF v_candidato <= p_data_base THEN
    v_inicio_mes :=
      (
        v_inicio_mes
        + INTERVAL '1 month'
      )::date;

    v_ultimo_dia :=
      EXTRACT(
        DAY FROM (
          v_inicio_mes
          + INTERVAL '1 month'
          - INTERVAL '1 day'
        )
      )::integer;

    v_dia :=
      LEAST(
        p_dia::integer,
        v_ultimo_dia
      );

    v_candidato :=
      v_inicio_mes
      + (v_dia - 1);
  END IF;

  RETURN v_candidato;
END;
$$;


-- ------------------------------------------------------------
-- Recalcula e sincroniza clientes.saldo_devedor.
-- Função interna.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.carteira_recalcular_saldo_cliente_interno(
  p_empresa_id uuid,
  p_cliente_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo numeric(14,2);
BEGIN
  SELECT
    COALESCE(
      SUM(t.valor_aberto),
      0
    )::numeric(14,2)
  INTO v_saldo
  FROM public.carteira_cliente_titulos AS t
  WHERE t.empresa_id = p_empresa_id
    AND t.cliente_id = p_cliente_id
    AND t.status <> 'CANCELADO';

  UPDATE public.clientes AS c
  SET saldo_devedor = v_saldo
  WHERE c.empresa_id = p_empresa_id
    AND c.id = p_cliente_id;

  RETURN v_saldo;
END;
$$;

REVOKE ALL
ON FUNCTION public.carteira_recalcular_saldo_cliente_interno(
  uuid,
  uuid
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.carteira_recalcular_saldo_cliente_interno(
  uuid,
  uuid
)
FROM authenticated;


-- ------------------------------------------------------------
-- Criação do débito de uma venda fiado.
-- FUNÇÃO INTERNA: ainda não é chamada pelo PDV nesta fase.
--
-- O valor fiado é obtido dos pagamentos da venda cuja forma
-- permite_fiado=true.
--
-- Em venda combinada, o valor fiado é rateado proporcionalmente
-- entre os itens para permitir baixa por item.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.carteira_criar_debito_venda_interno(
  p_empresa_id uuid,
  p_venda_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venda record;
  v_cliente record;

  v_existente uuid;

  v_valor_fiado numeric(14,2);
  v_total_itens numeric(14,4);

  v_titulo_id uuid;
  v_vencimento date;

  v_item record;
  v_total_registros integer;
  v_indice integer := 0;
  v_valor_item numeric(14,2);
  v_restante numeric(14,2);

  v_saldo_atual numeric(14,2);
BEGIN
  SELECT
    v.id,
    v.empresa_id,
    v.cliente_id,
    v.numero,
    v.status,
    v.valor_total,
    v.finalizada_at
  INTO v_venda
  FROM public.vendas AS v
  WHERE v.empresa_id = p_empresa_id
    AND v.id = p_venda_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.';
  END IF;

  IF v_venda.status <> 'finalizada' THEN
    RAISE EXCEPTION 'Somente venda finalizada pode gerar carteira.';
  END IF;

  IF v_venda.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Venda fiado exige cliente.';
  END IF;

  SELECT t.id
  INTO v_existente
  FROM public.carteira_cliente_titulos AS t
  WHERE t.empresa_id = p_empresa_id
    AND t.venda_id = p_venda_id;

  IF v_existente IS NOT NULL THEN
    RETURN v_existente;
  END IF;

  SELECT
    c.id,
    c.ativo,
    c.bloqueado,
    c.limite_credito,
    c.saldo_devedor,
    c.dia_vencimento
  INTO v_cliente
  FROM public.clientes AS c
  WHERE c.empresa_id = p_empresa_id
    AND c.id = v_venda.cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente da venda não encontrado.';
  END IF;

  IF NOT v_cliente.ativo THEN
    RAISE EXCEPTION 'Cliente inativo não pode comprar fiado.';
  END IF;

  IF v_cliente.bloqueado THEN
    RAISE EXCEPTION 'Cliente está bloqueado para venda fiado.';
  END IF;

  SELECT
    COALESCE(
      SUM(vp.valor),
      0
    )::numeric(14,2)
  INTO v_valor_fiado
  FROM public.vendas_pagamentos AS vp
  JOIN public.formas_pagamento AS fp
    ON fp.empresa_id = vp.empresa_id
   AND fp.id = vp.forma_pagamento_id
  WHERE vp.empresa_id = p_empresa_id
    AND vp.venda_id = p_venda_id
    AND vp.status = 'confirmado'
    AND fp.permite_fiado = true;

  IF v_valor_fiado <= 0 THEN
    RAISE EXCEPTION 'Venda não possui valor fiado.';
  END IF;

  v_saldo_atual :=
    public.carteira_recalcular_saldo_cliente_interno(
      p_empresa_id,
      v_venda.cliente_id
    );

  IF
    v_saldo_atual + v_valor_fiado
    > COALESCE(v_cliente.limite_credito, 0)
  THEN
    RAISE EXCEPTION
      'Limite de crédito insuficiente. Disponível: %.',
      GREATEST(
        COALESCE(v_cliente.limite_credito, 0)
        - v_saldo_atual,
        0
      );
  END IF;

  SELECT
    COALESCE(
      SUM(vi.valor_total),
      0
    ),
    COUNT(*)
  INTO
    v_total_itens,
    v_total_registros
  FROM public.vendas_itens AS vi
  WHERE vi.empresa_id = p_empresa_id
    AND vi.venda_id = p_venda_id;

  IF v_total_registros = 0
     OR v_total_itens <= 0 THEN
    RAISE EXCEPTION 'Venda sem itens válidos para carteira.';
  END IF;

  v_vencimento :=
    public.carteira_calcular_vencimento(
      COALESCE(
        v_venda.finalizada_at::date,
        CURRENT_DATE
      ),
      v_cliente.dia_vencimento
    );

  INSERT INTO public.carteira_cliente_titulos (
    empresa_id,
    cliente_id,
    venda_id,
    numero_venda,
    valor_original,
    valor_aberto,
    vencimento,
    status
  )
  VALUES (
    p_empresa_id,
    v_venda.cliente_id,
    p_venda_id,
    v_venda.numero,
    v_valor_fiado,
    v_valor_fiado,
    v_vencimento,
    'ABERTO'
  )
  RETURNING id
  INTO v_titulo_id;

  v_restante := v_valor_fiado;

  FOR v_item IN
    SELECT
      vi.id,
      vi.produto_id,
      vi.produto_codigo,
      vi.produto_nome,
      vi.unidade_medida,
      vi.quantidade,
      vi.valor_total
    FROM public.vendas_itens AS vi
    WHERE vi.empresa_id = p_empresa_id
      AND vi.venda_id = p_venda_id
    ORDER BY vi.id
  LOOP
    v_indice :=
      v_indice + 1;

    IF v_indice = v_total_registros THEN
      v_valor_item :=
        v_restante;
    ELSE
      v_valor_item :=
        ROUND(
          (
            v_valor_fiado
            * v_item.valor_total
            / v_total_itens
          )::numeric,
          2
        );

      v_valor_item :=
        LEAST(
          v_valor_item,
          v_restante
        );
    END IF;

    IF v_valor_item > 0 THEN
      INSERT INTO public.carteira_cliente_itens (
        empresa_id,
        cliente_id,
        titulo_id,
        venda_item_id,
        produto_id,
        produto_codigo,
        produto_nome,
        unidade_medida,
        quantidade,
        valor_original,
        valor_aberto,
        status
      )
      VALUES (
        p_empresa_id,
        v_venda.cliente_id,
        v_titulo_id,
        v_item.id,
        v_item.produto_id,
        v_item.produto_codigo,
        v_item.produto_nome,
        v_item.unidade_medida,
        v_item.quantidade,
        v_valor_item,
        v_valor_item,
        'ABERTO'
      );

      v_restante :=
        v_restante
        - v_valor_item;
    END IF;
  END LOOP;

  INSERT INTO public.carteira_cliente_movimentacoes (
    empresa_id,
    cliente_id,
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
    'DEBITO',
    'VENDA_FIADO',
    v_valor_fiado,
    p_venda_id,
    v_titulo_id,
    CONCAT(
      'Venda fiado nº ',
      COALESCE(
        v_venda.numero::text,
        'sem número'
      )
    )
  );

  PERFORM
    public.carteira_recalcular_saldo_cliente_interno(
      p_empresa_id,
      v_venda.cliente_id
    );

  RETURN v_titulo_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.carteira_criar_debito_venda_interno(
  uuid,
  uuid
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.carteira_criar_debito_venda_interno(
  uuid,
  uuid
)
FROM authenticated;


-- ------------------------------------------------------------
-- RPC pública: receber carteira
--
-- TOTAL:
--   baixa todo o saldo aberto
--
-- PARCIAL:
--   p_valor obrigatório; baixa FIFO
--
-- ITENS:
--   p_item_ids obrigatório; quita o saldo aberto dos itens
--
-- Possui idempotência para impedir recebimento duplicado.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_receber_carteira_cliente(
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_forma_pagamento_id uuid,
  p_modo text,
  p_valor numeric DEFAULT NULL,
  p_item_ids jsonb DEFAULT '[]'::jsonb,
  p_observacao text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS TABLE (
  recebimento_id uuid,
  valor_recebido numeric,
  saldo_anterior numeric,
  saldo_atual numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id uuid;
  v_modo text;

  v_cliente record;
  v_forma record;

  v_request_hash text;
  v_recebimento record;

  v_saldo_anterior numeric(14,2);
  v_saldo_atual numeric(14,2);

  v_valor_recebimento numeric(14,2);
  v_restante numeric(14,2);

  v_item record;
  v_alocacao numeric(14,2);

  v_item_ids uuid[];
  v_item_id_text text;

  v_selecionados integer;
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Chave de idempotência é obrigatória.';
  END IF;

  v_modo :=
    upper(
      btrim(
        COALESCE(p_modo, '')
      )
    );

  IF v_modo NOT IN (
    'TOTAL',
    'PARCIAL',
    'ITENS'
  ) THEN
    RAISE EXCEPTION 'Modo de recebimento inválido.';
  END IF;

  SELECT
    c.id,
    c.nome,
    c.ativo,
    c.saldo_devedor
  INTO v_cliente
  FROM public.clientes AS c
  WHERE c.empresa_id = p_empresa_id
    AND c.id = p_cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  SELECT
    fp.id,
    fp.codigo,
    fp.nome,
    fp.permite_fiado,
    fp.movimenta_caixa,
    fp.ativo
  INTO v_forma
  FROM public.formas_pagamento AS fp
  WHERE fp.empresa_id = p_empresa_id
    AND fp.id = p_forma_pagamento_id;

  IF NOT FOUND OR NOT v_forma.ativo THEN
    RAISE EXCEPTION 'Forma de pagamento inválida ou inativa.';
  END IF;

  IF v_forma.permite_fiado THEN
    RAISE EXCEPTION 'Fiado não pode ser usado para receber uma dívida.';
  END IF;

  IF COALESCE(
    jsonb_typeof(p_item_ids),
    ''
  ) <> 'array' THEN
    RAISE EXCEPTION 'Lista de itens inválida.';
  END IF;

  v_item_ids :=
    ARRAY[]::uuid[];

  FOR v_item_id_text IN
    SELECT value
    FROM jsonb_array_elements_text(
      p_item_ids
    )
  LOOP
    BEGIN
      v_item_ids :=
        array_append(
          v_item_ids,
          v_item_id_text::uuid
        );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Item selecionado inválido.';
    END;
  END LOOP;

  v_request_hash :=
    md5(
      jsonb_build_object(
        'empresa_id',
        p_empresa_id,
        'cliente_id',
        p_cliente_id,
        'forma_pagamento_id',
        p_forma_pagamento_id,
        'modo',
        v_modo,
        'valor',
        p_valor,
        'item_ids',
        p_item_ids,
        'observacao',
        NULLIF(
          btrim(
            COALESCE(p_observacao, '')
          ),
          ''
        )
      )::text
    );

  INSERT INTO public.carteira_cliente_recebimentos (
    empresa_id,
    cliente_id,
    usuario_id,
    forma_pagamento_id,
    forma_pagamento_codigo,
    forma_pagamento_nome,
    movimenta_caixa,
    modo,
    valor,
    saldo_anterior,
    saldo_posterior,
    observacao,
    idempotency_key,
    request_hash,
    integrado_caixa
  )
  VALUES (
    p_empresa_id,
    p_cliente_id,
    v_usuario_id,
    p_forma_pagamento_id,
    v_forma.codigo,
    v_forma.nome,
    v_forma.movimenta_caixa,
    v_modo,
    0,
    0,
    0,
    NULLIF(
      btrim(
        COALESCE(p_observacao, '')
      ),
      ''
    ),
    p_idempotency_key,
    v_request_hash,
    false
  )
  ON CONFLICT (
    empresa_id,
    idempotency_key
  )
  DO NOTHING;

  SELECT
    r.*
  INTO v_recebimento
  FROM public.carteira_cliente_recebimentos AS r
  WHERE r.empresa_id = p_empresa_id
    AND r.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_recebimento.request_hash <> v_request_hash THEN
    RAISE EXCEPTION
      'Esta chave de idempotência já foi usada com dados diferentes.';
  END IF;

  IF v_recebimento.processado_at IS NOT NULL THEN
    RETURN QUERY
    SELECT
      v_recebimento.id,
      v_recebimento.valor,
      v_recebimento.saldo_anterior,
      v_recebimento.saldo_posterior;

    RETURN;
  END IF;

  v_saldo_anterior :=
    public.carteira_recalcular_saldo_cliente_interno(
      p_empresa_id,
      p_cliente_id
    );

  IF v_saldo_anterior <= 0 THEN
    RAISE EXCEPTION 'Cliente não possui saldo devedor.';
  END IF;

  IF v_modo = 'TOTAL' THEN
    v_valor_recebimento :=
      v_saldo_anterior;

  ELSIF v_modo = 'PARCIAL' THEN
    IF p_valor IS NULL
       OR p_valor <= 0 THEN
      RAISE EXCEPTION 'Informe um valor maior que zero.';
    END IF;

    v_valor_recebimento :=
      ROUND(
        p_valor::numeric,
        2
      );

    IF v_valor_recebimento > v_saldo_anterior THEN
      RAISE EXCEPTION
        'Valor do recebimento não pode ser maior que o saldo devedor.';
    END IF;

  ELSE
    IF cardinality(v_item_ids) = 0 THEN
      RAISE EXCEPTION 'Selecione ao menos um item.';
    END IF;

    SELECT
      COUNT(*),
      COALESCE(
        SUM(ci.valor_aberto),
        0
      )::numeric(14,2)
    INTO
      v_selecionados,
      v_valor_recebimento
    FROM public.carteira_cliente_itens AS ci
    WHERE ci.empresa_id = p_empresa_id
      AND ci.cliente_id = p_cliente_id
      AND ci.id = ANY(v_item_ids)
      AND ci.valor_aberto > 0
      AND ci.status <> 'CANCELADO';

    IF v_selecionados <> cardinality(v_item_ids) THEN
      RAISE EXCEPTION
        'Um ou mais itens selecionados não estão disponíveis para baixa.';
    END IF;

    IF v_valor_recebimento <= 0 THEN
      RAISE EXCEPTION
        'Os itens selecionados não possuem saldo aberto.';
    END IF;
  END IF;

  v_restante :=
    v_valor_recebimento;

  FOR v_item IN
    SELECT
      ci.id,
      ci.titulo_id,
      ci.valor_aberto,
      ct.created_at AS titulo_created_at
    FROM public.carteira_cliente_itens AS ci
    JOIN public.carteira_cliente_titulos AS ct
      ON ct.empresa_id = ci.empresa_id
     AND ct.id = ci.titulo_id
    WHERE ci.empresa_id = p_empresa_id
      AND ci.cliente_id = p_cliente_id
      AND ci.valor_aberto > 0
      AND ci.status <> 'CANCELADO'
      AND (
        v_modo <> 'ITENS'
        OR ci.id = ANY(v_item_ids)
      )
    ORDER BY
      ct.vencimento NULLS LAST,
      ct.created_at,
      ci.created_at,
      ci.id
    FOR UPDATE OF ci
  LOOP
    EXIT WHEN v_restante <= 0;

    v_alocacao :=
      LEAST(
        v_item.valor_aberto,
        v_restante
      );

    IF v_alocacao <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.carteira_cliente_itens AS ci
    SET
      valor_aberto =
        ci.valor_aberto
        - v_alocacao,
      status =
        CASE
          WHEN ci.valor_aberto - v_alocacao <= 0
            THEN 'QUITADO'
          ELSE 'PARCIAL'
        END
    WHERE ci.empresa_id = p_empresa_id
      AND ci.id = v_item.id;

    INSERT INTO public.carteira_cliente_recebimento_alocacoes (
      empresa_id,
      recebimento_id,
      item_id,
      valor
    )
    VALUES (
      p_empresa_id,
      v_recebimento.id,
      v_item.id,
      v_alocacao
    );

    v_restante :=
      v_restante
      - v_alocacao;
  END LOOP;

  IF v_restante <> 0 THEN
    RAISE EXCEPTION
      'Não foi possível alocar integralmente o recebimento.';
  END IF;

  UPDATE public.carteira_cliente_titulos AS ct
  SET
    valor_aberto =
      COALESCE(
        (
          SELECT
            SUM(ci.valor_aberto)
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
            SELECT
              SUM(ci.valor_aberto)
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
            SELECT
              SUM(ci.valor_aberto)
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
    AND ct.status <> 'CANCELADO';

  v_saldo_atual :=
    public.carteira_recalcular_saldo_cliente_interno(
      p_empresa_id,
      p_cliente_id
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
    'CREDITO',
    'RECEBIMENTO',
    v_valor_recebimento,
    v_recebimento.id,
    CONCAT(
      'Recebimento via ',
      v_forma.nome
    )
  );

  UPDATE public.carteira_cliente_recebimentos AS r
  SET
    valor =
      v_valor_recebimento,
    saldo_anterior =
      v_saldo_anterior,
    saldo_posterior =
      v_saldo_atual,
    processado_at =
      now()
  WHERE r.empresa_id = p_empresa_id
    AND r.id = v_recebimento.id;

  RETURN QUERY
  SELECT
    v_recebimento.id,
    v_valor_recebimento,
    v_saldo_anterior,
    v_saldo_atual;
END;
$$;

REVOKE ALL
ON FUNCTION public.rpc_receber_carteira_cliente(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  jsonb,
  text,
  uuid
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.rpc_receber_carteira_cliente(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  jsonb,
  text,
  uuid
)
TO authenticated;

COMMIT;
