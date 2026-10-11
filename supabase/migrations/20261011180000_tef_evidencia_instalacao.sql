-- Evidência assinada da instalação controlada do PayGoWeb, por empresa.
-- Não aplicar automaticamente.
-- Não guarda credencial, PAN, PIN, certificado, CSC nem segredo do PayGoWeb.
-- A assinatura Ed25519 registra a observação do Connector. Ela não certifica o PayGo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_evidencias_instalacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  dispositivo_id uuid NOT NULL,
  terminal_id uuid NOT NULL REFERENCES public.tef_terminais (id),
  instalacao_id uuid NOT NULL,
  ponto_captura text NOT NULL,
  estabelecimento text NOT NULL,
  ambiente text NOT NULL,
  origem text NOT NULL DEFAULT 'instalacao_controlada',
  assinatura text NOT NULL,
  registrada_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  motivo_revogacao text,
  CONSTRAINT tef_evidencias_instalacao_ambiente_check
    CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT tef_evidencias_instalacao_origem_check
    CHECK (origem = 'instalacao_controlada'),
  CONSTRAINT tef_evidencias_instalacao_ponto_check
    CHECK (ponto_captura ~ '^[A-Za-z0-9._-]{1,40}$'),
  CONSTRAINT tef_evidencias_instalacao_estabelecimento_check
    CHECK (char_length(estabelecimento) BETWEEN 1 AND 40),
  CONSTRAINT tef_evidencias_instalacao_assinatura_check
    CHECK (char_length(assinatura) BETWEEN 1 AND 200),
  CONSTRAINT tef_evidencias_instalacao_motivo_check
    CHECK (motivo_revogacao IS NULL OR char_length(motivo_revogacao) <= 200),
  CONSTRAINT tef_evidencias_instalacao_id_key UNIQUE (instalacao_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tef_evidencias_instalacao_dispositivo_ativo
  ON public.tef_evidencias_instalacao (empresa_id, dispositivo_id)
  WHERE revogada_em IS NULL;

COMMENT ON TABLE public.tef_evidencias_instalacao IS
  'Evidência da instalação controlada do ponto PayGoWeb. Sem credencial. A assinatura do Connector não certifica o PayGo.';

COMMENT ON COLUMN public.tef_evidencias_instalacao.origem IS
  'Somente instalacao_controlada é persistida. Ambiente declarado e desconhecido são calculados na consulta.';

COMMENT ON COLUMN public.tef_evidencias_instalacao.assinatura IS
  'Assinatura Ed25519 da mensagem ultrapdv-tef-instalacao-v1. Não é certificação da PayGo.';

ALTER TABLE public.tef_evidencias_instalacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_evidencias_instalacao_select_empresa ON public.tef_evidencias_instalacao;
CREATE POLICY tef_evidencias_instalacao_select_empresa
  ON public.tef_evidencias_instalacao
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_evidencias_instalacao FROM anon, authenticated;
GRANT SELECT ON public.tef_evidencias_instalacao TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tef_evidencias_instalacao TO service_role;

COMMIT;
