BEGIN;

-- ============================================================
-- UltraPDV — Motor Fiscal IA (Parte 2)
-- Data: 2026-08-28
--
-- Bases normativas globais (NCM/CEST/versões). Sem cópia por empresa.
-- Análises, propostas e impacto por empresa_id + RLS.
-- Não aplica alteração fiscal. Não emite documento.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fiscal_base_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_codigo text NOT NULL,
  tipo_tabela text NOT NULL,
  versao text NOT NULL,
  publicacao date,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  importado_em timestamptz NOT NULL DEFAULT now(),
  hash text NOT NULL,
  status text NOT NULL DEFAULT 'candidata',
  origem_oficial text NOT NULL,
  quantidade_registros integer NOT NULL DEFAULT 0,
  erro text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT fiscal_base_versoes_fonte_fkey
    FOREIGN KEY (fonte_codigo)
    REFERENCES public.fiscal_base_fontes (codigo)
    ON DELETE RESTRICT,

  CONSTRAINT fiscal_base_versoes_tipo_check
    CHECK (tipo_tabela IN (
      'ncm',
      'cest',
      'cest_ncm',
      'cst_ibs_cbs',
      'cclass_trib',
      'ccred_pres',
      'imposto_seletivo'
    )),

  CONSTRAINT fiscal_base_versoes_status_check
    CHECK (status IN (
      'candidata',
      'valida',
      'ativa',
      'rejeitada',
      'falhou',
      'historica'
    )),

  CONSTRAINT fiscal_base_versoes_hash_check
    CHECK (char_length(btrim(hash)) BETWEEN 16 AND 128),

  CONSTRAINT fiscal_base_versoes_qtd_check
    CHECK (quantidade_registros >= 0),

  CONSTRAINT fiscal_base_versoes_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.fiscal_base_versoes IS
  'Versionamento global da base fiscal oficial. Nunca sobrescreve versão anterior.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_base_versoes_fonte_hash
  ON public.fiscal_base_versoes (fonte_codigo, hash);

CREATE INDEX IF NOT EXISTS ix_fiscal_base_versoes_ativa
  ON public.fiscal_base_versoes (fonte_codigo, status, importado_em DESC);

CREATE TABLE IF NOT EXISTS public.fiscal_base_atualizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  status text NOT NULL DEFAULT 'verificando',
  resumo jsonb NOT NULL DEFAULT '{}'::jsonb,
  erro text,

  CONSTRAINT fiscal_base_atualizacoes_status_check
    CHECK (status IN ('verificando', 'ok', 'erro', 'sem_mudanca')),

  CONSTRAINT fiscal_base_atualizacoes_resumo_check
    CHECK (jsonb_typeof(resumo) = 'object')
);

COMMENT ON TABLE public.fiscal_base_atualizacoes IS
  'Log do job diário da base fiscal. Idempotente. Sem polling no navegador.';

CREATE INDEX IF NOT EXISTS ix_fiscal_base_atualizacoes_recente
  ON public.fiscal_base_atualizacoes (iniciado_em DESC);

ALTER TABLE public.fiscal_base_regras
  ADD COLUMN IF NOT EXISTS versao_id uuid
    REFERENCES public.fiscal_base_versoes (id)
    ON DELETE CASCADE;

ALTER TABLE public.fiscal_base_regras
  ADD COLUMN IF NOT EXISTS codigo_normalizado text;

ALTER TABLE public.fiscal_base_regras
  DROP CONSTRAINT IF EXISTS fiscal_base_regras_tipo_check;

ALTER TABLE public.fiscal_base_regras
  ADD CONSTRAINT fiscal_base_regras_tipo_check
    CHECK (tipo IN (
      'ncm',
      'cest',
      'cest_ncm',
      'cst_ibs_cbs',
      'cclass_trib',
      'ccred_pres',
      'imposto_seletivo',
      'cfop',
      'regra'
    ));

DROP INDEX IF EXISTS ux_fiscal_base_regras_vigente;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_base_regras_versao_codigo
  ON public.fiscal_base_regras (versao_id, tipo, codigo)
  WHERE versao_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_base_regras_legado
  ON public.fiscal_base_regras (tipo, codigo, vigencia_inicio)
  WHERE versao_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_fiscal_base_regras_codigo_norm
  ON public.fiscal_base_regras (tipo, codigo_normalizado)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS ix_fiscal_base_regras_busca
  ON public.fiscal_base_regras
  USING gin (to_tsvector('simple', coalesce(descricao, '') || ' ' || coalesce(codigo, '')))
  WHERE ativo = true AND tipo IN ('ncm', 'cest');

CREATE TABLE IF NOT EXISTS public.fiscal_ia_analises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  usuario_id uuid NOT NULL
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE,
  produto_id uuid,
  contexto text NOT NULL DEFAULT 'produto',
  versao_base text,
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb,
  fontes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fiscal_ia_analises_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT fiscal_ia_analises_contexto_check
    CHECK (contexto IN (
      'produto',
      'operacao',
      'lote',
      'grupo',
      'proposta'
    )),

  CONSTRAINT fiscal_ia_analises_resultado_check
    CHECK (jsonb_typeof(resultado) = 'object'),

  CONSTRAINT fiscal_ia_analises_fontes_check
    CHECK (jsonb_typeof(fontes) = 'array')
);

COMMENT ON TABLE public.fiscal_ia_analises IS
  'Análises fiscais relevantes do Motor/IA. Isolado por empresa_id. Sem prompts gigantes.';

CREATE INDEX IF NOT EXISTS ix_fiscal_ia_analises_empresa
  ON public.fiscal_ia_analises (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_fiscal_ia_analises_produto
  ON public.fiscal_ia_analises (empresa_id, produto_id, created_at DESC)
  WHERE produto_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.fiscal_ia_propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  usuario_id uuid NOT NULL
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE,
  produto_id uuid NOT NULL,
  campo text NOT NULL,
  atual text,
  sugerido text,
  confianca text NOT NULL,
  justificativa text NOT NULL,
  fontes jsonb NOT NULL DEFAULT '[]'::jsonb,
  versao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT fiscal_ia_propostas_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT fiscal_ia_propostas_confianca_check
    CHECK (confianca IN ('nenhuma', 'baixa', 'media', 'alta')),

  CONSTRAINT fiscal_ia_propostas_fontes_check
    CHECK (jsonb_typeof(fontes) = 'array'),

  CONSTRAINT fiscal_ia_propostas_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.fiscal_ia_propostas IS
  'Propostas de atualização fiscal. Não grava no cadastro nesta fase.';

CREATE INDEX IF NOT EXISTS ix_fiscal_ia_propostas_empresa
  ON public.fiscal_ia_propostas (empresa_id, produto_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.fiscal_ia_impacto_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  versao_id uuid NOT NULL
    REFERENCES public.fiscal_base_versoes (id)
    ON DELETE CASCADE,
  quantidade_produtos integer NOT NULL DEFAULT 0,
  resumo jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fiscal_ia_impacto_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT fiscal_ia_impacto_qtd_check
    CHECK (quantidade_produtos >= 0),

  CONSTRAINT fiscal_ia_impacto_resumo_check
    CHECK (jsonb_typeof(resumo) = 'object')
);

COMMENT ON TABLE public.fiscal_ia_impacto_empresa IS
  'Produtos da empresa potencialmente impactados por nova versão da base. Não altera cadastro.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_ia_impacto_empresa_versao
  ON public.fiscal_ia_impacto_empresa (empresa_id, versao_id);

DROP TRIGGER IF EXISTS fiscal_ia_impacto_set_updated_at
  ON public.fiscal_ia_impacto_empresa;
CREATE TRIGGER fiscal_ia_impacto_set_updated_at
  BEFORE UPDATE ON public.fiscal_ia_impacto_empresa
  FOR EACH ROW
  EXECUTE FUNCTION public.ultrapdv_set_updated_at();

ALTER TABLE public.notificacoes
  DROP CONSTRAINT IF EXISTS notificacoes_tipo_check;

ALTER TABLE public.notificacoes
  ADD CONSTRAINT notificacoes_tipo_check
    CHECK (tipo IN (
      'estoque_baixo',
      'estoque_zerado',
      'estoque_negativo',
      'lote_vencendo',
      'lote_vencido',
      'carteira_vencida',
      'fiscal_rejeitada',
      'fiscal_aguardando_reconciliacao',
      'fiscal_certificado_vencendo',
      'fiscal_revisao_base',
      'caixa_aberto_anterior'
    ));

ALTER TABLE public.fiscal_base_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_base_atualizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_ia_analises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_ia_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_ia_impacto_empresa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_base_versoes_select ON public.fiscal_base_versoes;
CREATE POLICY fiscal_base_versoes_select
  ON public.fiscal_base_versoes
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS fiscal_base_atualizacoes_select ON public.fiscal_base_atualizacoes;
CREATE POLICY fiscal_base_atualizacoes_select
  ON public.fiscal_base_atualizacoes
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS fiscal_ia_analises_select ON public.fiscal_ia_analises;
CREATE POLICY fiscal_ia_analises_select
  ON public.fiscal_ia_analises
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS fiscal_ia_analises_insert ON public.fiscal_ia_analises;
CREATE POLICY fiscal_ia_analises_insert
  ON public.fiscal_ia_analises
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS fiscal_ia_propostas_select ON public.fiscal_ia_propostas;
CREATE POLICY fiscal_ia_propostas_select
  ON public.fiscal_ia_propostas
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS fiscal_ia_propostas_insert ON public.fiscal_ia_propostas;
CREATE POLICY fiscal_ia_propostas_insert
  ON public.fiscal_ia_propostas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS fiscal_ia_impacto_select ON public.fiscal_ia_impacto_empresa;
CREATE POLICY fiscal_ia_impacto_select
  ON public.fiscal_ia_impacto_empresa
  FOR SELECT TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.fiscal_base_versoes FROM public, anon;
REVOKE ALL ON TABLE public.fiscal_base_atualizacoes FROM public, anon;
REVOKE ALL ON TABLE public.fiscal_ia_analises FROM public, anon;
REVOKE ALL ON TABLE public.fiscal_ia_propostas FROM public, anon;
REVOKE ALL ON TABLE public.fiscal_ia_impacto_empresa FROM public, anon;

GRANT SELECT ON TABLE public.fiscal_base_versoes TO authenticated;
GRANT SELECT ON TABLE public.fiscal_base_atualizacoes TO authenticated;
GRANT SELECT, INSERT ON TABLE public.fiscal_ia_analises TO authenticated;
GRANT SELECT, INSERT ON TABLE public.fiscal_ia_propostas TO authenticated;
GRANT SELECT ON TABLE public.fiscal_ia_impacto_empresa TO authenticated;

GRANT ALL ON TABLE public.fiscal_base_versoes TO service_role;
GRANT ALL ON TABLE public.fiscal_base_atualizacoes TO service_role;
GRANT ALL ON TABLE public.fiscal_ia_analises TO service_role;
GRANT ALL ON TABLE public.fiscal_ia_propostas TO service_role;
GRANT ALL ON TABLE public.fiscal_ia_impacto_empresa TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
