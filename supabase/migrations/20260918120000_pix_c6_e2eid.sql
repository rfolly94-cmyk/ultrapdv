BEGIN;

-- PIX C6: e2eid em coluna própria, UNIQUE por empresa.
-- Sem backfill de dados_publicos.e2eid para evitar colisão em cobranças antigas.

ALTER TABLE public.cobrancas_pix
  ADD COLUMN IF NOT EXISTS e2eid text;

COMMENT ON COLUMN public.cobrancas_pix.e2eid IS
  'endToEndId autoritativo do PIX C6. Preenchido só após GET CONCLUIDA com valor e e2eid válidos. Sem backfill automático de dados_publicos.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_cobrancas_pix_empresa_e2eid
  ON public.cobrancas_pix (empresa_id, e2eid)
  WHERE e2eid IS NOT NULL AND btrim(e2eid) <> '';

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
      c.valor_pago,
      c.txid,
      c.e2eid,
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

    IF lower(btrim(COALESCE(v_cobranca.provedor, ''))) = 'c6bank' THEN
      IF v_cobranca.e2eid IS NULL OR btrim(v_cobranca.e2eid) = '' THEN
        RAISE EXCEPTION
          'Cobrança PIX C6 sem e2eid não pode finalizar a venda.';
      END IF;

      IF v_cobranca.valor_pago IS NULL THEN
        RAISE EXCEPTION
          'Cobrança PIX C6 sem valor pago não pode finalizar a venda.';
      END IF;

      IF v_cobranca.valor_pago IS DISTINCT FROM v_cobranca.valor
         OR v_cobranca.valor_pago IS DISTINCT FROM v_valor THEN
        RAISE EXCEPTION
          'O valor do PIX pago deve ser igual ao pagamento.';
      END IF;
    END IF;
  END LOOP;
END;
$function$;

COMMIT;
