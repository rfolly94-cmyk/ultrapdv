BEGIN;

-- UltraPDV — permitir venda sem estoque (configuração por empresa).
-- Default false preserva o bloqueio atual. Não altera o UltraPDV Mobile.

CREATE TABLE IF NOT EXISTS public.pdv_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas (id) ON DELETE CASCADE,
  permitir_venda_sem_estoque boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pdv_configuracoes IS
  'Preferências operacionais do PDV por empresa. Isolado por empresa_id.';

COMMENT ON COLUMN public.pdv_configuracoes.permitir_venda_sem_estoque IS
  'Se false (default), a baixa da venda bloqueia estoque insuficiente. Se true, permite saldo negativo.';

ALTER TABLE public.pdv_configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_pdv_configuracoes
  ON public.pdv_configuracoes;
CREATE POLICY usuario_visualiza_pdv_configuracoes
  ON public.pdv_configuracoes
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.pdv_configuracoes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.pdv_configuracoes FROM authenticated;
GRANT SELECT ON TABLE public.pdv_configuracoes TO authenticated;
GRANT ALL ON TABLE public.pdv_configuracoes TO service_role;

-- A CHECK antiga impede saldo negativo mesmo quando a empresa autoriza.
ALTER TABLE public.estoque_atual
  DROP CONSTRAINT IF EXISTS estoque_atual_quantidade_check;

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

  IF v_produtos = 0 THEN
    RAISE EXCEPTION
      'A venda não possui itens para baixa de estoque.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.estoque_baixar_composicao_venda_interno(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estoque_baixar_composicao_venda_interno(uuid, uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_definir_pdv_permitir_venda_sem_estoque(
  p_permitir boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_permitir boolean := COALESCE(p_permitir, false);
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

  INSERT INTO public.pdv_configuracoes (
    empresa_id,
    permitir_venda_sem_estoque,
    updated_at
  )
  VALUES (v_empresa_id, v_permitir, now())
  ON CONFLICT (empresa_id) DO UPDATE
  SET
    permitir_venda_sem_estoque = EXCLUDED.permitir_venda_sem_estoque,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'permitir_venda_sem_estoque', v_permitir
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_definir_pdv_permitir_venda_sem_estoque(boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_definir_pdv_permitir_venda_sem_estoque(boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_definir_pdv_permitir_venda_sem_estoque(boolean)
  TO service_role;

COMMENT ON FUNCTION public.rpc_definir_pdv_permitir_venda_sem_estoque(boolean) IS
  'Define se a empresa ativa permite venda sem estoque. empresa_id vem da sessão, nunca do cliente.';

COMMIT;
