-- Credenciamento comercial do motor C#, sem senha, ponto ou servidor.
-- Nasce falso. A aplicação não marca este campo como verdadeiro.

BEGIN;

ALTER TABLE public.tef_motor_empresas
  ADD COLUMN IF NOT EXISTS credenciamento_comprovado boolean NOT NULL DEFAULT false;

COMMIT;
