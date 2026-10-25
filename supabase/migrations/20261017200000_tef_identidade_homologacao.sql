-- Identidade criptográfica do Connector de homologação, por empresa e dispositivo.
-- Não aplicar automaticamente.
-- Guarda só a chave pública. A chave privada permanece no Connector de homologação.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_identidades_homologacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  terminal_id uuid NOT NULL REFERENCES public.tef_terminais (id),
  dispositivo_id uuid NOT NULL,
  chave_publica text NOT NULL,
  chave_id uuid NOT NULL,
  vinculada_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  CONSTRAINT tef_identidades_homologacao_chave_check
    CHECK (char_length(chave_publica) BETWEEN 80 AND 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tef_identidade_homologacao_ativa
  ON public.tef_identidades_homologacao (empresa_id, dispositivo_id)
  WHERE revogada_em IS NULL;

COMMENT ON TABLE public.tef_identidades_homologacao IS
  'Chave pública do Connector de homologação vinculada à empresa e ao dispositivo. Sem chave privada.';

ALTER TABLE public.tef_identidades_homologacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_identidades_homologacao_select_empresa ON public.tef_identidades_homologacao;
CREATE POLICY tef_identidades_homologacao_select_empresa
  ON public.tef_identidades_homologacao
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_identidades_homologacao FROM anon, authenticated;
GRANT SELECT ON public.tef_identidades_homologacao TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tef_identidades_homologacao TO service_role;

COMMIT;
