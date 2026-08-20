BEGIN;

-- ============================================================
-- UltraPDV — PIX Geranet (etapa 1, isolada do PDV e do fiscal)
-- Data: 2026-08-16
--
-- Configuração multiempresa + cobranças de teste.
-- Credenciais do PSP ficam no Vault. Chave PIX e recebedor
-- são públicos. venda_id permanece nulo nesta etapa.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ------------------------------------------------------------
-- 1. Configuração PIX por empresa
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integracoes_pix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  gateway text NOT NULL DEFAULT 'geranet',
  provedor text NOT NULL,
  ambiente text NOT NULL DEFAULT '2',
  ativo boolean NOT NULL DEFAULT true,
  chave_pix text,
  recebedor_nome text,
  recebedor_cep text,
  recebedor_cidade text,
  recebedor_uf text,
  credenciais_configuradas boolean NOT NULL DEFAULT false,
  certificado_configurado boolean NOT NULL DEFAULT false,
  configuracao_publica jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracoes_pix_empresa_unique UNIQUE (empresa_id),
  CONSTRAINT integracoes_pix_gateway_check CHECK (gateway = 'geranet'),
  CONSTRAINT integracoes_pix_ambiente_check CHECK (ambiente IN ('1', '2')),
  CONSTRAINT integracoes_pix_provedor_check CHECK (
    provedor IN (
      'shipay',
      'bancodobrasil',
      'itau',
      'santander',
      'sicredi',
      'sicoob',
      'pagseguro',
      'gerencianet',
      'efibank',
      'bradesco',
      'pixpdv',
      'inter',
      'ailos',
      'matera',
      'cielo',
      'mercadopago',
      'gate2all',
      'banrisul',
      'c6bank',
      'appless',
      'qqpag'
    )
  )
);

COMMENT ON TABLE public.integracoes_pix IS
  'Configuração pública PIX Geranet por empresa. Segredos do PSP não entram nesta tabela.';

CREATE INDEX IF NOT EXISTS ix_integracoes_pix_empresa
  ON public.integracoes_pix (empresa_id);

-- ------------------------------------------------------------
-- 2. Cobranças PIX
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cobrancas_pix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  integracao_pix_id uuid REFERENCES public.integracoes_pix(id) ON DELETE SET NULL,
  venda_id uuid REFERENCES public.vendas(id) ON DELETE SET NULL,
  txid text,
  valor numeric(12, 2) NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  provedor text,
  ambiente text,
  dados_publicos jsonb NOT NULL DEFAULT '{}'::jsonb,
  geranet_http_status integer,
  geranet_situacao text,
  geranet_mensagem text,
  expira_em timestamptz,
  pago_em timestamptz,
  cancelado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobrancas_pix_status_check CHECK (
    status IN ('pendente', 'paga', 'cancelada', 'erro', 'expirada')
  ),
  CONSTRAINT cobrancas_pix_ambiente_check CHECK (
    ambiente IS NULL OR ambiente IN ('1', '2')
  ),
  CONSTRAINT cobrancas_pix_valor_check CHECK (valor > 0)
);

COMMENT ON TABLE public.cobrancas_pix IS
  'Cobranças PIX Geranet. venda_id nulo nesta etapa (cobrança de teste).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_cobrancas_pix_empresa_txid
  ON public.cobrancas_pix (empresa_id, txid)
  WHERE txid IS NOT NULL AND btrim(txid) <> '';

CREATE INDEX IF NOT EXISTS ix_cobrancas_pix_empresa_criada
  ON public.cobrancas_pix (empresa_id, created_at DESC);

-- ------------------------------------------------------------
-- 3. Log sanitizado de operações
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pix_operacoes_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cobranca_id uuid REFERENCES public.cobrancas_pix(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  provedor text,
  http_status integer,
  situacao text,
  mensagem text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pix_operacoes_log IS
  'Log PIX sanitizado. Nunca armazenar Authorization, certificado, senha ou client secret.';

CREATE INDEX IF NOT EXISTS ix_pix_operacoes_log_empresa
  ON public.pix_operacoes_log (empresa_id, created_at DESC);

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------

ALTER TABLE public.integracoes_pix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas_pix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pix_operacoes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integracoes_pix_select_empresa ON public.integracoes_pix;
DROP POLICY IF EXISTS integracoes_pix_insert_empresa ON public.integracoes_pix;
DROP POLICY IF EXISTS integracoes_pix_update_empresa ON public.integracoes_pix;
DROP POLICY IF EXISTS cobrancas_pix_select_empresa ON public.cobrancas_pix;
DROP POLICY IF EXISTS cobrancas_pix_insert_empresa ON public.cobrancas_pix;
DROP POLICY IF EXISTS cobrancas_pix_update_empresa ON public.cobrancas_pix;
DROP POLICY IF EXISTS pix_operacoes_log_select_empresa ON public.pix_operacoes_log;
DROP POLICY IF EXISTS pix_operacoes_log_insert_empresa ON public.pix_operacoes_log;

CREATE POLICY integracoes_pix_select_empresa
ON public.integracoes_pix
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY integracoes_pix_insert_empresa
ON public.integracoes_pix
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

CREATE POLICY integracoes_pix_update_empresa
ON public.integracoes_pix
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

CREATE POLICY cobrancas_pix_select_empresa
ON public.cobrancas_pix
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY cobrancas_pix_insert_empresa
ON public.cobrancas_pix
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

CREATE POLICY cobrancas_pix_update_empresa
ON public.cobrancas_pix
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

CREATE POLICY pix_operacoes_log_select_empresa
ON public.pix_operacoes_log
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY pix_operacoes_log_insert_empresa
ON public.pix_operacoes_log
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.integracoes_pix FROM anon;
REVOKE ALL ON public.cobrancas_pix FROM anon;
REVOKE ALL ON public.pix_operacoes_log FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.integracoes_pix TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cobrancas_pix TO authenticated;
GRANT SELECT, INSERT ON public.pix_operacoes_log TO authenticated;

-- ------------------------------------------------------------
-- 5. Vault — credenciais bancárias (separado do cofre fiscal)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.salvar_segredo_bancario(
  p_empresa_id uuid,
  p_tipo text,
  p_valor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_nome text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado';
  END IF;

  IF NOT public.tem_acesso_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'sem acesso a empresa';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = p_empresa_id
      AND ue.ativo = true
      AND ue.perfil = 'administrador'
  ) THEN
    RAISE EXCEPTION 'somente administrador pode gravar segredo bancario';
  END IF;

  IF p_tipo NOT IN (
    'credenciais_json',
    'cliente_id',
    'cliente_segredo',
    'certificado_pfx',
    'senha_certificado_pfx'
  ) THEN
    RAISE EXCEPTION 'tipo de segredo bancario invalido';
  END IF;

  IF p_valor IS NULL OR btrim(p_valor) = '' THEN
    RAISE EXCEPTION 'segredo bancario vazio';
  END IF;

  v_nome := 'pix/' || p_empresa_id::text || '/' || p_tipo;

  SELECT s.id
  INTO v_id
  FROM vault.secrets s
  WHERE s.name = v_nome
  LIMIT 1;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_valor, v_nome, 'UltraPDV PIX Geranet');
  ELSE
    PERFORM vault.update_secret(v_id, p_valor, v_nome, 'UltraPDV PIX Geranet');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.obter_segredos_bancarios(
  p_empresa_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_saida jsonb := '{}'::jsonb;
  v_linha record;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'obter_segredos_bancarios restrito ao servidor';
  END IF;

  FOR v_linha IN
    SELECT
      regexp_replace(s.name, '^pix/' || p_empresa_id::text || '/', '') AS tipo,
      s.decrypted_secret AS valor
    FROM vault.decrypted_secrets s
    WHERE s.name LIKE ('pix/' || p_empresa_id::text || '/%')
  LOOP
    v_saida := v_saida || jsonb_build_object(v_linha.tipo, v_linha.valor);
  END LOOP;

  RETURN v_saida;
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_segredo_bancario(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salvar_segredo_bancario(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.salvar_segredo_bancario(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.obter_segredos_bancarios(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.obter_segredos_bancarios(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.obter_segredos_bancarios(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.obter_segredos_bancarios(uuid) TO service_role;

COMMIT;
