-- CNPJ de produção informado na tela de TEF.
-- Não copia o CNPJ do cadastro, o CNPJ de homologação nem o CNPJ já gravado no terminal.
-- ponto_captura, servidor_producao e tef_terminais.cnpj permanecem para a transição
-- e não são fallback da homologação.

BEGIN;

ALTER TABLE public.tef_configuracoes
  ADD COLUMN IF NOT EXISTS cnpj_producao text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_configuracoes_cnpj_producao_check'
  ) THEN
    ALTER TABLE public.tef_configuracoes
      ADD CONSTRAINT tef_configuracoes_cnpj_producao_check
      CHECK (cnpj_producao = '' OR cnpj_producao ~ '^[0-9]{14}$');
  END IF;
END $$;

COMMENT ON COLUMN public.tef_configuracoes.cnpj_producao IS
  'CNPJ de instalação do ambiente de produção, informado na tela de TEF. A remoção do CNPJ legado do terminal fica para uma etapa posterior.';

COMMIT;
