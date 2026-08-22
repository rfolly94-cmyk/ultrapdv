BEGIN;

-- UltraPDV — módulo de permissão `relatorios` (acessar / exportar).
-- Incremental: amplia o CHECK existente. Não altera linhas já gravadas.
-- Ausência de linha continua usando o preset do perfil no aplicativo.

ALTER TABLE public.usuarios_permissoes_empresas
  DROP CONSTRAINT IF EXISTS usuarios_permissoes_empresas_modulo_check;

ALTER TABLE public.usuarios_permissoes_empresas
  ADD CONSTRAINT usuarios_permissoes_empresas_modulo_check
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
        'importacao_dados',
        'relatorios'
      ]::text[])
    );

COMMIT;
