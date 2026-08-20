BEGIN;

-- ============================================================
-- UltraPDV — IPI explícito (empresa + grupo fiscal)
-- Data: 2026-08-15
--
-- empresas_fiscal.perfil_ipi
--   NULL = não configurado (não assume NAO_CONTRIBUINTE)
--   NAO_CONTRIBUINTE | INDUSTRIAL | EQUIPARADO_INDUSTRIAL
--
-- grupos_fiscais
--   ipi_cst / ipi_aliquota já existem no cadastro
--   ipi_aplicavel = o grupo realmente gera grupo IPI na NF-e 55
--   ipi_enquadramento = cEnq (1 a 3 dígitos); nunca default 999
--
-- Default seguro:
--   perfil_ipi permanece NULL nas empresas existentes
--   ipi_aplicavel = false (não liga IPI só porque há CST antigo)
-- ============================================================

ALTER TABLE public.empresas_fiscal
  ADD COLUMN IF NOT EXISTS perfil_ipi text;

ALTER TABLE public.empresas_fiscal
  DROP CONSTRAINT IF EXISTS empresas_fiscal_perfil_ipi_check;

ALTER TABLE public.empresas_fiscal
  ADD CONSTRAINT empresas_fiscal_perfil_ipi_check
  CHECK (
    perfil_ipi IS NULL
    OR perfil_ipi IN (
      'NAO_CONTRIBUINTE',
      'INDUSTRIAL',
      'EQUIPARADO_INDUSTRIAL'
    )
  );

COMMENT ON COLUMN public.empresas_fiscal.perfil_ipi IS
  'Perfil explícito perante o IPI. NULL = pendente. Não inferir de CRT, CNAE ou tipo_atividade.';

ALTER TABLE public.grupos_fiscais
  ADD COLUMN IF NOT EXISTS ipi_aplicavel boolean NOT NULL DEFAULT false;

ALTER TABLE public.grupos_fiscais
  ADD COLUMN IF NOT EXISTS ipi_enquadramento text;

ALTER TABLE public.grupos_fiscais
  DROP CONSTRAINT IF EXISTS grupos_fiscais_ipi_enquadramento_check;

ALTER TABLE public.grupos_fiscais
  ADD CONSTRAINT grupos_fiscais_ipi_enquadramento_check
  CHECK (
    ipi_enquadramento IS NULL
    OR ipi_enquadramento ~ '^[0-9]{1,3}$'
  );

COMMENT ON COLUMN public.grupos_fiscais.ipi_aplicavel IS
  'Quando true, a NF-e 55 deste grupo pode gerar grupo IPI, se o emitente for industrial ou equiparado.';

COMMENT ON COLUMN public.grupos_fiscais.ipi_enquadramento IS
  'cEnq de 1 a 3 dígitos, conforme Anexo XIV.';

COMMIT;
