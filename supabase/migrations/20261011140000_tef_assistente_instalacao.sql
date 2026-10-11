-- Andamento do assistente TEF PayGoWeb, por empresa.
-- Não aplicar automaticamente.
-- Não guarda senha, PAN, PIN, certificado, CSC nem segredo do PayGoWeb.
-- Adquirentes só entram quando a aplicação gravar as informadas. A lista nasce vazia.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_instalacoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas (id),
  etapa text NOT NULL DEFAULT 'credenciamento',
  credenciamento_confirmado boolean NOT NULL DEFAULT false,
  ambiente_autorizado text NOT NULL DEFAULT 'homologacao',
  ponto_captura text NOT NULL DEFAULT '',
  estabelecimento text NOT NULL DEFAULT '',
  parametros_oficiais text NOT NULL DEFAULT '',
  adquirentes text[] NOT NULL DEFAULT '{}',
  pinpad_exigido boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_instalacoes_etapa_check
    CHECK (etapa IN (
      'credenciamento',
      'connector',
      'pinpad',
      'vinculacao',
      'validacao',
      'ativacao'
    )),
  CONSTRAINT tef_instalacoes_ambiente_check
    CHECK (ambiente_autorizado IN ('homologacao', 'producao')),
  CONSTRAINT tef_instalacoes_ponto_check
    CHECK (ponto_captura = '' OR ponto_captura ~ '^[A-Za-z0-9._-]{1,40}$'),
  CONSTRAINT tef_instalacoes_estabelecimento_check
    CHECK (char_length(estabelecimento) <= 40),
  CONSTRAINT tef_instalacoes_parametros_check
    CHECK (char_length(parametros_oficiais) <= 500)
);

COMMENT ON TABLE public.tef_instalacoes IS
  'Rascunho do assistente TEF da empresa. Sem senha e sem credencial técnica do PayGoWeb.';

COMMENT ON COLUMN public.tef_instalacoes.adquirentes IS
  'Nomes informados pelo PayGoWeb. Lista vazia não presume adquirente.';

COMMENT ON COLUMN public.tef_instalacoes.parametros_oficiais IS
  'Texto público de instalação. A aplicação recusa senha e segredo.';

ALTER TABLE public.tef_instalacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_instalacoes_select_empresa ON public.tef_instalacoes;
CREATE POLICY tef_instalacoes_select_empresa
  ON public.tef_instalacoes
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_instalacoes FROM anon, authenticated;
GRANT SELECT ON public.tef_instalacoes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tef_instalacoes TO service_role;

COMMIT;
