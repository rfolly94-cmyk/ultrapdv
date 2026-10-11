-- TEF multiempresa.
-- Este arquivo só prepara o schema. Não foi aplicado neste ambiente.
-- Não guarda PAN, PIN, trilha ou credencial de adquirente.

-- Dependências já presentes no schema: public.empresas(id), public.vendas(id, empresa_id),
-- public.tem_acesso_empresa(uuid) e gen_random_uuid().
-- Não existe objeto tef_* anterior. Aplicar uma única vez.
-- CREATE TABLE IF NOT EXISTS não acrescenta colunas se a tabela já tiver sido criada por uma tentativa parcial.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_plataforma (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  habilitada boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.tef_plataforma (id, habilitada)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tef_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas (id),
  habilitado boolean NOT NULL DEFAULT false,
  ambiente text NOT NULL DEFAULT 'homologacao',
  estabelecimento text NOT NULL DEFAULT '',
  ponto_captura text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_configuracoes_ambiente_check
    CHECK (ambiente IN ('homologacao', 'producao'))
);

CREATE TABLE IF NOT EXISTS public.tef_terminais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  codigo text NOT NULL,
  dispositivo_id uuid NOT NULL,
  chave_publica text NOT NULL DEFAULT '',
  chave_id uuid,
  estabelecimento text NOT NULL DEFAULT '',
  ponto_captura text NOT NULL DEFAULT '',
  ativo boolean NOT NULL DEFAULT true,
  revogada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_terminais_codigo_check CHECK (codigo ~ '^[A-Za-z0-9._-]{1,40}$'),
  CONSTRAINT tef_terminais_empresa_codigo_key UNIQUE (empresa_id, codigo)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tef_terminais_dispositivo_ativo
  ON public.tef_terminais (dispositivo_id)
  WHERE ativo;

CREATE TABLE IF NOT EXISTS public.tef_operacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  terminal_id uuid NOT NULL REFERENCES public.tef_terminais (id),
  identificador text NOT NULL,
  idempotency_key uuid NOT NULL,
  modalidade text NOT NULL,
  valor_centavos integer NOT NULL,
  status text NOT NULL,
  nsu text,
  autorizacao text,
  rede text,
  finalizacao text,
  venda_id uuid REFERENCES public.vendas (id) ON DELETE RESTRICT,
  teste boolean NOT NULL DEFAULT false,
  desafio text NOT NULL,
  usuario_id uuid NOT NULL,
  segredo_vinculo_hash text NOT NULL,
  venda_idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_operacoes_modalidade_check CHECK (modalidade IN ('debito', 'credito')),
  CONSTRAINT tef_operacoes_valor_check CHECK (valor_centavos > 0),
  CONSTRAINT tef_operacoes_status_check CHECK (
    status IN (
      'iniciada',
      'autorizada',
      'recusada',
      'cancelada',
      'timeout',
      'desconhecida',
      'vinculada',
      'confirmada',
      'desfeita',
      'desfazimento_pendente',
      'reconciliacao'
    )
  ),
  CONSTRAINT tef_operacoes_empresa_identificador_key UNIQUE (empresa_id, identificador),
  CONSTRAINT tef_operacoes_empresa_idempotency_key UNIQUE (empresa_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tef_operacao_aberta_terminal
  ON public.tef_operacoes (terminal_id)
  WHERE status IN (
    'iniciada',
    'desconhecida',
    'desfazimento_pendente',
    'reconciliacao'
  );

CREATE INDEX IF NOT EXISTS ix_tef_operacoes_empresa_status
  ON public.tef_operacoes (empresa_id, status);

CREATE TABLE IF NOT EXISTS public.tef_pareamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  usuario_id uuid NOT NULL,
  codigo_hash text NOT NULL,
  estabelecimento text NOT NULL,
  ponto_captura text NOT NULL,
  dispositivo_id uuid,
  expira_em timestamptz NOT NULL,
  consumido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tef_pareamentos_empresa_codigo
  ON public.tef_pareamentos (empresa_id, codigo_hash)
  WHERE consumido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.tef_chaves_revogadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  dispositivo_id uuid NOT NULL,
  chave_publica text NOT NULL,
  chave_id uuid,
  revogada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_chaves_revogadas_chave_key UNIQUE (chave_publica)
);

ALTER TABLE public.tef_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tef_configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tef_terminais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tef_operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tef_pareamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tef_chaves_revogadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_plataforma_select ON public.tef_plataforma;
CREATE POLICY tef_plataforma_select
  ON public.tef_plataforma
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS tef_configuracoes_select_empresa ON public.tef_configuracoes;
CREATE POLICY tef_configuracoes_select_empresa
  ON public.tef_configuracoes
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS tef_terminais_select_empresa ON public.tef_terminais;
CREATE POLICY tef_terminais_select_empresa
  ON public.tef_terminais
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS tef_operacoes_select_empresa ON public.tef_operacoes;
CREATE POLICY tef_operacoes_select_empresa
  ON public.tef_operacoes
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS tef_pareamentos_select_empresa ON public.tef_pareamentos;
CREATE POLICY tef_pareamentos_select_empresa
  ON public.tef_pareamentos
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS tef_chaves_revogadas_select_empresa ON public.tef_chaves_revogadas;
CREATE POLICY tef_chaves_revogadas_select_empresa
  ON public.tef_chaves_revogadas
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_plataforma FROM anon, authenticated;
REVOKE ALL ON public.tef_configuracoes FROM anon, authenticated;
REVOKE ALL ON public.tef_terminais FROM anon, authenticated;
REVOKE ALL ON public.tef_operacoes FROM anon, authenticated;
REVOKE ALL ON public.tef_pareamentos FROM anon, authenticated;
REVOKE ALL ON public.tef_chaves_revogadas FROM anon, authenticated;

GRANT SELECT ON public.tef_plataforma TO authenticated;
GRANT SELECT ON public.tef_configuracoes TO authenticated;
GRANT SELECT ON public.tef_terminais TO authenticated;
GRANT SELECT ON public.tef_operacoes TO authenticated;
GRANT SELECT ON public.tef_pareamentos TO authenticated;
GRANT SELECT ON public.tef_chaves_revogadas TO authenticated;

GRANT SELECT, UPDATE ON public.tef_plataforma TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tef_configuracoes TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tef_terminais TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tef_operacoes TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tef_pareamentos TO service_role;
GRANT SELECT, INSERT ON public.tef_chaves_revogadas TO service_role;

COMMENT ON TABLE public.tef_operacoes IS
  'Operação TEF da empresa. NSU, autorização e finalização sem assinatura do terminal não autorizam nem confirmam. Confirmação financeira só depois de venda_id da mesma empresa. Sem dados de cartão.';

COMMENT ON COLUMN public.tef_operacoes.nsu IS
  'NSU persistido apenas depois de prova assinada pelo terminal. Valor enviado pelo navegador não é autorização.';

COMMENT ON COLUMN public.tef_terminais.chave_publica IS
  'Chave pública Ed25519 do Connector. A chave privada não é gravada no banco.';

CREATE OR REPLACE FUNCTION public.tef_operacoes_venda_mesma_empresa()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  empresa_venda uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'empresa_id do TEF é imutável';
  END IF;
  IF NEW.venda_id IS NOT NULL THEN
    SELECT v.empresa_id INTO empresa_venda
    FROM public.vendas v
    WHERE v.id = NEW.venda_id;
    IF empresa_venda IS NULL OR empresa_venda IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'venda TEF de outra empresa';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tef_operacoes_venda_mesma_empresa ON public.tef_operacoes;
CREATE TRIGGER tef_operacoes_venda_mesma_empresa
  BEFORE INSERT OR UPDATE ON public.tef_operacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.tef_operacoes_venda_mesma_empresa();

REVOKE ALL ON FUNCTION public.tef_operacoes_venda_mesma_empresa() FROM PUBLIC, anon, authenticated;

COMMIT;
