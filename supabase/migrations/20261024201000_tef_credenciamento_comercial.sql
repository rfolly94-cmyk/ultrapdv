-- Identificação e comprovação comercial do motor C# por empresa.
-- Não guarda senha técnica, ponto de captura nem servidor.
-- Preencher a referência não marca credenciamento_comprovado.

BEGIN;

ALTER TABLE public.tef_motor_empresas
  ADD COLUMN IF NOT EXISTS provedor text NOT NULL DEFAULT 'PayGo',
  ADD COLUMN IF NOT EXISTS referencia_credenciamento text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS situacao_validacao text NOT NULL DEFAULT 'nao_informado',
  ADD COLUMN IF NOT EXISTS comprovado_por uuid,
  ADD COLUMN IF NOT EXISTS comprovado_em timestamptz;

ALTER TABLE public.tef_motor_empresas
  DROP CONSTRAINT IF EXISTS tef_motor_empresas_situacao_validacao_check;

ALTER TABLE public.tef_motor_empresas
  ADD CONSTRAINT tef_motor_empresas_situacao_validacao_check
  CHECK (situacao_validacao IN ('nao_informado', 'informado', 'comprovado'));

CREATE TABLE IF NOT EXISTS public.tef_motor_credenciamento_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  usuario_id uuid NOT NULL,
  acao text NOT NULL,
  provedor text NOT NULL,
  referencia text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_motor_credenciamento_auditoria_acao_check
    CHECK (acao = 'comprovacao_registrada')
);

COMMENT ON TABLE public.tef_motor_credenciamento_auditoria IS
  'Quem registrou a comprovação comercial do TEF e quando. Sem senha, ponto ou servidor.';

ALTER TABLE public.tef_motor_credenciamento_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_motor_credenciamento_auditoria_select ON public.tef_motor_credenciamento_auditoria;
CREATE POLICY tef_motor_credenciamento_auditoria_select
  ON public.tef_motor_credenciamento_auditoria
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_motor_credenciamento_auditoria FROM anon, authenticated;
GRANT SELECT ON public.tef_motor_credenciamento_auditoria TO authenticated;
GRANT SELECT, INSERT ON public.tef_motor_credenciamento_auditoria TO service_role;

COMMIT;
