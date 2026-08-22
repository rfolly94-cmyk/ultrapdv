BEGIN;

-- Catálogo online: chave técnica nova no catálogo SaaS.
-- Enforcement continua em TypeScript (RECURSOS_COM_ENFORCEMENT).
-- Master continua podendo alterar planos_recursos depois.
-- Não reescreve assinaturas nem os demais recursos.

INSERT INTO public.recursos_plataforma (
  chave,
  nome,
  descricao,
  categoria,
  ordem,
  ativo
)
VALUES (
  'catalogo',
  'Catálogo online',
  'Loja pública, publicação de produtos e pedidos online.',
  'comercial',
  80,
  true
)
ON CONFLICT (chave) DO UPDATE
SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  categoria = EXCLUDED.categoria,
  ordem = EXCLUDED.ordem,
  updated_at = now();

INSERT INTO public.planos_recursos (plano_id, recurso_id, habilitado)
SELECT p.id, r.id, v.habilitado
FROM (
  VALUES
    ('Básico'::text, false),
    ('Pro', true),
    ('Premium', true)
) AS v(plano_nome, habilitado)
INNER JOIN public.planos p ON p.nome = v.plano_nome
INNER JOIN public.recursos_plataforma r ON r.chave = 'catalogo'
ON CONFLICT (plano_id, recurso_id) DO UPDATE
SET
  habilitado = EXCLUDED.habilitado,
  updated_at = now();

COMMIT;
