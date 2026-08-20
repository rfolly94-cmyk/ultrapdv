BEGIN;

-- ============================================================
-- UltraPDV — Área da Contadora / Contabilidade V1
-- Data: 2026-08-16
--
-- Base para competência, inventário fiscal e liberação
-- para o escritório. NÃO gera SPED TXT.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contabilidade_competencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  ano smallint NOT NULL,
  mes smallint NOT NULL,
  status text NOT NULL DEFAULT 'ABERTA',
  liberado_em timestamptz,
  liberado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contabilidade_competencias_empresa_periodo_unique
    UNIQUE (empresa_id, ano, mes),
  CONSTRAINT contabilidade_competencias_periodo_check
    CHECK (ano BETWEEN 2000 AND 2100 AND mes BETWEEN 1 AND 12),
  CONSTRAINT contabilidade_competencias_status_check
    CHECK (status IN ('ABERTA', 'LIBERADA_CONTABILIDADE'))
);

CREATE INDEX IF NOT EXISTS ix_contabilidade_competencias_empresa
  ON public.contabilidade_competencias (empresa_id, ano DESC, mes DESC);

CREATE TABLE IF NOT EXISTS public.inventarios_fiscais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  data_snapshot date NOT NULL,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  gerado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  observacao text,
  itens_count integer NOT NULL DEFAULT 0,
  quantidade_total numeric(16,4) NOT NULL DEFAULT 0,
  valor_total numeric(16,2) NOT NULL DEFAULT 0,
  CONSTRAINT inventarios_fiscais_empresa_data_unique
    UNIQUE (empresa_id, data_snapshot)
);

CREATE INDEX IF NOT EXISTS ix_inventarios_fiscais_empresa
  ON public.inventarios_fiscais (empresa_id, data_snapshot DESC);

CREATE TABLE IF NOT EXISTS public.inventario_fiscal_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios_fiscais(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  codigo text NOT NULL,
  descricao text NOT NULL,
  ncm text,
  unidade text,
  quantidade numeric(16,4) NOT NULL DEFAULT 0,
  custo_unitario numeric(16,4),
  valor_total numeric(16,2),
  custo_disponivel boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_inventario_fiscal_itens_inventario
  ON public.inventario_fiscal_itens (inventario_id);

CREATE TABLE IF NOT EXISTS public.contabilidade_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  ano smallint,
  mes smallint,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  detalhe text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contabilidade_eventos_tipo_check
    CHECK (tipo IN (
      'COMPETENCIA_LIBERADA',
      'ZIP_GERADO',
      'INVENTARIO_GERADO'
    ))
);

CREATE INDEX IF NOT EXISTS ix_contabilidade_eventos_empresa
  ON public.contabilidade_eventos (empresa_id, created_at DESC);

ALTER TABLE public.contabilidade_competencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventarios_fiscais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_fiscal_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contabilidade_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contabilidade_competencias_empresa
  ON public.contabilidade_competencias;
DROP POLICY IF EXISTS contabilidade_competencias_select
  ON public.contabilidade_competencias;
DROP POLICY IF EXISTS contabilidade_competencias_escrever
  ON public.contabilidade_competencias;
DROP POLICY IF EXISTS inventarios_fiscais_empresa
  ON public.inventarios_fiscais;
DROP POLICY IF EXISTS inventarios_fiscais_select
  ON public.inventarios_fiscais;
DROP POLICY IF EXISTS inventarios_fiscais_inserir
  ON public.inventarios_fiscais;
DROP POLICY IF EXISTS inventario_fiscal_itens_empresa
  ON public.inventario_fiscal_itens;
DROP POLICY IF EXISTS inventario_fiscal_itens_select
  ON public.inventario_fiscal_itens;
DROP POLICY IF EXISTS inventario_fiscal_itens_inserir
  ON public.inventario_fiscal_itens;
DROP POLICY IF EXISTS contabilidade_eventos_empresa
  ON public.contabilidade_eventos;
DROP POLICY IF EXISTS contabilidade_eventos_select
  ON public.contabilidade_eventos;
DROP POLICY IF EXISTS contabilidade_eventos_inserir
  ON public.contabilidade_eventos;

CREATE POLICY contabilidade_competencias_select
ON public.contabilidade_competencias
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY contabilidade_competencias_escrever
ON public.contabilidade_competencias
FOR ALL
TO authenticated
USING (
  public.tem_acesso_empresa(empresa_id)
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = contabilidade_competencias.empresa_id
      AND ue.ativo = true
      AND lower(ue.perfil) IN ('administrador', 'gerente')
  )
)
WITH CHECK (
  public.tem_acesso_empresa(empresa_id)
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = contabilidade_competencias.empresa_id
      AND ue.ativo = true
      AND lower(ue.perfil) IN ('administrador', 'gerente')
  )
);

CREATE POLICY inventarios_fiscais_select
ON public.inventarios_fiscais
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY inventarios_fiscais_inserir
ON public.inventarios_fiscais
FOR INSERT
TO authenticated
WITH CHECK (
  public.tem_acesso_empresa(empresa_id)
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = inventarios_fiscais.empresa_id
      AND ue.ativo = true
      AND lower(ue.perfil) IN ('administrador', 'gerente')
  )
);

CREATE POLICY inventario_fiscal_itens_select
ON public.inventario_fiscal_itens
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY inventario_fiscal_itens_inserir
ON public.inventario_fiscal_itens
FOR INSERT
TO authenticated
WITH CHECK (
  public.tem_acesso_empresa(empresa_id)
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = inventario_fiscal_itens.empresa_id
      AND ue.ativo = true
      AND lower(ue.perfil) IN ('administrador', 'gerente')
  )
);

CREATE POLICY contabilidade_eventos_select
ON public.contabilidade_eventos
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY contabilidade_eventos_inserir
ON public.contabilidade_eventos
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.contabilidade_competencias FROM anon;
REVOKE ALL ON public.inventarios_fiscais FROM anon;
REVOKE ALL ON public.inventario_fiscal_itens FROM anon;
REVOKE ALL ON public.contabilidade_eventos FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.contabilidade_competencias TO authenticated;
GRANT SELECT, INSERT ON public.inventarios_fiscais TO authenticated;
GRANT SELECT, INSERT ON public.inventario_fiscal_itens TO authenticated;
GRANT SELECT, INSERT ON public.contabilidade_eventos TO authenticated;

COMMENT ON TABLE public.contabilidade_competencias IS
  'Liberação da competência para o escritório. Não fecha fiscalmente nem gera SPED.';

COMMENT ON TABLE public.inventarios_fiscais IS
  'Fotografia de estoque para fins contábeis. Não movimenta estoque.';

NOTIFY pgrst, 'reload schema';

COMMIT;
