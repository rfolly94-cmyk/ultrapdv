BEGIN;

-- UltraPDV — Matriz de permissões granulares por usuário e empresa.
-- Isolamento: usuario_id + empresa_id. RLS via tem_acesso_empresa.
-- Administrador continua com acesso total no aplicativo mesmo sem linhas aqui.

CREATE TABLE IF NOT EXISTS public.usuarios_permissoes_empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  modulo text NOT NULL,
  permissoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_permissoes_empresas_unico
    UNIQUE (usuario_id, empresa_id, modulo),
  CONSTRAINT usuarios_permissoes_empresas_modulo_check
    CHECK (
      modulo = ANY (ARRAY[
        'inicio',
        'vendas',
        'pdv',
        'clientes',
        'produtos',
        'estoque',
        'fiscal',
        'financeiro',
        'contabilidade',
        'configuracoes',
        'usuarios',
        'catalogo',
        'importacao_dados'
      ]::text[])
    )
);

CREATE INDEX IF NOT EXISTS usuarios_permissoes_empresas_empresa_usuario_idx
  ON public.usuarios_permissoes_empresas (empresa_id, usuario_id);

COMMENT ON TABLE public.usuarios_permissoes_empresas IS
  'Permissões personalizadas por usuário dentro de uma empresa. Ausência de linhas faz o app usar o preset do perfil. Administrador = acesso total sem materializar linhas.';

ALTER TABLE public.usuarios_permissoes_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_seleciona_proprias_permissoes
  ON public.usuarios_permissoes_empresas;
CREATE POLICY usuario_seleciona_proprias_permissoes
  ON public.usuarios_permissoes_empresas
  FOR SELECT
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

REVOKE ALL ON TABLE public.usuarios_permissoes_empresas FROM PUBLIC, anon;

GRANT SELECT
  ON TABLE public.usuarios_permissoes_empresas
  TO authenticated;

GRANT ALL
  ON TABLE public.usuarios_permissoes_empresas
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
