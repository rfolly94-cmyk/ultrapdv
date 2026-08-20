BEGIN;

CREATE OR REPLACE FUNCTION public.garantir_forma_pix_unica_empresa(
  p_empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ordem integer;
BEGIN
  IF p_empresa_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.formas_pagamento
  SET
    ativo = false,
    updated_at = now()
  WHERE empresa_id = p_empresa_id
    AND ativo = true
    AND codigo IN ('PIX_DINAMICO', 'PIX_ESTATICO');

  SELECT COALESCE(MIN(ordem), 20)
  INTO v_ordem
  FROM public.formas_pagamento
  WHERE empresa_id = p_empresa_id
    AND codigo IN ('PIX', 'PIX_DINAMICO', 'PIX_ESTATICO');

  INSERT INTO public.formas_pagamento (
    empresa_id,
    codigo,
    nome,
    tipo,
    codigo_fiscal,
    permite_parcelamento,
    permite_troco,
    permite_fiado,
    movimenta_caixa,
    gera_conta_receber,
    ordem,
    ativo
  )
  SELECT
    p_empresa_id,
    'PIX',
    'PIX',
    'PIX',
    '20',
    false,
    false,
    false,
    true,
    false,
    v_ordem,
    true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.formas_pagamento AS fp
    WHERE fp.empresa_id = p_empresa_id
      AND fp.codigo = 'PIX'
  );

  UPDATE public.formas_pagamento
  SET
    ativo = true,
    nome = 'PIX',
    tipo = 'PIX',
    updated_at = now()
  WHERE empresa_id = p_empresa_id
    AND codigo = 'PIX'
    AND ativo IS DISTINCT FROM true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_empresas_garantir_forma_pix_unica()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.garantir_forma_pix_unica_empresa(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_empresas_garantir_forma_pix_unica ON public.empresas;

CREATE TRIGGER zzz_empresas_garantir_forma_pix_unica
AFTER INSERT ON public.empresas
FOR EACH ROW
EXECUTE FUNCTION public.trg_empresas_garantir_forma_pix_unica();

DO $migrate$
DECLARE
  v_empresa record;
BEGIN
  FOR v_empresa IN
    SELECT id
    FROM public.empresas
  LOOP
    PERFORM public.garantir_forma_pix_unica_empresa(v_empresa.id);
  END LOOP;
END;
$migrate$;

REVOKE ALL ON FUNCTION public.garantir_forma_pix_unica_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.garantir_forma_pix_unica_empresa(uuid) TO service_role;

COMMIT;
