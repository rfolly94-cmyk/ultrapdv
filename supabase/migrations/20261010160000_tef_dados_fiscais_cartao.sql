-- Dados fiscais reais devolvidos pelo PayGoWeb para a NFC-e.
-- Não preenche CNPJ, bandeira nem autorização.
-- Não aplicar automaticamente neste fluxo.

ALTER TABLE public.tef_operacoes
  ADD COLUMN IF NOT EXISTS bandeira_nome text,
  ADD COLUMN IF NOT EXISTS cnpj_credenciadora text,
  ADD COLUMN IF NOT EXISTS cnpj_recebedor text,
  ADD COLUMN IF NOT EXISTS instituicao text;

ALTER TABLE public.tef_operacoes
  DROP CONSTRAINT IF EXISTS tef_operacoes_cnpj_credenciadora_check;

ALTER TABLE public.tef_operacoes
  ADD CONSTRAINT tef_operacoes_cnpj_credenciadora_check
  CHECK (cnpj_credenciadora IS NULL OR cnpj_credenciadora ~ '^[0-9]{14}$');

ALTER TABLE public.tef_operacoes
  DROP CONSTRAINT IF EXISTS tef_operacoes_cnpj_recebedor_check;

ALTER TABLE public.tef_operacoes
  ADD CONSTRAINT tef_operacoes_cnpj_recebedor_check
  CHECK (cnpj_recebedor IS NULL OR cnpj_recebedor ~ '^[0-9]{14}$');
