BEGIN;

-- Central de Ajuda / chat de suporte da plataforma.
-- Isolamento: empresa ativa + conversa do próprio usuário.
-- Master opera via exigirMaster() (service_role) e SELECT autenticado
-- apenas se estiver em administradores_plataforma.

-- ------------------------------------------------------------
-- 1) Preferência do botão flutuante (não reutiliza PDV)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuarios_preferencias_interface (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  assistente_lado text NOT NULL DEFAULT 'right',
  assistente_offset_y numeric(5, 2) NOT NULL DEFAULT 82,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_preferencias_interface_unico
    UNIQUE (usuario_id, empresa_id),
  CONSTRAINT usuarios_preferencias_interface_lado_check
    CHECK (assistente_lado = ANY (ARRAY['left', 'right']::text[])),
  CONSTRAINT usuarios_preferencias_interface_offset_check
    CHECK (assistente_offset_y >= 0 AND assistente_offset_y <= 100)
);

CREATE INDEX IF NOT EXISTS usuarios_preferencias_interface_empresa_idx
  ON public.usuarios_preferencias_interface (empresa_id, usuario_id);

ALTER TABLE public.usuarios_preferencias_interface ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_preferencias_interface FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.usuarios_preferencias_interface FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.usuarios_preferencias_interface TO authenticated;
GRANT ALL ON TABLE public.usuarios_preferencias_interface TO service_role;

DROP POLICY IF EXISTS preferencias_interface_select ON public.usuarios_preferencias_interface;
CREATE POLICY preferencias_interface_select
  ON public.usuarios_preferencias_interface
  FOR SELECT
  TO authenticated
  USING (usuario_id = auth.uid() AND public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS preferencias_interface_insert ON public.usuarios_preferencias_interface;
CREATE POLICY preferencias_interface_insert
  ON public.usuarios_preferencias_interface
  FOR INSERT
  TO authenticated
  WITH CHECK (usuario_id = auth.uid() AND public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS preferencias_interface_update ON public.usuarios_preferencias_interface;
CREATE POLICY preferencias_interface_update
  ON public.usuarios_preferencias_interface
  FOR UPDATE
  TO authenticated
  USING (usuario_id = auth.uid() AND public.tem_acesso_empresa(empresa_id))
  WITH CHECK (usuario_id = auth.uid() AND public.tem_acesso_empresa(empresa_id));

-- ------------------------------------------------------------
-- 2) Conversas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suporte_conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  aberto_por_usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  atendente_master_usuario_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'aguardando_suporte',
  assunto text,
  ultima_mensagem_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suporte_conversas_status_check
    CHECK (status = ANY (ARRAY[
      'aberta',
      'aguardando_suporte',
      'aguardando_cliente',
      'encerrada'
    ]::text[]))
);

CREATE INDEX IF NOT EXISTS suporte_conversas_empresa_idx
  ON public.suporte_conversas (empresa_id);

CREATE INDEX IF NOT EXISTS suporte_conversas_aberto_por_idx
  ON public.suporte_conversas (aberto_por_usuario_id);

CREATE INDEX IF NOT EXISTS suporte_conversas_status_ultima_idx
  ON public.suporte_conversas (status, ultima_mensagem_em DESC);

ALTER TABLE public.suporte_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suporte_conversas FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.suporte_conversas FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.suporte_conversas TO authenticated;
GRANT ALL ON TABLE public.suporte_conversas TO service_role;

DROP POLICY IF EXISTS suporte_conversas_select_propria ON public.suporte_conversas;
CREATE POLICY suporte_conversas_select_propria
  ON public.suporte_conversas
  FOR SELECT
  TO authenticated
  USING (
    aberto_por_usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

DROP POLICY IF EXISTS suporte_conversas_select_master ON public.suporte_conversas;
CREATE POLICY suporte_conversas_select_master
  ON public.suporte_conversas
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.administradores_plataforma a
      WHERE a.usuario_id = auth.uid()
        AND a.ativo = true
    )
  );

DROP POLICY IF EXISTS suporte_conversas_insert_propria ON public.suporte_conversas;
CREATE POLICY suporte_conversas_insert_propria
  ON public.suporte_conversas
  FOR INSERT
  TO authenticated
  WITH CHECK (
    aberto_por_usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

-- ------------------------------------------------------------
-- 3) Mensagens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suporte_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public.suporte_conversas (id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  remetente_usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  remetente_tipo text NOT NULL,
  tipo text NOT NULL,
  texto text,
  arquivo_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suporte_mensagens_remetente_check
    CHECK (remetente_tipo = ANY (ARRAY['cliente', 'master']::text[])),
  CONSTRAINT suporte_mensagens_tipo_check
    CHECK (tipo = ANY (ARRAY['texto', 'imagem']::text[])),
  CONSTRAINT suporte_mensagens_conteudo_check
    CHECK (
      (tipo = 'texto' AND texto IS NOT NULL AND length(btrim(texto)) > 0 AND arquivo_path IS NULL)
      OR
      (tipo = 'imagem' AND arquivo_path IS NOT NULL AND length(btrim(arquivo_path)) > 0)
    )
);

CREATE INDEX IF NOT EXISTS suporte_mensagens_conversa_created_idx
  ON public.suporte_mensagens (conversa_id, created_at);

CREATE INDEX IF NOT EXISTS suporte_mensagens_empresa_idx
  ON public.suporte_mensagens (empresa_id);

ALTER TABLE public.suporte_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suporte_mensagens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.suporte_mensagens FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.suporte_mensagens TO authenticated;
GRANT ALL ON TABLE public.suporte_mensagens TO service_role;

DROP POLICY IF EXISTS suporte_mensagens_select_propria ON public.suporte_mensagens;
CREATE POLICY suporte_mensagens_select_propria
  ON public.suporte_mensagens
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.suporte_conversas c
      WHERE c.id = conversa_id
        AND c.aberto_por_usuario_id = auth.uid()
        AND c.empresa_id = suporte_mensagens.empresa_id
        AND public.tem_acesso_empresa(c.empresa_id)
    )
  );

DROP POLICY IF EXISTS suporte_mensagens_select_master ON public.suporte_mensagens;
CREATE POLICY suporte_mensagens_select_master
  ON public.suporte_mensagens
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.administradores_plataforma a
      WHERE a.usuario_id = auth.uid()
        AND a.ativo = true
    )
  );

DROP POLICY IF EXISTS suporte_mensagens_insert_cliente ON public.suporte_mensagens;
CREATE POLICY suporte_mensagens_insert_cliente
  ON public.suporte_mensagens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    remetente_usuario_id = auth.uid()
    AND remetente_tipo = 'cliente'
    AND public.tem_acesso_empresa(empresa_id)
    AND EXISTS (
      SELECT 1
      FROM public.suporte_conversas c
      WHERE c.id = conversa_id
        AND c.aberto_por_usuario_id = auth.uid()
        AND c.empresa_id = suporte_mensagens.empresa_id
    )
  );

CREATE OR REPLACE FUNCTION public.suporte_apos_mensagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.suporte_conversas
  SET
    ultima_mensagem_em = NEW.created_at,
    updated_at = now(),
    status = CASE
      WHEN NEW.remetente_tipo = 'cliente' THEN 'aguardando_suporte'
      WHEN status = 'encerrada' THEN status
      ELSE 'aguardando_cliente'
    END
  WHERE id = NEW.conversa_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suporte_mensagens_apos_insert ON public.suporte_mensagens;
CREATE TRIGGER suporte_mensagens_apos_insert
AFTER INSERT ON public.suporte_mensagens
FOR EACH ROW
EXECUTE FUNCTION public.suporte_apos_mensagem();

REVOKE ALL ON FUNCTION public.suporte_apos_mensagem() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Leituras por usuário
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suporte_conversa_leituras (
  conversa_id uuid NOT NULL REFERENCES public.suporte_conversas (id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  ultima_leitura_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversa_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS suporte_conversa_leituras_usuario_idx
  ON public.suporte_conversa_leituras (usuario_id);

ALTER TABLE public.suporte_conversa_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suporte_conversa_leituras FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.suporte_conversa_leituras FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.suporte_conversa_leituras TO authenticated;
GRANT ALL ON TABLE public.suporte_conversa_leituras TO service_role;

DROP POLICY IF EXISTS suporte_leituras_select_propria ON public.suporte_conversa_leituras;
CREATE POLICY suporte_leituras_select_propria
  ON public.suporte_conversa_leituras
  FOR SELECT
  TO authenticated
  USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS suporte_leituras_select_master ON public.suporte_conversa_leituras;
CREATE POLICY suporte_leituras_select_master
  ON public.suporte_conversa_leituras
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.administradores_plataforma a
      WHERE a.usuario_id = auth.uid()
        AND a.ativo = true
    )
  );

DROP POLICY IF EXISTS suporte_leituras_insert_propria ON public.suporte_conversa_leituras;
CREATE POLICY suporte_leituras_insert_propria
  ON public.suporte_conversa_leituras
  FOR INSERT
  TO authenticated
  WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS suporte_leituras_update_propria ON public.suporte_conversa_leituras;
CREATE POLICY suporte_leituras_update_propria
  ON public.suporte_conversa_leituras
  FOR UPDATE
  TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- ------------------------------------------------------------
-- 5) Realtime
-- ------------------------------------------------------------
ALTER TABLE public.suporte_conversas REPLICA IDENTITY FULL;
ALTER TABLE public.suporte_mensagens REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.suporte_conversas;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.suporte_mensagens;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 6) Storage privado
-- ------------------------------------------------------------
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'suporte-chat',
  'suporte-chat',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS suporte_chat_select ON storage.objects;
CREATE POLICY suporte_chat_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'suporte-chat'
  AND (
    EXISTS (
      SELECT 1
      FROM public.suporte_conversas c
      WHERE c.id::text = (storage.foldername(name))[2]
        AND c.empresa_id::text = (storage.foldername(name))[1]
        AND c.aberto_por_usuario_id = auth.uid()
        AND public.tem_acesso_empresa(c.empresa_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.administradores_plataforma a
      WHERE a.usuario_id = auth.uid()
        AND a.ativo = true
    )
  )
);

DROP POLICY IF EXISTS suporte_chat_insert ON storage.objects;
CREATE POLICY suporte_chat_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'suporte-chat'
  AND EXISTS (
    SELECT 1
    FROM public.suporte_conversas c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND c.empresa_id::text = (storage.foldername(name))[1]
      AND c.aberto_por_usuario_id = auth.uid()
      AND public.tem_acesso_empresa(c.empresa_id)
  )
);

COMMENT ON TABLE public.suporte_conversas IS
  'Atendimento de suporte da plataforma. Isolado por empresa e pelo usuário que abriu.';

COMMENT ON TABLE public.suporte_mensagens IS
  'Mensagens de texto ou imagem do suporte. Path privado; URL assinada só no servidor.';

COMMENT ON TABLE public.usuarios_preferencias_interface IS
  'Posição do botão da Central de Ajuda por usuario_id + empresa_id.';

NOTIFY pgrst, 'reload schema';

COMMIT;
