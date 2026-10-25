-- Configuração do motor UltraPDV.TEF por empresa.
-- Não guarda senha técnica, PAN, PIN, ponto nem servidor.
-- Produção nasce desautorizada.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_motor_empresas (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas (id),
  habilitado boolean NOT NULL DEFAULT false,
  ambiente text NOT NULL DEFAULT 'homologacao',
  producao_autorizada boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_motor_empresas_ambiente_check
    CHECK (ambiente IN ('homologacao', 'producao'))
);

COMMENT ON TABLE public.tef_motor_empresas IS
  'Habilitação e ambiente do motor C# por empresa. Sem credencial técnica.';

ALTER TABLE public.tef_motor_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_motor_empresas_select_empresa ON public.tef_motor_empresas;
CREATE POLICY tef_motor_empresas_select_empresa
  ON public.tef_motor_empresas
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_motor_empresas FROM anon, authenticated;
GRANT SELECT ON public.tef_motor_empresas TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tef_motor_empresas TO service_role;

COMMIT;
