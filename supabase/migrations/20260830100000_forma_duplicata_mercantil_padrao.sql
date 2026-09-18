BEGIN;

-- UltraPDV: Duplicata Mercantil (tPag 14) nas formas de pagamento da empresa.
-- Reutiliza public.formas_pagamento. Busca pelo código fiscal 14, não pelo nome.
-- Mesmo mecanismo incremental de garantir_forma_pix_unica_empresa
-- (complementa inserir_formas_pagamento_padrao, sem tabela nova).

CREATE OR REPLACE FUNCTION public.garantir_forma_duplicata_mercantil_empresa(
  p_empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_ordem integer;
BEGIN
  IF p_empresa_id IS NULL THEN
    RETURN;
  END IF;

  SELECT fp.id
  INTO v_id
  FROM public.formas_pagamento AS fp
  WHERE fp.empresa_id = p_empresa_id
    AND btrim(COALESCE(fp.codigo_fiscal, '')) = '14'
    AND COALESCE(fp.permite_fiado, false) = false
  ORDER BY
    CASE WHEN fp.ativo THEN 0 ELSE 1 END,
    fp.ordem NULLS LAST,
    fp.id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.formas_pagamento
    SET
      ativo = true,
      codigo_fiscal = '14',
      permite_fiado = false,
      permite_troco = false,
      updated_at = now()
    WHERE id = v_id
      AND empresa_id = p_empresa_id
      AND (
        ativo IS DISTINCT FROM true
        OR btrim(COALESCE(codigo_fiscal, '')) IS DISTINCT FROM '14'
        OR COALESCE(permite_fiado, false) IS DISTINCT FROM false
      );
    RETURN;
  END IF;

  SELECT COALESCE(MAX(ordem), 80) + 10
  INTO v_ordem
  FROM public.formas_pagamento
  WHERE empresa_id = p_empresa_id;

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
    'DUPLICATA_MERCANTIL',
    'Duplicata Mercantil',
    'OUTROS',
    '14',
    true,
    false,
    false,
    false,
    false,
    v_ordem,
    true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.formas_pagamento AS fp
    WHERE fp.empresa_id = p_empresa_id
      AND (
        (
          btrim(COALESCE(fp.codigo_fiscal, '')) = '14'
          AND COALESCE(fp.permite_fiado, false) = false
        )
        OR upper(btrim(COALESCE(fp.codigo, ''))) = 'DUPLICATA_MERCANTIL'
      )
  );

  UPDATE public.formas_pagamento
  SET
    ativo = true,
    codigo_fiscal = '14',
    permite_fiado = false,
    permite_troco = false,
    updated_at = now()
  WHERE empresa_id = p_empresa_id
    AND upper(btrim(COALESCE(codigo, ''))) = 'DUPLICATA_MERCANTIL'
    AND COALESCE(permite_fiado, false) = false
    AND (
      ativo IS DISTINCT FROM true
      OR btrim(COALESCE(codigo_fiscal, '')) IS DISTINCT FROM '14'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_empresas_garantir_forma_duplicata_mercantil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.garantir_forma_duplicata_mercantil_empresa(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_empresas_garantir_forma_duplicata_mercantil
  ON public.empresas;

CREATE TRIGGER zzz_empresas_garantir_forma_duplicata_mercantil
AFTER INSERT ON public.empresas
FOR EACH ROW
EXECUTE FUNCTION public.trg_empresas_garantir_forma_duplicata_mercantil();

DO $migrate$
DECLARE
  v_empresa record;
BEGIN
  FOR v_empresa IN
    SELECT id
    FROM public.empresas
  LOOP
    PERFORM public.garantir_forma_duplicata_mercantil_empresa(v_empresa.id);
  END LOOP;
END;
$migrate$;

REVOKE ALL ON FUNCTION public.garantir_forma_duplicata_mercantil_empresa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garantir_forma_duplicata_mercantil_empresa(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.garantir_forma_duplicata_mercantil_empresa(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.garantir_forma_duplicata_mercantil_empresa(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.trg_empresas_garantir_forma_duplicata_mercantil() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_empresas_garantir_forma_duplicata_mercantil() FROM anon;
REVOKE ALL ON FUNCTION public.trg_empresas_garantir_forma_duplicata_mercantil() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trg_empresas_garantir_forma_duplicata_mercantil() TO service_role;

COMMIT;
