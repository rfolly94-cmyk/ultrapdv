BEGIN;

-- Identidade visual multiempresa.
-- A logomarca pertence a empresas. Não armazenar HEX/base64.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS logo_path text;

COMMENT ON COLUMN public.empresas.logo_path IS
  'Caminho no bucket logos-empresas ({empresa_id}/logo.png|jpg). Nunca HEX ou base64.';

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'logos-empresas',
  'logos-empresas',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS logos_empresas_select_publico ON storage.objects;
DROP POLICY IF EXISTS logos_empresas_insert_empresa ON storage.objects;
DROP POLICY IF EXISTS logos_empresas_update_empresa ON storage.objects;
DROP POLICY IF EXISTS logos_empresas_delete_empresa ON storage.objects;

CREATE POLICY logos_empresas_select_publico
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'logos-empresas');

CREATE POLICY logos_empresas_insert_empresa
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'logos-empresas'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY logos_empresas_update_empresa
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'logos-empresas'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
)
WITH CHECK (
  bucket_id = 'logos-empresas'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY logos_empresas_delete_empresa
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'logos-empresas'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

NOTIFY pgrst, 'reload schema';

COMMIT;
