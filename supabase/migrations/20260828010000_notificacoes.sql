BEGIN;

-- ============================================================
-- UltraPDV — Central de notificações (Fase 1)
-- Data: 2026-08-28
--
-- Observa o estado real dos módulos (estoque_atual, estoque_lotes,
-- carteira, fiscal_emissoes, caixas). Não altera regras desses módulos.
-- Isolamento: empresa_id + RLS tem_acesso_empresa.
-- Estado de leitura/dispensa/adiamento é por usuário, não global.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notificacoes_configuracoes (
  empresa_id uuid PRIMARY KEY
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  configuracao jsonb NOT NULL DEFAULT '{}'::jsonb,
  sincronizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notificacoes_configuracoes_objeto_check
    CHECK (jsonb_typeof(configuracao) = 'object')
);

COMMENT ON TABLE public.notificacoes_configuracoes IS
  'Preferências de avisos da empresa ativa. Isolado por empresa_id. Não envia e-mail, WhatsApp nem push nesta fase.';

CREATE TABLE IF NOT EXISTS public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  tipo text NOT NULL,
  categoria text NOT NULL,
  nivel text NOT NULL,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  entidade_tipo text,
  entidade_id uuid,
  action_url text,
  chave_deduplicacao text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ativa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,

  CONSTRAINT notificacoes_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT notificacoes_empresa_chave_key
    UNIQUE (empresa_id, chave_deduplicacao),

  CONSTRAINT notificacoes_tipo_check
    CHECK (tipo IN (
      'estoque_baixo',
      'estoque_zerado',
      'estoque_negativo',
      'lote_vencendo',
      'lote_vencido',
      'carteira_vencida',
      'fiscal_rejeitada',
      'fiscal_aguardando_reconciliacao',
      'fiscal_certificado_vencendo',
      'caixa_aberto_anterior'
    )),

  CONSTRAINT notificacoes_categoria_check
    CHECK (categoria IN (
      'estoque',
      'validade',
      'financeiro',
      'fiscal',
      'caixa',
      'sistema'
    )),

  CONSTRAINT notificacoes_nivel_check
    CHECK (nivel IN ('info', 'atencao', 'importante', 'critico')),

  CONSTRAINT notificacoes_status_check
    CHECK (status IN ('ativa', 'resolvida')),

  CONSTRAINT notificacoes_titulo_check
    CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 160),

  CONSTRAINT notificacoes_mensagem_check
    CHECK (char_length(btrim(mensagem)) BETWEEN 1 AND 500),

  CONSTRAINT notificacoes_chave_check
    CHECK (char_length(btrim(chave_deduplicacao)) BETWEEN 1 AND 180),

  CONSTRAINT notificacoes_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT notificacoes_resolvida_check
    CHECK (
      (status = 'ativa' AND resolved_at IS NULL)
      OR (status = 'resolvida' AND resolved_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.notificacoes IS
  'Aviso operacional da empresa ativa. Uma chave de deduplicação por empresa. Isolado por empresa_id.';

CREATE INDEX IF NOT EXISTS ix_notificacoes_empresa_status
  ON public.notificacoes (empresa_id, status);

CREATE INDEX IF NOT EXISTS ix_notificacoes_empresa_categoria
  ON public.notificacoes (empresa_id, categoria);

CREATE INDEX IF NOT EXISTS ix_notificacoes_empresa_tipo_status
  ON public.notificacoes (empresa_id, tipo, status);

CREATE TABLE IF NOT EXISTS public.notificacoes_usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  notificacao_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  lida_em timestamptz,
  dispensada_em timestamptz,
  adiada_ate timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notificacoes_usuarios_empresa_notificacao_usuario_key
    UNIQUE (empresa_id, notificacao_id, usuario_id),

  CONSTRAINT notificacoes_usuarios_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,

  CONSTRAINT notificacoes_usuarios_notificacao_fkey
    FOREIGN KEY (empresa_id, notificacao_id)
    REFERENCES public.notificacoes (empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT notificacoes_usuarios_usuario_fkey
    FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.notificacoes_usuarios IS
  'Leitura, dispensa e adiamento por usuário da empresa. Não marca a notificação como lida para os demais.';

CREATE INDEX IF NOT EXISTS ix_notificacoes_usuarios_usuario
  ON public.notificacoes_usuarios (empresa_id, usuario_id);

CREATE INDEX IF NOT EXISTS ix_notificacoes_usuarios_adiada
  ON public.notificacoes_usuarios (empresa_id, usuario_id, adiada_ate);

DROP TRIGGER IF EXISTS notificacoes_configuracoes_set_updated_at
  ON public.notificacoes_configuracoes;
CREATE TRIGGER notificacoes_configuracoes_set_updated_at
  BEFORE UPDATE ON public.notificacoes_configuracoes
  FOR EACH ROW
  EXECUTE FUNCTION public.ultrapdv_set_updated_at();

DROP TRIGGER IF EXISTS notificacoes_set_updated_at
  ON public.notificacoes;
CREATE TRIGGER notificacoes_set_updated_at
  BEFORE UPDATE ON public.notificacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.ultrapdv_set_updated_at();

DROP TRIGGER IF EXISTS notificacoes_usuarios_set_updated_at
  ON public.notificacoes_usuarios;
CREATE TRIGGER notificacoes_usuarios_set_updated_at
  BEFORE UPDATE ON public.notificacoes_usuarios
  FOR EACH ROW
  EXECUTE FUNCTION public.ultrapdv_set_updated_at();

CREATE OR REPLACE FUNCTION public.notificacoes_reset_estado_usuario_ao_reativar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'resolvida' AND NEW.status = 'ativa' THEN
    UPDATE public.notificacoes_usuarios
    SET
      lida_em = NULL,
      dispensada_em = NULL,
      adiada_ate = NULL
    WHERE empresa_id = NEW.empresa_id
      AND notificacao_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notificacoes_reset_estado_usuario_ao_reativar
  ON public.notificacoes;
CREATE TRIGGER notificacoes_reset_estado_usuario_ao_reativar
  AFTER UPDATE OF status ON public.notificacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.notificacoes_reset_estado_usuario_ao_reativar();

ALTER TABLE public.notificacoes_configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes_usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificacoes_configuracoes_select_empresa
  ON public.notificacoes_configuracoes;
CREATE POLICY notificacoes_configuracoes_select_empresa
  ON public.notificacoes_configuracoes
  FOR SELECT TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS notificacoes_configuracoes_insert_empresa
  ON public.notificacoes_configuracoes;
CREATE POLICY notificacoes_configuracoes_insert_empresa
  ON public.notificacoes_configuracoes
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS notificacoes_configuracoes_update_empresa
  ON public.notificacoes_configuracoes;
CREATE POLICY notificacoes_configuracoes_update_empresa
  ON public.notificacoes_configuracoes
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_empresa(empresa_id))
  WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS notificacoes_select_empresa
  ON public.notificacoes;
CREATE POLICY notificacoes_select_empresa
  ON public.notificacoes
  FOR SELECT TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS notificacoes_insert_empresa
  ON public.notificacoes;
CREATE POLICY notificacoes_insert_empresa
  ON public.notificacoes
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS notificacoes_update_empresa
  ON public.notificacoes;
CREATE POLICY notificacoes_update_empresa
  ON public.notificacoes
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_empresa(empresa_id))
  WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS notificacoes_usuarios_select_proprio
  ON public.notificacoes_usuarios;
CREATE POLICY notificacoes_usuarios_select_proprio
  ON public.notificacoes_usuarios
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS notificacoes_usuarios_insert_proprio
  ON public.notificacoes_usuarios;
CREATE POLICY notificacoes_usuarios_insert_proprio
  ON public.notificacoes_usuarios
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS notificacoes_usuarios_update_proprio
  ON public.notificacoes_usuarios;
CREATE POLICY notificacoes_usuarios_update_proprio
  ON public.notificacoes_usuarios
  FOR UPDATE TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  )
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS notificacoes_usuarios_delete_proprio
  ON public.notificacoes_usuarios;
CREATE POLICY notificacoes_usuarios_delete_proprio
  ON public.notificacoes_usuarios
  FOR DELETE TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

REVOKE ALL ON TABLE public.notificacoes_configuracoes FROM public, anon;
REVOKE ALL ON TABLE public.notificacoes FROM public, anon;
REVOKE ALL ON TABLE public.notificacoes_usuarios FROM public, anon;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.notificacoes_configuracoes TO authenticated;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.notificacoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.notificacoes_usuarios TO authenticated;

GRANT ALL ON TABLE public.notificacoes_configuracoes TO service_role;
GRANT ALL ON TABLE public.notificacoes TO service_role;
GRANT ALL ON TABLE public.notificacoes_usuarios TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
