-- Habilitação comercial do motor C# por empresa.
-- A declaração do servidor e o retorno nativo do PinPad não autorizam pagamento.
-- producao_autorizada continua falsa até a avaliação explícita do administrador.
-- Não grava senha técnica, ponto de captura nem o texto do comprovante.

BEGIN;

ALTER TABLE public.tef_motor_empresas
  ADD COLUMN IF NOT EXISTS servidor_comercial text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS servidor_comercial_validado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS servidor_validado_em timestamptz,
  ADD COLUMN IF NOT EXISTS servidor_validado_por uuid,
  ADD COLUMN IF NOT EXISTS servidor_validado_terminal uuid;

COMMENT ON COLUMN public.tef_motor_empresas.servidor_comercial IS
  'Endereço comercial declarado pelo administrador, em host:porta. A declaração sozinha não valida a produção.';

COMMENT ON COLUMN public.tef_motor_empresas.servidor_comercial_validado IS
  'Verdadeiro somente depois que a biblioteca confirmou o endereço declarado. Não autoriza pagamento.';

CREATE TABLE IF NOT EXISTS public.tef_motor_pinpad_producao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  terminal_id uuid NOT NULL,
  dispositivo_id uuid NOT NULL,
  journal_instalacao text NOT NULL,
  codigo_nativo smallint NOT NULL,
  aprovado boolean NOT NULL DEFAULT false,
  aprovado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_motor_pinpad_producao_aprovado_check
    CHECK (aprovado = (codigo_nativo = 0)),
  CONSTRAINT tef_motor_pinpad_producao_journal_check
    CHECK (NOT aprovado OR length(journal_instalacao) > 0)
);

COMMENT ON TABLE public.tef_motor_pinpad_producao IS
  'Resultado nativo do teste de PinPad no ponto de produção. Aprovado somente com retorno 0, preso à instalação, ao terminal e ao dispositivo.';

CREATE INDEX IF NOT EXISTS tef_motor_pinpad_producao_empresa_idx
  ON public.tef_motor_pinpad_producao (empresa_id, created_at DESC);

ALTER TABLE public.tef_motor_pinpad_producao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_motor_pinpad_producao_select ON public.tef_motor_pinpad_producao;
CREATE POLICY tef_motor_pinpad_producao_select
  ON public.tef_motor_pinpad_producao
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_motor_pinpad_producao FROM anon, authenticated;
GRANT SELECT ON public.tef_motor_pinpad_producao TO authenticated;
GRANT SELECT, INSERT ON public.tef_motor_pinpad_producao TO service_role;

CREATE TABLE IF NOT EXISTS public.tef_motor_producao_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  usuario_id uuid NOT NULL,
  terminal_id uuid,
  dispositivo_id uuid,
  acao text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_motor_producao_auditoria_acao_check
    CHECK (acao IN ('servidor_declarado', 'servidor_validado', 'pinpad_registrado', 'producao_autorizada'))
);

COMMENT ON TABLE public.tef_motor_producao_auditoria IS
  'Quem declarou, validou ou autorizou a produção, em qual empresa, terminal e horário. Sem senha, ponto ou endereço.';

ALTER TABLE public.tef_motor_producao_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_motor_producao_auditoria_select ON public.tef_motor_producao_auditoria;
CREATE POLICY tef_motor_producao_auditoria_select
  ON public.tef_motor_producao_auditoria
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_motor_producao_auditoria FROM anon, authenticated;
GRANT SELECT ON public.tef_motor_producao_auditoria TO authenticated;
GRANT SELECT, INSERT ON public.tef_motor_producao_auditoria TO service_role;

COMMIT;
