-- Modalidade pedida no PDV e modalidade lida de PWINFO_CARDTYPE.
-- Não reescreve operações já gravadas.

ALTER TABLE public.tef_operacoes
  ADD COLUMN IF NOT EXISTS modalidade_solicitada text,
  ADD COLUMN IF NOT EXISTS modalidade_efetiva text,
  ADD COLUMN IF NOT EXISTS tipo_cartao_paygo smallint;

ALTER TABLE public.tef_operacoes
  DROP CONSTRAINT IF EXISTS tef_operacoes_modalidade_solicitada_check;

ALTER TABLE public.tef_operacoes
  ADD CONSTRAINT tef_operacoes_modalidade_solicitada_check
  CHECK (
    modalidade_solicitada IS NULL
    OR modalidade_solicitada IN ('debito', 'credito')
  );

ALTER TABLE public.tef_operacoes
  DROP CONSTRAINT IF EXISTS tef_operacoes_modalidade_efetiva_check;

ALTER TABLE public.tef_operacoes
  ADD CONSTRAINT tef_operacoes_modalidade_efetiva_check
  CHECK (
    modalidade_efetiva IS NULL
    OR modalidade_efetiva IN ('debito', 'credito')
  );
