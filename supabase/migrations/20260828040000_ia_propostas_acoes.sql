BEGIN;

-- ============================================================
-- UltraPDV — Assistente IA Fase 3
-- Propostas de ação persistidas, confirmação e auditoria.
-- Não aplicar remoto nesta sessão. Não executar supabase db reset.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ia_propostas_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL
    REFERENCES public.empresas (id)
    ON DELETE CASCADE,
  usuario_id uuid NOT NULL
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE,
  conversa_id uuid NOT NULL,
  tipo text NOT NULL,
  entidade_tipo text NOT NULL,
  entidade_id uuid,
  descricao text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  hash_estado text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  idempotency_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  executed_at timestamptz,
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ia_propostas_acoes_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT ia_propostas_acoes_conversa_fkey
    FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.ia_conversas (empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT ia_propostas_acoes_tipo_check
    CHECK (tipo IN (
      'atualizacao_fiscal_produto',
      'atribuicao_grupo_fiscal',
      'criacao_grupo_fiscal',
      'atualizacao_basica_produto',
      'notificacao_lida',
      'notificacao_dispensar',
      'notificacao_adiar',
      'desfazer'
    )),

  CONSTRAINT ia_propostas_acoes_entidade_check
    CHECK (entidade_tipo IN (
      'produto',
      'grupo_fiscal',
      'notificacao',
      'desfazer'
    )),

  CONSTRAINT ia_propostas_acoes_status_check
    CHECK (status IN (
      'pendente',
      'confirmada',
      'executada',
      'cancelada',
      'expirada',
      'falhou'
    )),

  CONSTRAINT ia_propostas_acoes_payload_check
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT ia_propostas_acoes_resultado_check
    CHECK (jsonb_typeof(resultado) = 'object'),

  CONSTRAINT ia_propostas_acoes_descricao_check
    CHECK (char_length(btrim(descricao)) BETWEEN 1 AND 500),

  CONSTRAINT ia_propostas_acoes_idempotency_key
    UNIQUE (empresa_id, idempotency_key)
);

COMMENT ON TABLE public.ia_propostas_acoes IS
  'Propostas de escrita do Assistente IA. Payload imutável após insert. Isolado por empresa + usuário.';

CREATE INDEX IF NOT EXISTS ix_ia_propostas_acoes_conversa
  ON public.ia_propostas_acoes (empresa_id, conversa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_ia_propostas_acoes_usuario_status
  ON public.ia_propostas_acoes (empresa_id, usuario_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_ia_propostas_acoes_entidade
  ON public.ia_propostas_acoes (empresa_id, entidade_tipo, entidade_id)
  WHERE entidade_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ia_propostas_acoes_proteger_imutaveis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.payload IS DISTINCT FROM OLD.payload
      OR NEW.hash_estado IS DISTINCT FROM OLD.hash_estado
      OR NEW.tipo IS DISTINCT FROM OLD.tipo
      OR NEW.entidade_tipo IS DISTINCT FROM OLD.entidade_tipo
      OR NEW.entidade_id IS DISTINCT FROM OLD.entidade_id
      OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
      OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id
      OR NEW.conversa_id IS DISTINCT FROM OLD.conversa_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    THEN
      RAISE EXCEPTION 'Payload da proposta IA é imutável após a validação.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ia_propostas_acoes_imutaveis
  ON public.ia_propostas_acoes;
CREATE TRIGGER trg_ia_propostas_acoes_imutaveis
  BEFORE UPDATE ON public.ia_propostas_acoes
  FOR EACH ROW
  EXECUTE FUNCTION public.ia_propostas_acoes_proteger_imutaveis();

ALTER TABLE public.ia_auditoria
  DROP CONSTRAINT IF EXISTS ia_auditoria_entidade_check;

ALTER TABLE public.ia_auditoria
  ADD CONSTRAINT ia_auditoria_entidade_check
  CHECK (entidade IN (
    'produto_fiscal',
    'grupo_fiscal',
    'produto',
    'notificacao',
    'desfazer'
  ));

ALTER TABLE public.ia_auditoria
  ADD COLUMN IF NOT EXISTS conversa_id uuid;

ALTER TABLE public.ia_auditoria
  ADD COLUMN IF NOT EXISTS proposta_id uuid;

ALTER TABLE public.ia_auditoria
  ADD COLUMN IF NOT EXISTS tipo_acao text;

ALTER TABLE public.ia_auditoria
  ADD COLUMN IF NOT EXISTS resultado text;

ALTER TABLE public.ia_auditoria
  ADD COLUMN IF NOT EXISTS erro text;

ALTER TABLE public.ia_propostas_acoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_propostas_acoes_select_propria ON public.ia_propostas_acoes;
CREATE POLICY ia_propostas_acoes_select_propria
  ON public.ia_propostas_acoes
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS ia_propostas_acoes_insert_propria ON public.ia_propostas_acoes;
CREATE POLICY ia_propostas_acoes_insert_propria
  ON public.ia_propostas_acoes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

DROP POLICY IF EXISTS ia_propostas_acoes_update_propria ON public.ia_propostas_acoes;
CREATE POLICY ia_propostas_acoes_update_propria
  ON public.ia_propostas_acoes
  FOR UPDATE TO authenticated
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  )
  WITH CHECK (
    public.tem_acesso_empresa(empresa_id)
    AND usuario_id = auth.uid()
  );

REVOKE ALL ON TABLE public.ia_propostas_acoes FROM public, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ia_propostas_acoes TO authenticated;
GRANT ALL ON TABLE public.ia_propostas_acoes TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
