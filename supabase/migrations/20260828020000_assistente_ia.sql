BEGIN;

-- ============================================================
-- UltraPDV — Assistente IA (copiloto)
-- Data: 2026-08-28
--
-- Conversas por empresa + usuário. Isolamento RLS.
-- Base fiscal versionada: arquitetura + fontes oficiais já existentes.
-- Não inventa NCM/CEST. Catálogos IBS/CBS reutilizam tabelas atuais.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ia_conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  usuario_id uuid NOT NULL
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE,
  titulo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ia_conversas_empresa_id_key
    UNIQUE (empresa_id, id)
);

COMMENT ON TABLE public.ia_conversas IS
  'Conversa do Assistente UltraPDV. Isolada por empresa_id + usuario_id.';

CREATE INDEX IF NOT EXISTS ix_ia_conversas_empresa_usuario
  ON public.ia_conversas (empresa_id, usuario_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ia_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  usuario_id uuid NOT NULL
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE,
  papel text NOT NULL,
  conteudo text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ia_mensagens_empresa_conversa_fkey
    FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.ia_conversas (empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT ia_mensagens_papel_check
    CHECK (papel IN ('usuario', 'assistente', 'sistema')),

  CONSTRAINT ia_mensagens_conteudo_check
    CHECK (char_length(btrim(conteudo)) BETWEEN 1 AND 8000),

  CONSTRAINT ia_mensagens_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.ia_mensagens IS
  'Mensagens do Assistente UltraPDV. Sem dumps internos. Isolado por empresa.';

CREATE INDEX IF NOT EXISTS ix_ia_mensagens_conversa
  ON public.ia_mensagens (empresa_id, conversa_id, created_at);

CREATE TABLE IF NOT EXISTS public.ia_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  usuario_id uuid NOT NULL
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE,
  entidade text NOT NULL,
  entidade_id uuid NOT NULL,
  valores_anteriores jsonb NOT NULL DEFAULT '{}'::jsonb,
  valores_novos jsonb NOT NULL DEFAULT '{}'::jsonb,
  sugestao jsonb NOT NULL DEFAULT '{}'::jsonb,
  fontes jsonb NOT NULL DEFAULT '[]'::jsonb,
  versao_tabelas text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ia_auditoria_entidade_check
    CHECK (entidade IN ('produto_fiscal')),

  CONSTRAINT ia_auditoria_json_check
    CHECK (
      jsonb_typeof(valores_anteriores) = 'object'
      AND jsonb_typeof(valores_novos) = 'object'
      AND jsonb_typeof(sugestao) = 'object'
      AND jsonb_typeof(fontes) = 'array'
    )
);

COMMENT ON TABLE public.ia_auditoria IS
  'Alterações confirmadas a partir de sugestão do Assistente IA. Isolado por empresa_id.';

CREATE INDEX IF NOT EXISTS ix_ia_auditoria_empresa
  ON public.ia_auditoria (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_ia_auditoria_entidade
  ON public.ia_auditoria (empresa_id, entidade, entidade_id);

CREATE TABLE IF NOT EXISTS public.fiscal_base_fontes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  origem text NOT NULL,
  versao text NOT NULL,
  status text NOT NULL DEFAULT 'ativa',
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  observacao text,

  CONSTRAINT fiscal_base_fontes_status_check
    CHECK (status IN ('ativa', 'pendente', 'descontinuada'))
);

COMMENT ON TABLE public.fiscal_base_fontes IS
  'Fontes da base fiscal oficial versionada. Sem scraping. Job futuro atualiza por aqui.';

CREATE TABLE IF NOT EXISTS public.fiscal_base_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id uuid NOT NULL
    REFERENCES public.fiscal_base_fontes (id)
    ON DELETE CASCADE,
  tipo text NOT NULL,
  codigo text NOT NULL,
  descricao text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  ativo boolean NOT NULL DEFAULT true,

  CONSTRAINT fiscal_base_regras_tipo_check
    CHECK (tipo IN (
      'ncm',
      'cest',
      'cst_ibs_cbs',
      'cclass_trib',
      'cfop',
      'regra'
    )),

  CONSTRAINT fiscal_base_regras_payload_check
    CHECK (jsonb_typeof(payload) = 'object')
);

COMMENT ON TABLE public.fiscal_base_regras IS
  'Regras fiscais oficiais importadas. Vazio até haver arquivo/API oficial. A IA não inventa códigos.';

CREATE INDEX IF NOT EXISTS ix_fiscal_base_regras_tipo_codigo
  ON public.fiscal_base_regras (tipo, codigo)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS ix_fiscal_base_regras_fonte
  ON public.fiscal_base_regras (fonte_id, tipo);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_base_regras_vigente
  ON public.fiscal_base_regras (tipo, codigo, vigencia_inicio);

INSERT INTO public.fiscal_base_fontes (
  codigo, nome, origem, versao, status, vigencia_inicio, observacao
) VALUES
  (
    'cst_ibscbs_catalogo',
    'CST IBS/CBS',
    'tabela:fiscal_cst_ibscbs_catalogo',
    'catalogo-interno',
    'ativa',
    DATE '2026-01-01',
    'Catálogo já usado pelos grupos fiscais do UltraPDV.'
  ),
  (
    'cclasstrib_catalogo',
    'cClassTrib IBS/CBS',
    'tabela:fiscal_cclasstrib_catalogo',
    'catalogo-interno',
    'ativa',
    DATE '2026-01-01',
    'Catálogo já usado pelos grupos fiscais do UltraPDV.'
  ),
  (
    'tabelas_fiscais_codigo',
    'CFOP / CST / CSOSN / PIS / COFINS',
    'codigo:lib/fiscal/tabelas-fiscais.ts',
    'codigo',
    'ativa',
    DATE '2026-01-01',
    'Tabelas controladas no código. Atualizar só com publicação oficial.'
  ),
  (
    'ncm_oficial',
    'NCM',
    'pendente',
    'nao_importada',
    'pendente',
    DATE '2026-01-01',
    'Sem arquivo/API oficial importado. A IA não afirma NCM até esta fonte estar carregada.'
  ),
  (
    'cest_oficial',
    'CEST',
    'pendente',
    'nao_importada',
    'pendente',
    DATE '2026-01-01',
    'Sem arquivo/API oficial importado. A IA não afirma CEST até esta fonte estar carregada.'
  )
ON CONFLICT (codigo) DO NOTHING;

DROP TRIGGER IF EXISTS ia_conversas_set_updated_at ON public.ia_conversas;
CREATE TRIGGER ia_conversas_set_updated_at
  BEFORE UPDATE ON public.ia_conversas
  FOR EACH ROW
  EXECUTE FUNCTION public.ultrapdv_set_updated_at();

ALTER TABLE public.ia_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_base_fontes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_base_regras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_conversas_select_propria ON public.ia_conversas;
CREATE POLICY ia_conversas_select_propria
  ON public.ia_conversas
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS ia_conversas_insert_propria ON public.ia_conversas;
CREATE POLICY ia_conversas_insert_propria
  ON public.ia_conversas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS ia_conversas_update_propria ON public.ia_conversas;
CREATE POLICY ia_conversas_update_propria
  ON public.ia_conversas
  FOR UPDATE TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  )
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS ia_mensagens_select_propria ON public.ia_mensagens;
CREATE POLICY ia_mensagens_select_propria
  ON public.ia_mensagens
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS ia_mensagens_insert_propria ON public.ia_mensagens;
CREATE POLICY ia_mensagens_insert_propria
  ON public.ia_mensagens
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS ia_auditoria_select_empresa ON public.ia_auditoria;
CREATE POLICY ia_auditoria_select_empresa
  ON public.ia_auditoria
  FOR SELECT TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS ia_auditoria_insert_propria ON public.ia_auditoria;
CREATE POLICY ia_auditoria_insert_propria
  ON public.ia_auditoria
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS fiscal_base_fontes_select ON public.fiscal_base_fontes;
CREATE POLICY fiscal_base_fontes_select
  ON public.fiscal_base_fontes
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS fiscal_base_regras_select ON public.fiscal_base_regras;
CREATE POLICY fiscal_base_regras_select
  ON public.fiscal_base_regras
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.ia_conversas FROM public, anon;
REVOKE ALL ON TABLE public.ia_mensagens FROM public, anon;
REVOKE ALL ON TABLE public.ia_auditoria FROM public, anon;
REVOKE ALL ON TABLE public.fiscal_base_fontes FROM public, anon;
REVOKE ALL ON TABLE public.fiscal_base_regras FROM public, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.ia_conversas TO authenticated;
GRANT SELECT, INSERT ON TABLE public.ia_mensagens TO authenticated;
GRANT SELECT, INSERT ON TABLE public.ia_auditoria TO authenticated;
GRANT SELECT ON TABLE public.fiscal_base_fontes TO authenticated;
GRANT SELECT ON TABLE public.fiscal_base_regras TO authenticated;

GRANT ALL ON TABLE public.ia_conversas TO service_role;
GRANT ALL ON TABLE public.ia_mensagens TO service_role;
GRANT ALL ON TABLE public.ia_auditoria TO service_role;
GRANT ALL ON TABLE public.fiscal_base_fontes TO service_role;
GRANT ALL ON TABLE public.fiscal_base_regras TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
