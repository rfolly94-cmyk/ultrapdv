BEGIN;

-- Preferências visuais do PDV por usuário dentro da empresa ativa.
-- Isolamento: usuario_id + empresa_id. empresa_id da sessão, nunca do cliente.

CREATE TABLE IF NOT EXISTS public.usuarios_preferencias_pdv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  cor_primaria text NOT NULL DEFAULT '#2563eb',
  mostrar_logo_centro boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_preferencias_pdv_unico
    UNIQUE (usuario_id, empresa_id),
  CONSTRAINT usuarios_preferencias_pdv_cor_check
    CHECK (cor_primaria ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX IF NOT EXISTS usuarios_preferencias_pdv_empresa_usuario_idx
  ON public.usuarios_preferencias_pdv (empresa_id, usuario_id);

COMMENT ON TABLE public.usuarios_preferencias_pdv IS
  'Cor e logo centralizada do PDV por usuário em cada empresa. Sem vazamento entre tenants.';

ALTER TABLE public.usuarios_preferencias_pdv ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_le_proprias_preferencias_pdv
  ON public.usuarios_preferencias_pdv;
CREATE POLICY usuario_le_proprias_preferencias_pdv
  ON public.usuarios_preferencias_pdv
  FOR SELECT
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

DROP POLICY IF EXISTS usuario_insere_proprias_preferencias_pdv
  ON public.usuarios_preferencias_pdv;
CREATE POLICY usuario_insere_proprias_preferencias_pdv
  ON public.usuarios_preferencias_pdv
  FOR INSERT
  TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

DROP POLICY IF EXISTS usuario_atualiza_proprias_preferencias_pdv
  ON public.usuarios_preferencias_pdv;
CREATE POLICY usuario_atualiza_proprias_preferencias_pdv
  ON public.usuarios_preferencias_pdv
  FOR UPDATE
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  )
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

REVOKE ALL ON TABLE public.usuarios_preferencias_pdv FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.usuarios_preferencias_pdv
  TO authenticated;

GRANT ALL
  ON TABLE public.usuarios_preferencias_pdv
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
