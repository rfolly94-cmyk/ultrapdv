-- Desativa a integração TEF e remove somente estruturas exclusivas.
-- Não usa DROP CASCADE e não executa DELETE.
-- Não apaga vendas, pagamentos, empresas, terminais comerciais nem o histórico em tef_operacoes.
-- Os journals locais -2596 / resultado 151 não estão neste banco, não foram recriados
-- e não estão conciliados. A confirmação externa com a SETIS continua necessária.

BEGIN;

DO $$
DECLARE
  dependencia text;
BEGIN
  SELECT format('%s depende de %s', c.conrelid::regclass, c.confrelid::regclass)
    INTO dependencia
  FROM pg_constraint AS c
  WHERE c.contype = 'f'
    AND c.confrelid = ANY (ARRAY[
      'public.tef_pareamentos'::regclass,
      'public.tef_chaves_revogadas'::regclass,
      'public.tef_evidencias_instalacao'::regclass,
      'public.tef_identidades_homologacao'::regclass,
      'public.tef_validacoes_biblioteca'::regclass,
      'public.tef_auditoria'::regclass,
      'public.tef_instalacoes'::regclass
    ])
    AND c.conrelid <> ALL (ARRAY[
      'public.tef_pareamentos'::regclass,
      'public.tef_chaves_revogadas'::regclass,
      'public.tef_evidencias_instalacao'::regclass,
      'public.tef_identidades_homologacao'::regclass,
      'public.tef_validacoes_biblioteca'::regclass,
      'public.tef_auditoria'::regclass,
      'public.tef_instalacoes'::regclass
    ]);
  IF dependencia IS NOT NULL THEN
    RAISE EXCEPTION 'Remoção interrompida: %', dependencia;
  END IF;
END $$;

UPDATE public.tef_plataforma
SET habilitada = false,
    atualizado_em = now()
WHERE id = true;

UPDATE public.tef_configuracoes
SET habilitado = false,
    updated_at = now()
WHERE habilitado = true;

DROP FUNCTION IF EXISTS public.tef_recuperar_autorizacao_terminal(
  uuid, uuid, uuid, text, uuid, text, text, text
);

DROP TABLE IF EXISTS public.tef_pareamentos;
DROP TABLE IF EXISTS public.tef_chaves_revogadas;
DROP TABLE IF EXISTS public.tef_evidencias_instalacao;
DROP TABLE IF EXISTS public.tef_identidades_homologacao;
DROP TABLE IF EXISTS public.tef_validacoes_biblioteca;
DROP TABLE IF EXISTS public.tef_auditoria;
DROP TABLE IF EXISTS public.tef_instalacoes;

COMMIT;
