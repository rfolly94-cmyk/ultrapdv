-- Servidor PayGoWeb autorizado por empresa e por ambiente.
-- Não aplicar automaticamente.
-- Homologação e produção ficam em colunas separadas. Uma não preenche a outra.
-- Não guarda senha, PAN, PIN, certificado, CSC nem credencial técnica.
-- Colunas novas nascem vazias. Empresa com TEF já habilitado permanece sem servidor gravado.

BEGIN;

CREATE OR REPLACE FUNCTION public.tef_servidor_paygo_valido(valor text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    valor IS NULL
    OR btrim(valor) = ''
    OR (
      char_length(btrim(valor)) BETWEEN 3 AND 200
      AND btrim(valor) !~ '[[:space:]]'
      AND position('://' in btrim(valor)) = 0
      AND btrim(valor) ~ '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$'
      AND split_part(btrim(valor), ':', 1) !~ '\.\.'
      AND split_part(btrim(valor), ':', 2)::integer BETWEEN 1 AND 65535
    );
$$;

COMMENT ON FUNCTION public.tef_servidor_paygo_valido(text) IS
  'Aceita vazio ou host:porta. Não escolhe endereço e não abre conexão.';

REVOKE ALL ON FUNCTION public.tef_servidor_paygo_valido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tef_servidor_paygo_valido(text) TO service_role;

ALTER TABLE public.tef_configuracoes
  ADD COLUMN IF NOT EXISTS servidor_homologacao text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS servidor_producao text NOT NULL DEFAULT '';

ALTER TABLE public.tef_terminais
  ADD COLUMN IF NOT EXISTS ambiente text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS servidor text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cnpj text NOT NULL DEFAULT '';

ALTER TABLE public.tef_pareamentos
  ADD COLUMN IF NOT EXISTS ambiente text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS servidor text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cnpj text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_configuracoes_servidor_homologacao_check'
  ) THEN
    ALTER TABLE public.tef_configuracoes
      ADD CONSTRAINT tef_configuracoes_servidor_homologacao_check
      CHECK (public.tef_servidor_paygo_valido(servidor_homologacao));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_configuracoes_servidor_producao_check'
  ) THEN
    ALTER TABLE public.tef_configuracoes
      ADD CONSTRAINT tef_configuracoes_servidor_producao_check
      CHECK (public.tef_servidor_paygo_valido(servidor_producao));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_terminais_ambiente_check'
  ) THEN
    ALTER TABLE public.tef_terminais
      ADD CONSTRAINT tef_terminais_ambiente_check
      CHECK (ambiente = '' OR ambiente IN ('homologacao', 'producao'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_terminais_servidor_check'
  ) THEN
    ALTER TABLE public.tef_terminais
      ADD CONSTRAINT tef_terminais_servidor_check
      CHECK (public.tef_servidor_paygo_valido(servidor));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_terminais_cnpj_check'
  ) THEN
    ALTER TABLE public.tef_terminais
      ADD CONSTRAINT tef_terminais_cnpj_check
      CHECK (cnpj = '' OR cnpj ~ '^[0-9]{14}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_pareamentos_ambiente_check'
  ) THEN
    ALTER TABLE public.tef_pareamentos
      ADD CONSTRAINT tef_pareamentos_ambiente_check
      CHECK (ambiente = '' OR ambiente IN ('homologacao', 'producao'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_pareamentos_servidor_check'
  ) THEN
    ALTER TABLE public.tef_pareamentos
      ADD CONSTRAINT tef_pareamentos_servidor_check
      CHECK (public.tef_servidor_paygo_valido(servidor));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_pareamentos_cnpj_check'
  ) THEN
    ALTER TABLE public.tef_pareamentos
      ADD CONSTRAINT tef_pareamentos_cnpj_check
      CHECK (cnpj = '' OR cnpj ~ '^[0-9]{14}$');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tef_instalacoes'
  ) THEN
    ALTER TABLE public.tef_instalacoes
      ADD COLUMN IF NOT EXISTS servidor_homologacao text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS servidor_producao text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS servidor_confirmado boolean NOT NULL DEFAULT false;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tef_instalacoes_servidor_homologacao_check'
    ) THEN
      ALTER TABLE public.tef_instalacoes
        ADD CONSTRAINT tef_instalacoes_servidor_homologacao_check
        CHECK (public.tef_servidor_paygo_valido(servidor_homologacao));
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tef_instalacoes_servidor_producao_check'
    ) THEN
      ALTER TABLE public.tef_instalacoes
        ADD CONSTRAINT tef_instalacoes_servidor_producao_check
        CHECK (public.tef_servidor_paygo_valido(servidor_producao));
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN public.tef_configuracoes.servidor_homologacao IS
  'Servidor PayGoWeb de homologação, no formato host:porta. Vazio até confirmação do administrador.';

COMMENT ON COLUMN public.tef_configuracoes.servidor_producao IS
  'Servidor PayGoWeb de produção, no formato host:porta. Independente da homologação.';

COMMIT;
