BEGIN;

-- PIX Geranet no PDV: campos aditivos + validação/vínculo no wrapper comercial.
-- Não altera rpc_finalizar_venda (idempotência).

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS checkout_key text;

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS valor_pago numeric(12, 2);

ALTER TABLE public.cobrancas_pix
  DROP CONSTRAINT IF EXISTS cobrancas_pix_status_check;

ALTER TABLE public.cobrancas_pix
  ADD CONSTRAINT cobrancas_pix_status_check
  CHECK (
    status IN (
      'pendente',
      'paga',
      'cancelada',
      'erro',
      'expirada',
      'divergencia_valor',
      'aguardando_confirmacao',
      'confirmado_manual',
      'vinculado_venda',
      'descartado'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_cobrancas_pix_checkout_ativa
  ON public.cobrancas_pix (empresa_id, checkout_key)
  WHERE checkout_key IS NOT NULL
    AND btrim(checkout_key) <> ''
    AND venda_id IS NULL
    AND status IN ('pendente', 'paga', 'divergencia_valor');

CREATE INDEX IF NOT EXISTS ix_cobrancas_pix_checkout_key
  ON public.cobrancas_pix (empresa_id, checkout_key)
  WHERE checkout_key IS NOT NULL;

COMMENT ON COLUMN public.cobrancas_pix.checkout_key IS
  'Idempotência do checkout PDV. Mesma empresa+chave reutiliza a cobrança ativa.';

COMMENT ON COLUMN public.cobrancas_pix.valor_pago IS
  'Valor efetivamente informado pelo PSP, quando existir. Não vem do browser.';

CREATE OR REPLACE FUNCTION public.pix_local_validar_na_finalizacao(
  p_empresa_id uuid,
  p_pagamentos jsonb,
  p_venda_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_pagamento jsonb;
  v_recebimento_id uuid;
  v_valor numeric;
  v_forma_id uuid;
  v_cobranca record;
  v_modo text;
BEGIN
  SELECT modo
  INTO v_modo
  FROM public.integracoes_pix
  WHERE empresa_id = p_empresa_id
    AND ativo = true;

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_pagamentos, '[]'::jsonb))
  LOOP
    BEGIN
      v_recebimento_id :=
        NULLIF(btrim(COALESCE(
          v_pagamento ->> 'pix_local_recebimento_id',
          v_pagamento ->> 'pix_geranet_cobranca_id'
        )), '')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'pix_local_recebimento_id inválido.';
    END;

    BEGIN
      v_forma_id :=
        NULLIF(btrim(v_pagamento ->> 'forma_pagamento_id'), '')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'forma_pagamento_id inválido.';
    END;

    v_valor := NULLIF(v_pagamento ->> 'valor', '')::numeric;

    IF v_recebimento_id IS NULL THEN
      IF COALESCE(v_modo, '') = 'local_manual'
         AND EXISTS (
           SELECT 1
           FROM public.formas_pagamento AS fp
           WHERE fp.empresa_id = p_empresa_id
             AND fp.id = v_forma_id
             AND fp.ativo = true
             AND public.forma_pagamento_eh_pix(fp.codigo, fp.tipo, fp.nome)
             AND fp.permite_fiado = false
         )
      THEN
        RAISE EXCEPTION
          'Confirme o recebimento do PIX de R$ % antes de finalizar a venda.',
          to_char(COALESCE(v_valor, 0), 'FM999999990.00');
      END IF;

      CONTINUE;
    END IF;

    SELECT
      c.id,
      c.empresa_id,
      c.status,
      c.modo_pix,
      c.venda_id,
      c.valor,
      c.confirmado_manualmente
    INTO v_cobranca
    FROM public.cobrancas_pix AS c
    WHERE c.id = v_recebimento_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recebimento PIX não encontrado.';
    END IF;

    IF v_cobranca.empresa_id <> p_empresa_id THEN
      RAISE EXCEPTION 'Recurso PIX pertence a outra empresa.';
    END IF;

    IF v_cobranca.modo_pix = 'geranet' THEN
      CONTINUE;
    END IF;

    IF v_cobranca.modo_pix IS DISTINCT FROM 'local_manual' THEN
      RAISE EXCEPTION 'Este recebimento não é um PIX Local.';
    END IF;

    IF v_cobranca.venda_id IS NOT NULL
       AND (
         p_venda_id IS NULL
         OR v_cobranca.venda_id IS DISTINCT FROM p_venda_id
       ) THEN
      RAISE EXCEPTION 'Este PIX já foi utilizado em outra venda.';
    END IF;

    IF v_cobranca.status = 'vinculado_venda'
       AND p_venda_id IS NOT NULL
       AND v_cobranca.venda_id = p_venda_id THEN
      CONTINUE;
    END IF;

    IF v_cobranca.status IS DISTINCT FROM 'confirmado_manual'
       OR v_cobranca.confirmado_manualmente IS NOT TRUE THEN
      RAISE EXCEPTION
        'Confirme o recebimento do PIX de R$ % antes de finalizar a venda.',
        to_char(COALESCE(v_valor, v_cobranca.valor), 'FM999999990.00');
    END IF;

    IF v_cobranca.valor IS DISTINCT FROM v_valor THEN
      RAISE EXCEPTION
        'O valor do PIX confirmado deve ser igual ao pagamento.';
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pix_local_vincular_na_finalizacao(
  p_empresa_id uuid,
  p_venda_id uuid,
  p_pagamentos jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_pagamento jsonb;
  v_recebimento_id uuid;
  v_valor numeric;
  v_forma_id uuid;
  v_pagamento_id uuid;
  v_modo text;
BEGIN
  PERFORM set_config('ultrapdv.pix_local_write', '1', true);
  PERFORM public.pix_local_validar_na_finalizacao(
    p_empresa_id,
    p_pagamentos,
    p_venda_id
  );

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_pagamentos, '[]'::jsonb))
  LOOP
    v_recebimento_id :=
      NULLIF(btrim(COALESCE(
        v_pagamento ->> 'pix_local_recebimento_id',
        v_pagamento ->> 'pix_geranet_cobranca_id'
      )), '')::uuid;
    v_forma_id :=
      NULLIF(btrim(v_pagamento ->> 'forma_pagamento_id'), '')::uuid;
    v_valor := NULLIF(v_pagamento ->> 'valor', '')::numeric;

    IF v_recebimento_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.modo_pix
    INTO v_modo
    FROM public.cobrancas_pix AS c
    WHERE c.id = v_recebimento_id
      AND c.empresa_id = p_empresa_id;

    IF v_modo IS DISTINCT FROM 'local_manual' THEN
      CONTINUE;
    END IF;

    SELECT vp.id
    INTO v_pagamento_id
    FROM public.vendas_pagamentos AS vp
    WHERE vp.empresa_id = p_empresa_id
      AND vp.venda_id = p_venda_id
      AND vp.forma_pagamento_id = v_forma_id
      AND vp.valor = v_valor
      AND NOT EXISTS (
        SELECT 1
        FROM public.cobrancas_pix AS usada
        WHERE usada.venda_pagamento_id = vp.id
      )
    ORDER BY vp.created_at
    LIMIT 1;

    UPDATE public.cobrancas_pix
    SET
      status = 'vinculado_venda',
      venda_id = p_venda_id,
      venda_pagamento_id = v_pagamento_id,
      updated_at = now()
    WHERE id = v_recebimento_id
      AND empresa_id = p_empresa_id
      AND (
        (
          status = 'confirmado_manual'
          AND venda_id IS NULL
        )
        OR (
          status = 'vinculado_venda'
          AND venda_id = p_venda_id
        )
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não foi possível vincular o PIX Local à venda.';
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pix_geranet_validar_na_finalizacao(
  p_empresa_id uuid,
  p_pagamentos jsonb,
  p_venda_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_pagamento jsonb;
  v_recebimento_id uuid;
  v_valor numeric;
  v_forma_id uuid;
  v_cobranca record;
  v_modo text;
BEGIN
  SELECT modo
  INTO v_modo
  FROM public.integracoes_pix
  WHERE empresa_id = p_empresa_id
    AND ativo = true;

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_pagamentos, '[]'::jsonb))
  LOOP
    BEGIN
      v_recebimento_id :=
        NULLIF(btrim(COALESCE(
          v_pagamento ->> 'pix_local_recebimento_id',
          v_pagamento ->> 'pix_geranet_cobranca_id'
        )), '')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Identificador da cobrança PIX inválido.';
    END;

    BEGIN
      v_forma_id :=
        NULLIF(btrim(v_pagamento ->> 'forma_pagamento_id'), '')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'forma_pagamento_id inválido.';
    END;

    v_valor := NULLIF(v_pagamento ->> 'valor', '')::numeric;

    IF v_recebimento_id IS NULL THEN
      IF COALESCE(v_modo, '') = 'geranet'
         AND EXISTS (
           SELECT 1
           FROM public.formas_pagamento AS fp
           WHERE fp.empresa_id = p_empresa_id
             AND fp.id = v_forma_id
             AND fp.ativo = true
             AND public.forma_pagamento_eh_pix(fp.codigo, fp.tipo, fp.nome)
             AND fp.permite_fiado = false
         )
      THEN
        RAISE EXCEPTION 'Aguardando confirmação do pagamento PIX.';
      END IF;

      CONTINUE;
    END IF;

    SELECT
      c.id,
      c.empresa_id,
      c.status,
      c.modo_pix,
      c.venda_id,
      c.valor,
      c.txid,
      c.provedor
    INTO v_cobranca
    FROM public.cobrancas_pix AS c
    WHERE c.id = v_recebimento_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cobrança PIX não encontrada.';
    END IF;

    IF v_cobranca.empresa_id <> p_empresa_id THEN
      RAISE EXCEPTION 'Recurso PIX pertence a outra empresa.';
    END IF;

    IF v_cobranca.modo_pix = 'local_manual' THEN
      CONTINUE;
    END IF;

    IF v_cobranca.modo_pix IS DISTINCT FROM 'geranet' THEN
      RAISE EXCEPTION 'Este recebimento não é um PIX Geranet.';
    END IF;

    IF v_cobranca.venda_id IS NOT NULL
       AND (
         p_venda_id IS NULL
         OR v_cobranca.venda_id IS DISTINCT FROM p_venda_id
       ) THEN
      RAISE EXCEPTION 'Este PIX já foi utilizado em outra venda.';
    END IF;

    IF v_cobranca.status = 'vinculado_venda'
       AND p_venda_id IS NOT NULL
       AND v_cobranca.venda_id = p_venda_id THEN
      CONTINUE;
    END IF;

    IF v_cobranca.status = 'divergencia_valor' THEN
      RAISE EXCEPTION
        'PIX recebido com valor divergente. Verifique antes de continuar.';
    END IF;

    IF v_cobranca.status IS DISTINCT FROM 'paga' THEN
      RAISE EXCEPTION 'Aguardando confirmação do pagamento PIX.';
    END IF;

    IF v_cobranca.txid IS NULL OR btrim(v_cobranca.txid) = '' THEN
      RAISE EXCEPTION 'Cobrança PIX sem TXID não pode finalizar a venda.';
    END IF;

    IF v_cobranca.valor IS DISTINCT FROM v_valor THEN
      RAISE EXCEPTION
        'O valor do PIX pago deve ser igual ao pagamento.';
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pix_geranet_vincular_na_finalizacao(
  p_empresa_id uuid,
  p_venda_id uuid,
  p_pagamentos jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_pagamento jsonb;
  v_recebimento_id uuid;
  v_valor numeric;
  v_forma_id uuid;
  v_pagamento_id uuid;
  v_modo text;
BEGIN
  PERFORM public.pix_geranet_validar_na_finalizacao(
    p_empresa_id,
    p_pagamentos,
    p_venda_id
  );

  FOR v_pagamento IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_pagamentos, '[]'::jsonb))
  LOOP
    v_recebimento_id :=
      NULLIF(btrim(COALESCE(
        v_pagamento ->> 'pix_local_recebimento_id',
        v_pagamento ->> 'pix_geranet_cobranca_id'
      )), '')::uuid;
    v_forma_id :=
      NULLIF(btrim(v_pagamento ->> 'forma_pagamento_id'), '')::uuid;
    v_valor := NULLIF(v_pagamento ->> 'valor', '')::numeric;

    IF v_recebimento_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.modo_pix
    INTO v_modo
    FROM public.cobrancas_pix AS c
    WHERE c.id = v_recebimento_id
      AND c.empresa_id = p_empresa_id;

    IF v_modo IS DISTINCT FROM 'geranet' THEN
      CONTINUE;
    END IF;

    SELECT vp.id
    INTO v_pagamento_id
    FROM public.vendas_pagamentos AS vp
    WHERE vp.empresa_id = p_empresa_id
      AND vp.venda_id = p_venda_id
      AND vp.forma_pagamento_id = v_forma_id
      AND vp.valor = v_valor
      AND NOT EXISTS (
        SELECT 1
        FROM public.cobrancas_pix AS usada
        WHERE usada.venda_pagamento_id = vp.id
      )
    ORDER BY vp.created_at
    LIMIT 1;

    UPDATE public.cobrancas_pix
    SET
      status = 'vinculado_venda',
      venda_id = p_venda_id,
      venda_pagamento_id = v_pagamento_id,
      updated_at = now()
    WHERE id = v_recebimento_id
      AND empresa_id = p_empresa_id
      AND (
        (
          status = 'paga'
          AND venda_id IS NULL
        )
        OR (
          status = 'vinculado_venda'
          AND venda_id = p_venda_id
        )
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não foi possível vincular o PIX Geranet à venda.';
    END IF;
  END LOOP;
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
BEGIN
  IF COALESCE(jsonb_typeof(p_itens), '') <> 'array' THEN
    RAISE EXCEPTION 'Itens da venda devem ser um array.';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_itens)
  LOOP
    v_itens_sanitizados :=
      v_itens_sanitizados || jsonb_build_array(v_item - 'valor_unitario');
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

GRANT EXECUTE ON FUNCTION public.pix_geranet_validar_na_finalizacao(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pix_geranet_vincular_na_finalizacao(uuid, uuid, jsonb) TO authenticated;

COMMIT;
