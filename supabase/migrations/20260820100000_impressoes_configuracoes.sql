BEGIN;

-- Configuração de impressão por empresa + usuário + dispositivo (computador).
-- Isolamento multiempresa: empresa_id da sessão, nunca do cliente.
-- Um computador da Empresa A não lê nem grava configuração da Empresa B.

CREATE TABLE IF NOT EXISTS public.impressoes_configuracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  dispositivo_id uuid NOT NULL,
  tipo_documento text NOT NULL,
  impressora_nome text,
  papel text NOT NULL,
  copias integer NOT NULL DEFAULT 1,
  impressao_automatica boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impressoes_configuracoes_unico
    UNIQUE (empresa_id, usuario_id, dispositivo_id, tipo_documento),
  CONSTRAINT impressoes_configuracoes_tipo_check
    CHECK (tipo_documento IN ('recibo', 'danfe_nfce', 'danfe_nfe')),
  CONSTRAINT impressoes_configuracoes_papel_check
    CHECK (papel IN ('58mm', '80mm', 'a4')),
  CONSTRAINT impressoes_configuracoes_copias_check
    CHECK (copias >= 1 AND copias <= 10)
);

CREATE INDEX IF NOT EXISTS impressoes_configuracoes_empresa_usuario_disp_idx
  ON public.impressoes_configuracoes (empresa_id, usuario_id, dispositivo_id);

COMMENT ON TABLE public.impressoes_configuracoes IS
  'Impressoras deste computador, por usuário e empresa ativa. Sem configuração global nem vazamento entre tenants.';

ALTER TABLE public.impressoes_configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_le_proprias_impressoes_config
  ON public.impressoes_configuracoes;
CREATE POLICY usuario_le_proprias_impressoes_config
  ON public.impressoes_configuracoes
  FOR SELECT
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

DROP POLICY IF EXISTS usuario_insere_proprias_impressoes_config
  ON public.impressoes_configuracoes;
CREATE POLICY usuario_insere_proprias_impressoes_config
  ON public.impressoes_configuracoes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

DROP POLICY IF EXISTS usuario_atualiza_proprias_impressoes_config
  ON public.impressoes_configuracoes;
CREATE POLICY usuario_atualiza_proprias_impressoes_config
  ON public.impressoes_configuracoes
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

DROP POLICY IF EXISTS usuario_remove_proprias_impressoes_config
  ON public.impressoes_configuracoes;
CREATE POLICY usuario_remove_proprias_impressoes_config
  ON public.impressoes_configuracoes
  FOR DELETE
  TO authenticated
  USING (
    usuario_id = auth.uid()
    AND public.tem_acesso_empresa(empresa_id)
  );

REVOKE ALL ON TABLE public.impressoes_configuracoes FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.impressoes_configuracoes
  TO authenticated;

GRANT ALL
  ON TABLE public.impressoes_configuracoes
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
