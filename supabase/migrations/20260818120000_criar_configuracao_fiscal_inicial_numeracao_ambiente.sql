BEGIN;

-- ============================================================
-- UltraPDV — Alinhar criar_configuracao_fiscal_inicial
--             à numeração fiscal por ambiente
-- Data: 2026-08-18
--
-- 1 = Produção
-- 2 = Homologação (ambiente inicial de empresas_fiscal)
--
-- A função viva não estava nas migrations. CREATE OR REPLACE
-- versiona o corpo atual e corrige somente fiscal_numeracoes:
--   - informar ambiente (NOT NULL, sem DEFAULT)
--   - ON CONFLICT (empresa_id, modelo, ambiente, serie)
--
-- NÃO altera schema, UNIQUE, RLS, grants nem numeração existente.
-- Idempotente: DO NOTHING não reseta proximo_numero/ambiente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.criar_configuracao_fiscal_inicial(
  p_empresa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin

  if not public.eh_admin_empresa(p_empresa_id) then
    raise exception 'Sem permissão para configurar esta empresa.';
  end if;


  insert into public.empresas_fiscal (
    empresa_id,
    ambiente
  )
  values (
    p_empresa_id,
    2
  )
  on conflict (empresa_id) do nothing;


  -- Numeração inicial NF-e (homologação)

  insert into public.fiscal_numeracoes (
    empresa_id,
    modelo,
    serie,
    proximo_numero,
    ambiente
  )
  values (
    p_empresa_id,
    '55',
    1,
    1,
    2
  )
  on conflict (empresa_id, modelo, ambiente, serie)
  do nothing;


  -- Numeração inicial NFC-e (homologação)

  insert into public.fiscal_numeracoes (
    empresa_id,
    modelo,
    serie,
    proximo_numero,
    ambiente
  )
  values (
    p_empresa_id,
    '65',
    1,
    1,
    2
  )
  on conflict (empresa_id, modelo, ambiente, serie)
  do nothing;


  insert into public.fiscal_nfce_config (
    empresa_id
  )
  values (
    p_empresa_id
  )
  on conflict (empresa_id) do nothing;


  insert into public.fiscal_credenciais_status (
    empresa_id
  )
  values (
    p_empresa_id
  )
  on conflict (empresa_id) do nothing;

end;
$function$;

COMMIT;
