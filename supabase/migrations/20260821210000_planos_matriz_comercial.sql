BEGIN;

-- Matriz comercial inicial dos planos seed (Básico / Pro / Premium).
-- Grava nas mesmas tabelas do Master: planos_recursos e planos_limites.
-- Continua 100% editável depois por rpc_master_salvar_plano.
-- Não cria recurso, snapshot, override de empresa nem reescreve assinaturas.

INSERT INTO public.planos_recursos (plano_id, recurso_id, habilitado)
SELECT p.id, r.id, v.habilitado
FROM (
  VALUES
    ('Básico'::text, 'pdv'::text, true),
    ('Básico', 'vendas', true),
    ('Básico', 'produtos', true),
    ('Básico', 'clientes', true),
    ('Básico', 'estoque', true),
    ('Básico', 'carteira', false),
    ('Básico', 'relatorios', true),
    ('Básico', 'nfce', true),
    ('Básico', 'nfe', false),
    ('Básico', 'cce', false),
    ('Básico', 'inutilizacao_fiscal', false),
    ('Básico', 'contabilidade', false),
    ('Básico', 'importador', false),
    ('Básico', 'pix_integrado', false),
    ('Básico', 'impressao_automatica', false),

    ('Pro', 'pdv', true),
    ('Pro', 'vendas', true),
    ('Pro', 'produtos', true),
    ('Pro', 'clientes', true),
    ('Pro', 'estoque', true),
    ('Pro', 'carteira', true),
    ('Pro', 'relatorios', true),
    ('Pro', 'nfce', true),
    ('Pro', 'nfe', true),
    ('Pro', 'cce', true),
    ('Pro', 'inutilizacao_fiscal', true),
    ('Pro', 'contabilidade', false),
    ('Pro', 'importador', true),
    ('Pro', 'pix_integrado', true),
    ('Pro', 'impressao_automatica', true),

    ('Premium', 'pdv', true),
    ('Premium', 'vendas', true),
    ('Premium', 'produtos', true),
    ('Premium', 'clientes', true),
    ('Premium', 'estoque', true),
    ('Premium', 'carteira', true),
    ('Premium', 'relatorios', true),
    ('Premium', 'nfce', true),
    ('Premium', 'nfe', true),
    ('Premium', 'cce', true),
    ('Premium', 'inutilizacao_fiscal', true),
    ('Premium', 'contabilidade', true),
    ('Premium', 'importador', true),
    ('Premium', 'pix_integrado', true),
    ('Premium', 'impressao_automatica', true)
) AS v(plano_nome, recurso_chave, habilitado)
INNER JOIN public.planos p ON p.nome = v.plano_nome
INNER JOIN public.recursos_plataforma r ON r.chave = v.recurso_chave
ON CONFLICT (plano_id, recurso_id) DO UPDATE
SET
  habilitado = EXCLUDED.habilitado,
  updated_at = now();

INSERT INTO public.planos_limites (plano_id, chave, valor)
SELECT p.id, v.chave, v.valor
FROM (
  VALUES
    ('Básico'::text, 'usuarios'::text, 2::integer),
    ('Pro', 'usuarios', 5),
    ('Premium', 'usuarios', NULL),
    ('Básico', 'filiais', NULL),
    ('Pro', 'filiais', NULL),
    ('Premium', 'filiais', NULL)
) AS v(plano_nome, chave, valor)
INNER JOIN public.planos p ON p.nome = v.plano_nome
ON CONFLICT (plano_id, chave) DO UPDATE
SET
  valor = EXCLUDED.valor,
  updated_at = now();

COMMIT;
