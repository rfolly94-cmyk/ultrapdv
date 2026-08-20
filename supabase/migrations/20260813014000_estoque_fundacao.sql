BEGIN;

-- ============================================================
-- UltraPDV — Estoque / Fase 1
-- Data: 2026-08-13
--
-- Cria:
--   estoque_atual
--   estoque_movimentacoes
--   inicialização automática por produto
--   RPC de movimentação manual
--   RPC de limites mínimo/máximo
--
-- Nesta fase o estoque AINDA NÃO é movimentado pela venda.
-- Essa integração será feita somente depois de o módulo estar
-- validado isoladamente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.estoque_atual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  quantidade numeric(14,4) NOT NULL DEFAULT 0,
  estoque_minimo numeric(14,4) NOT NULL DEFAULT 0,
  estoque_maximo numeric(14,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT estoque_atual_quantidade_check
    CHECK (quantidade >= 0),

  CONSTRAINT estoque_atual_minimo_check
    CHECK (estoque_minimo >= 0),

  CONSTRAINT estoque_atual_maximo_check
    CHECK (
      estoque_maximo IS NULL
      OR estoque_maximo >= estoque_minimo
    ),

  CONSTRAINT estoque_atual_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT estoque_atual_produto_empresa_fkey
    FOREIGN KEY (empresa_id, produto_id)
    REFERENCES public.produtos(empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT estoque_atual_empresa_produto_key
    UNIQUE (empresa_id, produto_id)
);

CREATE INDEX IF NOT EXISTS ix_estoque_atual_empresa
  ON public.estoque_atual(empresa_id);

CREATE INDEX IF NOT EXISTS ix_estoque_atual_produto
  ON public.estoque_atual(produto_id);


CREATE TABLE IF NOT EXISTS public.estoque_movimentacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  venda_id uuid,
  usuario_id uuid,

  tipo text NOT NULL,
  origem text NOT NULL DEFAULT 'AJUSTE_MANUAL',

  quantidade numeric(14,4) NOT NULL,
  saldo_anterior numeric(14,4) NOT NULL,
  saldo_posterior numeric(14,4) NOT NULL,

  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT estoque_movimentacoes_tipo_check
    CHECK (
      tipo IN (
        'ENTRADA',
        'SAIDA',
        'AJUSTE_POSITIVO',
        'AJUSTE_NEGATIVO',
        'VENDA',
        'CANCELAMENTO_VENDA'
      )
    ),

  CONSTRAINT estoque_movimentacoes_quantidade_check
    CHECK (quantidade > 0),

  CONSTRAINT estoque_movimentacoes_saldos_check
    CHECK (
      saldo_anterior >= 0
      AND saldo_posterior >= 0
    ),

  CONSTRAINT estoque_movimentacoes_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT estoque_movimentacoes_produto_empresa_fkey
    FOREIGN KEY (empresa_id, produto_id)
    REFERENCES public.produtos(empresa_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT estoque_movimentacoes_venda_empresa_fkey
    FOREIGN KEY (empresa_id, venda_id)
    REFERENCES public.vendas(empresa_id, id)
    ON DELETE SET NULL,

  CONSTRAINT estoque_movimentacoes_usuario_fkey
    FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_estoque_movimentacoes_empresa_data
  ON public.estoque_movimentacoes(empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_estoque_movimentacoes_produto_data
  ON public.estoque_movimentacoes(produto_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_estoque_movimentacoes_venda
  ON public.estoque_movimentacoes(venda_id)
  WHERE venda_id IS NOT NULL;


-- ------------------------------------------------------------
-- updated_at
-- Reutiliza a função comercial já criada anteriormente.
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_estoque_atual_updated_at
ON public.estoque_atual;

CREATE TRIGGER trg_estoque_atual_updated_at
BEFORE UPDATE ON public.estoque_atual
FOR EACH ROW
EXECUTE FUNCTION public.ultrapdv_set_updated_at();


-- ------------------------------------------------------------
-- Inicialização automática do saldo quando nasce um produto.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inicializar_estoque_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.estoque_atual (
    empresa_id,
    produto_id,
    quantidade,
    estoque_minimo
  )
  VALUES (
    NEW.empresa_id,
    NEW.id,
    0,
    0
  )
  ON CONFLICT (empresa_id, produto_id)
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produto_inicializar_estoque
ON public.produtos;

CREATE TRIGGER trg_produto_inicializar_estoque
AFTER INSERT ON public.produtos
FOR EACH ROW
EXECUTE FUNCTION public.inicializar_estoque_produto();


-- Backfill dos produtos que já existem.
INSERT INTO public.estoque_atual (
  empresa_id,
  produto_id,
  quantidade,
  estoque_minimo
)
SELECT
  p.empresa_id,
  p.id,
  0,
  0
FROM public.produtos p
ON CONFLICT (empresa_id, produto_id)
DO NOTHING;


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

ALTER TABLE public.estoque_atual
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.estoque_movimentacoes
ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_estoque
ON public.estoque_atual;

CREATE POLICY usuario_visualiza_estoque
ON public.estoque_atual
FOR SELECT
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
);

DROP POLICY IF EXISTS usuario_visualiza_movimentacoes_estoque
ON public.estoque_movimentacoes;

CREATE POLICY usuario_visualiza_movimentacoes_estoque
ON public.estoque_movimentacoes
FOR SELECT
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
);

REVOKE INSERT, UPDATE, DELETE
ON public.estoque_atual
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
ON public.estoque_movimentacoes
FROM authenticated;

GRANT SELECT
ON public.estoque_atual
TO authenticated;

GRANT SELECT
ON public.estoque_movimentacoes
TO authenticated;


-- ------------------------------------------------------------
-- RPC: movimentação manual.
--
-- ENTRADA:
--   p_quantidade = quantidade que entra
--
-- SAIDA:
--   p_quantidade = quantidade que sai
--
-- AJUSTE:
--   p_quantidade = novo saldo absoluto
--
-- Manual somente para administrador.
-- ------------------------------------------------------------

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
    FROM public.produtos p
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

  IF v_operacao IN ('ENTRADA', 'SAIDA') AND p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  IF v_operacao = 'AJUSTE' AND p_quantidade < 0 THEN
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
  ON CONFLICT (empresa_id, produto_id)
  DO NOTHING;

  SELECT ea.quantidade
  INTO v_anterior
  FROM public.estoque_atual ea
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

  UPDATE public.estoque_atual
  SET quantidade = v_atual
  WHERE empresa_id = p_empresa_id
    AND produto_id = p_produto_id;

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
    NULLIF(btrim(COALESCE(p_observacao, '')), '')
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


-- ------------------------------------------------------------
-- RPC: mínimo / máximo.
-- Manual somente para administrador.
-- ------------------------------------------------------------

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
    FROM public.produtos p
    WHERE p.id = p_produto_id
      AND p.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado na empresa.';
  END IF;

  IF p_estoque_minimo IS NULL OR p_estoque_minimo < 0 THEN
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
  ON CONFLICT (empresa_id, produto_id)
  DO UPDATE
  SET
    estoque_minimo = EXCLUDED.estoque_minimo,
    estoque_maximo = EXCLUDED.estoque_maximo;

  RETURN QUERY
  SELECT
    ea.produto_id,
    ea.estoque_minimo,
    ea.estoque_maximo
  FROM public.estoque_atual ea
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
