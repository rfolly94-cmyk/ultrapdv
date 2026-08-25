BEGIN;

-- UltraPDV — controle de Caixa por empresa (ativado/desativado).
-- Não edita migrations anteriores. Default true preserva o comportamento atual.

ALTER TABLE public.caixa_configuracoes
  ADD COLUMN IF NOT EXISTS controle_caixa_ativo boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.caixa_configuracoes.controle_caixa_ativo IS
  'Se true, vendas/recebimentos exigem sessão aberta e entram no livro. Se false, opera sem Caixa; histórico permanece.';

CREATE OR REPLACE FUNCTION public.rpc_definir_controle_caixa(
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
  v_ativo boolean := COALESCE(p_ativo, true);
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  PERFORM pg_advisory_xact_lock(hashtext('caixa-abrir:' || v_empresa_id::text));

  IF v_ativo IS FALSE AND EXISTS (
    SELECT 1
    FROM public.caixas AS c
    WHERE c.empresa_id = v_empresa_id
      AND c.status = 'aberto'
      AND c.filial_id IS NULL
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Não é possível desativar o controle de Caixa enquanto houver um Caixa aberto. Feche a sessão atual primeiro.';
  END IF;

  INSERT INTO public.caixa_configuracoes (
    empresa_id,
    controle_caixa_ativo,
    updated_at
  )
  VALUES (v_empresa_id, v_ativo, now())
  ON CONFLICT (empresa_id) DO UPDATE
  SET
    controle_caixa_ativo = EXCLUDED.controle_caixa_ativo,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa_id,
    'controle_caixa_ativo', v_ativo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_definir_controle_caixa(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_definir_controle_caixa(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_definir_controle_caixa(boolean) TO service_role;

COMMENT ON FUNCTION public.rpc_definir_controle_caixa(boolean) IS
  'Liga ou desliga o controle de Caixa da empresa ativa. Recusa desativar com sessão aberta. Permissão é aplicada no servidor da aplicação.';

COMMIT;
