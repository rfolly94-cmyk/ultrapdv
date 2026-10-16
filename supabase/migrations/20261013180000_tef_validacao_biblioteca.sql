-- Validação da prova ultrapdv-tef-biblioteca-v2 já gravada pelo Connector.
-- Não aplicar automaticamente.
-- Não reinstala o PayGoWeb e não converte esta prova na evidência v1.
-- A assinatura não inclui empresa nem dispositivo. O vínculo é a chave do terminal.
-- Não libera cobrança nem NFC-e de produção.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_validacoes_biblioteca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  dispositivo_id uuid NOT NULL,
  terminal_id uuid NOT NULL REFERENCES public.tef_terminais (id),
  ponto_captura text NOT NULL,
  servidor text NOT NULL,
  ambiente text NOT NULL,
  diretorio text NOT NULL,
  retorno_set_environment integer NOT NULL,
  codigo_ambiente integer NOT NULL,
  assinatura_sha256 text NOT NULL,
  assinatura text NOT NULL,
  validado_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  CONSTRAINT tef_validacoes_biblioteca_ambiente_check
    CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT tef_validacoes_biblioteca_diretorio_check
    CHECK (diretorio IN ('producao', 'sandbox')),
  CONSTRAINT tef_validacoes_biblioteca_retorno_check
    CHECK (retorno_set_environment = 0),
  CONSTRAINT tef_validacoes_biblioteca_codigo_check
    CHECK (codigo_ambiente = 0),
  CONSTRAINT tef_validacoes_biblioteca_hash_check
    CHECK (assinatura_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tef_validacoes_biblioteca_assinatura_check
    CHECK (char_length(assinatura) BETWEEN 80 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tef_validacoes_biblioteca_terminal_ativo
  ON public.tef_validacoes_biblioteca (empresa_id, terminal_id)
  WHERE revogada_em IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tef_validacoes_biblioteca_assinatura_ativa
  ON public.tef_validacoes_biblioteca (assinatura_sha256)
  WHERE revogada_em IS NULL;

COMMENT ON TABLE public.tef_validacoes_biblioteca IS
  'Auditoria da prova v2 da biblioteca. Não é evidência v1 e não habilita a adquirente.';

ALTER TABLE public.tef_validacoes_biblioteca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_validacoes_biblioteca_select_empresa ON public.tef_validacoes_biblioteca;
CREATE POLICY tef_validacoes_biblioteca_select_empresa
  ON public.tef_validacoes_biblioteca
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_validacoes_biblioteca FROM anon, authenticated;
GRANT SELECT ON public.tef_validacoes_biblioteca TO authenticated;
GRANT SELECT, INSERT ON public.tef_validacoes_biblioteca TO service_role;

COMMIT;
