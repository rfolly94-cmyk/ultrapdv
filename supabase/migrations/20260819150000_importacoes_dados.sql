BEGIN;

-- UltraPDV — Histórico de importação de produtos e clientes
-- Isolamento por empresa_id. RLS via tem_acesso_empresa.
-- Não altera PDV, fiscal, vendas nem o mecanismo de estoque.

CREATE TABLE IF NOT EXISTS public.importacoes_dados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  usuario_id uuid NOT NULL REFERENCES auth.users (id),
  tipo text NOT NULL CHECK (tipo IN ('produtos', 'clientes')),
  nome_arquivo text NOT NULL,
  status text NOT NULL DEFAULT 'processando'
    CHECK (status IN ('processando', 'concluida', 'falhou')),
  total_linhas integer NOT NULL DEFAULT 0,
  total_criados integer NOT NULL DEFAULT 0,
  total_atualizados integer NOT NULL DEFAULT 0,
  total_ignorados integer NOT NULL DEFAULT 0,
  total_erros integer NOT NULL DEFAULT 0,
  configuracao jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz
);

CREATE INDEX IF NOT EXISTS importacoes_dados_empresa_created_idx
  ON public.importacoes_dados (empresa_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.importacoes_dados_erros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  importacao_id uuid NOT NULL REFERENCES public.importacoes_dados (id) ON DELETE CASCADE,
  numero_linha integer NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  erro text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS importacoes_dados_erros_importacao_idx
  ON public.importacoes_dados_erros (empresa_id, importacao_id, numero_linha);

ALTER TABLE public.importacoes_dados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.importacoes_dados_erros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_seleciona_importacoes_dados
  ON public.importacoes_dados;
CREATE POLICY usuario_seleciona_importacoes_dados
  ON public.importacoes_dados
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS usuario_insere_importacoes_dados
  ON public.importacoes_dados;
CREATE POLICY usuario_insere_importacoes_dados
  ON public.importacoes_dados
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS usuario_atualiza_importacoes_dados
  ON public.importacoes_dados;
CREATE POLICY usuario_atualiza_importacoes_dados
  ON public.importacoes_dados
  FOR UPDATE
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id))
  WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS usuario_seleciona_importacoes_dados_erros
  ON public.importacoes_dados_erros;
CREATE POLICY usuario_seleciona_importacoes_dados_erros
  ON public.importacoes_dados_erros
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS usuario_insere_importacoes_dados_erros
  ON public.importacoes_dados_erros;
CREATE POLICY usuario_insere_importacoes_dados_erros
  ON public.importacoes_dados_erros
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.importacoes_dados FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.importacoes_dados_erros FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.importacoes_dados
  TO authenticated;

GRANT SELECT, INSERT
  ON TABLE public.importacoes_dados_erros
  TO authenticated;

GRANT ALL ON TABLE public.importacoes_dados TO service_role;
GRANT ALL ON TABLE public.importacoes_dados_erros TO service_role;

COMMIT;
