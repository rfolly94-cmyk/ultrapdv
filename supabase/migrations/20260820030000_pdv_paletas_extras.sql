BEGIN;

-- Amplia os valores aceitos de paleta do PDV.
-- Reutiliza usuarios_preferencias_pdv (usuario_id + empresa_id).
-- Não cria tabela nova e não destrói preferências existentes.

ALTER TABLE public.usuarios_preferencias_pdv
  DROP CONSTRAINT IF EXISTS usuarios_preferencias_pdv_paleta_check;

ALTER TABLE public.usuarios_preferencias_pdv
  ADD CONSTRAINT usuarios_preferencias_pdv_paleta_check
  CHECK (
    paleta = ANY (ARRAY[
      'padrao',
      'azul',
      'azul_claro',
      'laranja',
      'verde',
      'verde_escuro',
      'roxo',
      'rosa',
      'rosa_claro',
      'vermelho',
      'grafite',
      'cinza',
      'escuro',
      'marrom',
      'turquesa'
    ]::text[])
  );

COMMENT ON COLUMN public.usuarios_preferencias_pdv.paleta IS
  'Paleta visual do PDV por usuário em cada empresa.';

NOTIFY pgrst, 'reload schema';

COMMIT;
