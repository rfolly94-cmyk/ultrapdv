BEGIN;

-- UltraPDV — gaveta de dinheiro (abertura física via Connector).
-- Configuração automática por empresa. Auditoria no Caixa sem movimentação financeira.
-- Não edita migrations anteriores.

ALTER TABLE public.caixa_configuracoes
  ADD COLUMN IF NOT EXISTS abrir_gaveta_apos_venda_dinheiro boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.caixa_configuracoes.abrir_gaveta_apos_venda_dinheiro IS
  'Se true, após finalizar venda com pagamento em dinheiro o PDV solicita abertura física da gaveta no Connector local. Falha não reverte a venda. Default false.';

CREATE TABLE IF NOT EXISTS public.caixa_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  caixa_id uuid NOT NULL,
  usuario_id uuid NOT NULL REFERENCES public.usuarios (id),
  tipo text NOT NULL,
  origem text NOT NULL,
  venda_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixa_eventos_empresa_id_key UNIQUE (empresa_id, id),
  CONSTRAINT caixa_eventos_caixa_fk
    FOREIGN KEY (empresa_id, caixa_id)
    REFERENCES public.caixas (empresa_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT caixa_eventos_tipo_check CHECK (tipo = 'abertura_gaveta'),
  CONSTRAINT caixa_eventos_origem_check CHECK (
    origem = ANY (ARRAY['caixa', 'pdv', 'venda']::text[])
  )
);

COMMENT ON TABLE public.caixa_eventos IS
  'Eventos operacionais do Caixa que não alteram saldo (ex.: abertura física da gaveta).';

CREATE INDEX IF NOT EXISTS ix_caixa_eventos_caixa_created
  ON public.caixa_eventos (empresa_id, caixa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_caixa_eventos_venda
  ON public.caixa_eventos (empresa_id, venda_id)
  WHERE venda_id IS NOT NULL;

ALTER TABLE public.caixa_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_caixa_eventos ON public.caixa_eventos;
CREATE POLICY usuario_visualiza_caixa_eventos
  ON public.caixa_eventos
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.caixa_eventos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.caixa_eventos FROM authenticated;
GRANT SELECT ON TABLE public.caixa_eventos TO authenticated;
GRANT ALL ON TABLE public.caixa_eventos TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_definir_abrir_gaveta_apos_venda_dinheiro(
  p_ativo boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_ativo boolean := COALESCE(p_ativo, false);
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  INSERT INTO public.caixa_configuracoes (
    empresa_id,
    abrir_gaveta_apos_venda_dinheiro,
    updated_at
  )
  VALUES (v_empresa_id, v_ativo, now())
  ON CONFLICT (empresa_id) DO UPDATE
  SET
    abrir_gaveta_apos_venda_dinheiro = EXCLUDED.abrir_gaveta_apos_venda_dinheiro,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'abrir_gaveta_apos_venda_dinheiro', v_ativo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_definir_abrir_gaveta_apos_venda_dinheiro(boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_definir_abrir_gaveta_apos_venda_dinheiro(boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_definir_abrir_gaveta_apos_venda_dinheiro(boolean)
  TO service_role;

COMMENT ON FUNCTION public.rpc_definir_abrir_gaveta_apos_venda_dinheiro(boolean) IS
  'Liga ou desliga a abertura automática da gaveta após venda em dinheiro da empresa ativa. Permissão é aplicada no servidor da aplicação.';

CREATE OR REPLACE FUNCTION public.rpc_registrar_abertura_gaveta(
  p_origem text,
  p_venda_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_caixa_id uuid;
  v_origem text := lower(btrim(COALESCE(p_origem, '')));
  v_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF v_origem NOT IN ('caixa', 'pdv', 'venda') THEN
    RAISE EXCEPTION 'Origem da abertura da gaveta inválida.';
  END IF;

  SELECT c.id
  INTO v_caixa_id
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.status = 'aberto'
    AND c.filial_id IS NULL
  FOR UPDATE;

  IF v_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Não há caixa aberto para registrar a abertura da gaveta.';
  END IF;

  IF p_venda_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.vendas AS v
      WHERE v.empresa_id = v_empresa_id
        AND v.id = p_venda_id
    ) THEN
      RAISE EXCEPTION 'Venda não encontrada nesta empresa.';
    END IF;
  END IF;

  INSERT INTO public.caixa_eventos (
    empresa_id,
    caixa_id,
    usuario_id,
    tipo,
    origem,
    venda_id
  )
  VALUES (
    v_empresa_id,
    v_caixa_id,
    v_usuario_id,
    'abertura_gaveta',
    v_origem,
    CASE WHEN v_origem = 'venda' THEN p_venda_id ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'empresa_id', v_empresa_id,
    'caixa_id', v_caixa_id,
    'tipo', 'abertura_gaveta',
    'origem', v_origem
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_registrar_abertura_gaveta(text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_registrar_abertura_gaveta(text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_registrar_abertura_gaveta(text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.rpc_registrar_abertura_gaveta(text, uuid) IS
  'Registra abertura física da gaveta no histórico do Caixa aberto da empresa ativa. Não altera saldo.';

COMMIT;
