BEGIN;

-- Preferências de impressão dos comprovantes TEF neste computador.
-- empresa_id vem da sessão. Um computador da Empresa A não lê a Empresa B.

CREATE TABLE IF NOT EXISTS public.impressoes_comprovantes_tef (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  dispositivo_id uuid NOT NULL,
  impressora_nome text,
  papel text NOT NULL DEFAULT '80mm',
  imprimir_via_cliente boolean NOT NULL DEFAULT true,
  imprimir_via_estabelecimento boolean NOT NULL DEFAULT true,
  imprimir_recibo_comercial boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impressoes_comprovantes_tef_unico
    UNIQUE (empresa_id, usuario_id, dispositivo_id),
  CONSTRAINT impressoes_comprovantes_tef_papel_check
    CHECK (papel IN ('58mm', '80mm'))
);

CREATE INDEX IF NOT EXISTS impressoes_comprovantes_tef_empresa_idx
  ON public.impressoes_comprovantes_tef (empresa_id, usuario_id, dispositivo_id);

COMMENT ON TABLE public.impressoes_comprovantes_tef IS
  'Impressão automática das vias TEF e do recibo comercial neste computador, por usuário e empresa ativa.';

ALTER TABLE public.impressoes_comprovantes_tef ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_le_comprovantes_tef
  ON public.impressoes_comprovantes_tef;
CREATE POLICY usuario_le_comprovantes_tef
  ON public.impressoes_comprovantes_tef
  FOR SELECT
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

DROP POLICY IF EXISTS usuario_insere_comprovantes_tef
  ON public.impressoes_comprovantes_tef;
CREATE POLICY usuario_insere_comprovantes_tef
  ON public.impressoes_comprovantes_tef
  FOR INSERT
  TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

DROP POLICY IF EXISTS usuario_atualiza_comprovantes_tef
  ON public.impressoes_comprovantes_tef;
CREATE POLICY usuario_atualiza_comprovantes_tef
  ON public.impressoes_comprovantes_tef
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

DROP POLICY IF EXISTS usuario_remove_comprovantes_tef
  ON public.impressoes_comprovantes_tef;
CREATE POLICY usuario_remove_comprovantes_tef
  ON public.impressoes_comprovantes_tef
  FOR DELETE
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

REVOKE ALL ON TABLE public.impressoes_comprovantes_tef FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.impressoes_comprovantes_tef
  TO authenticated;

GRANT ALL
  ON TABLE public.impressoes_comprovantes_tef
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
