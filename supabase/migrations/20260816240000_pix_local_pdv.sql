BEGIN;

-- PIX Local no PDV: reutiliza cobrancas_pix de forma aditiva.
-- Não altera status Geranet existentes (pendente/paga/cancelada/erro/expirada).

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS modo_pix text;

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS confirmado_manualmente boolean NOT NULL DEFAULT false;

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS confirmado_por uuid;

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS confirmado_em timestamptz;

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS venda_pagamento_id uuid;

ALTER TABLE public.cobrancas_pix
  DROP CONSTRAINT IF EXISTS cobrancas_pix_modo_pix_check;

ALTER TABLE public.cobrancas_pix
  ADD CONSTRAINT cobrancas_pix_modo_pix_check
  CHECK (modo_pix IS NULL OR modo_pix IN ('local_manual', 'geranet'));

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
      'aguardando_confirmacao',
      'confirmado_manual',
      'vinculado_venda',
      'descartado'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_cobrancas_pix_venda_pagamento
  ON public.cobrancas_pix (venda_pagamento_id)
  WHERE venda_pagamento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_cobrancas_pix_modo_status
  ON public.cobrancas_pix (empresa_id, modo_pix, status);

COMMENT ON COLUMN public.cobrancas_pix.modo_pix IS
  'local_manual: QR estático + confirmação manual. geranet: integração bancária.';

COMMENT ON COLUMN public.cobrancas_pix.confirmado_por IS
  'Usuário autenticado que confirmou o PIX Local. Nunca aceitar do browser.';

-- Impede que o cliente autenticado grave confirmado_por / confirmado_em.
CREATE OR REPLACE FUNCTION public.cobrancas_pix_proteger_confirmacao()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.confirmado_por IS DISTINCT FROM OLD.confirmado_por
       OR NEW.confirmado_em IS DISTINCT FROM OLD.confirmado_em
       OR NEW.confirmado_manualmente IS DISTINCT FROM OLD.confirmado_manualmente
     )
     AND current_setting('request.jwt.claim.role', true) = 'authenticated'
     AND current_setting('ultrapdv.pix_local_write', true) IS DISTINCT FROM '1'
  THEN
    RAISE EXCEPTION
      'Confirmação PIX Local só pode ser registrada pelo servidor.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cobrancas_pix_proteger_confirmacao
  ON public.cobrancas_pix;

CREATE TRIGGER trg_cobrancas_pix_proteger_confirmacao
BEFORE UPDATE ON public.cobrancas_pix
FOR EACH ROW
EXECUTE FUNCTION public.cobrancas_pix_proteger_confirmacao();

CREATE OR REPLACE FUNCTION public.forma_pagamento_eh_pix(
  p_codigo text,
  p_tipo text,
  p_nome text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT concat_ws(' ', lower(coalesce(p_codigo, '')), lower(coalesce(p_tipo, '')), lower(coalesce(p_nome, '')))
    LIKE '%pix%';
$function$;

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
        NULLIF(btrim(v_pagamento ->> 'pix_local_recebimento_id'), '')::uuid;
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
      NULLIF(btrim(v_pagamento ->> 'pix_local_recebimento_id'), '')::uuid;
    v_forma_id :=
      NULLIF(btrim(v_pagamento ->> 'forma_pagamento_id'), '')::uuid;
    v_valor := NULLIF(v_pagamento ->> 'valor', '')::numeric;

    IF v_recebimento_id IS NULL THEN
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
      || jsonb_build_array(v_pagamento - 'pix_local_recebimento_id');
  END LOOP;

  IF v_tem_fiado AND p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Pagamento fiado exige cliente.';
  END IF;

  PERFORM public.pix_local_validar_na_finalizacao(
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

GRANT EXECUTE ON FUNCTION public.forma_pagamento_eh_pix(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pix_local_validar_na_finalizacao(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pix_local_vincular_na_finalizacao(uuid, uuid, jsonb) TO authenticated;

COMMIT;
