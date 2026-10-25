-- TEF 2.0: motor único pgweb.
-- Não aplicar neste ambiente. Não publicar.
-- Copia credenciamento ainda vazio do rascunho do assistente para tef_configuracoes.
-- Não apaga operações, vendas, autorizações, comprovantes, auditoria nem evidências.
-- Não remove linhas nem tabelas financeiras.
-- tef_operacoes, tef_auditoria, tef_evidencias_instalacao e tef_validacoes_biblioteca permanecem.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tef_configuracoes') IS NULL THEN
    RAISE NOTICE 'tef_configuracoes ausente; migration não altera dados.';
    RETURN;
  END IF;

  ALTER TABLE public.tef_configuracoes
    ADD COLUMN IF NOT EXISTS motor text NOT NULL DEFAULT 'pgweb';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tef_configuracoes_motor_check'
  ) THEN
    ALTER TABLE public.tef_configuracoes
      ADD CONSTRAINT tef_configuracoes_motor_check
      CHECK (motor = 'pgweb');
  END IF;

  COMMENT ON COLUMN public.tef_configuracoes.motor IS
    'Motor único PayGo Integrado. Não há alternância com o agente ACBr.';

  IF to_regclass('public.tef_instalacoes') IS NOT NULL THEN
    UPDATE public.tef_configuracoes AS config
    SET
      ambiente = instalacao.ambiente_autorizado,
      estabelecimento = instalacao.estabelecimento,
      ponto_captura = instalacao.ponto_captura,
      updated_at = now()
    FROM public.tef_instalacoes AS instalacao
    WHERE instalacao.empresa_id = config.empresa_id
      AND config.ponto_captura = ''
      AND instalacao.ponto_captura <> '';

    INSERT INTO public.tef_configuracoes (
      empresa_id,
      habilitado,
      ambiente,
      estabelecimento,
      ponto_captura,
      motor
    )
    SELECT
      instalacao.empresa_id,
      false,
      instalacao.ambiente_autorizado,
      instalacao.estabelecimento,
      instalacao.ponto_captura,
      'pgweb'
    FROM public.tef_instalacoes AS instalacao
    WHERE instalacao.ponto_captura <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.tef_configuracoes AS config
        WHERE config.empresa_id = instalacao.empresa_id
      );
  END IF;
END $$;

COMMIT;
