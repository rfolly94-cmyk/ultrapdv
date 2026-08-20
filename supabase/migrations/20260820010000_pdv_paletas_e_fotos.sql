BEGIN;

-- Paletas completas e fotos no PDV.
-- Reutiliza usuarios_preferencias_pdv (usuario_id + empresa_id).
-- Não destrói cor_primaria existente.

ALTER TABLE public.usuarios_preferencias_pdv
  ADD COLUMN IF NOT EXISTS paleta text NOT NULL DEFAULT 'padrao';

ALTER TABLE public.usuarios_preferencias_pdv
  ADD COLUMN IF NOT EXISTS mostrar_fotos_produtos boolean NOT NULL DEFAULT false;

UPDATE public.usuarios_preferencias_pdv
SET paleta = CASE lower(cor_primaria)
  WHEN '#2563eb' THEN 'azul'
  WHEN '#1d4ed8' THEN 'azul'
  WHEN '#ea580c' THEN 'laranja'
  WHEN '#16a34a' THEN 'verde'
  WHEN '#7c3aed' THEN 'roxo'
  WHEN '#18181b' THEN 'grafite'
  WHEN '#3f3f46' THEN 'grafite'
  ELSE 'padrao'
END
WHERE paleta = 'padrao';

ALTER TABLE public.usuarios_preferencias_pdv
  DROP CONSTRAINT IF EXISTS usuarios_preferencias_pdv_paleta_check;

ALTER TABLE public.usuarios_preferencias_pdv
  ADD CONSTRAINT usuarios_preferencias_pdv_paleta_check
  CHECK (
    paleta = ANY (ARRAY[
      'padrao',
      'azul',
      'laranja',
      'verde',
      'roxo',
      'grafite',
      'escuro'
    ]::text[])
  );

COMMENT ON TABLE public.usuarios_preferencias_pdv IS
  'Paleta, logo central e fotos do PDV por usuário em cada empresa.';

NOTIFY pgrst, 'reload schema';

COMMIT;
