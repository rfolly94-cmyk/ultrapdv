-- Perfil de homologação por empresa.
-- Não copia CNPJ, ponto ou servidor já gravados.
-- Não altera o Connector nem executa instalação.

BEGIN;

ALTER TABLE public.tef_configuracoes
  ADD COLUMN IF NOT EXISTS cnpj_instalacao text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ponto_homologacao text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_configuracoes_cnpj_instalacao_check'
  ) THEN
    ALTER TABLE public.tef_configuracoes
      ADD CONSTRAINT tef_configuracoes_cnpj_instalacao_check
      CHECK (cnpj_instalacao = '' OR cnpj_instalacao ~ '^[0-9]{14}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_configuracoes_ponto_homologacao_check'
  ) THEN
    ALTER TABLE public.tef_configuracoes
      ADD CONSTRAINT tef_configuracoes_ponto_homologacao_check
      CHECK (ponto_homologacao = '' OR ponto_homologacao ~ '^[A-Za-z0-9._-]{1,40}$');
  END IF;
END $$;

COMMENT ON COLUMN public.tef_configuracoes.cnpj_instalacao IS
  'CNPJ informado na tela de TEF para a instalação. Não é copiado do cadastro da empresa.';

COMMENT ON COLUMN public.tef_configuracoes.ponto_homologacao IS
  'Ponto de captura do ambiente de homologação. Não substitui o ponto de produção.';

COMMIT;
