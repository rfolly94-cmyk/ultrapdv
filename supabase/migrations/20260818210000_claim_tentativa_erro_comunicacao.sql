begin;

-- Claim de retransmissão seguro: somente
--   reservada
--   rejeitada
--   erro_comunicacao com resposta_resumo.classificacao = 'erro_envio'
-- Nunca claima erro_comunicacao sem classificação, ambíguo,
-- aguardando_reconciliacao, enviando, autorizada ou cancelada.
-- Escopo permanece p_empresa_id = fiscal_emissoes.empresa_id.

create or replace function public.rpc_iniciar_tentativa_emissao_fiscal(
  p_empresa_id uuid,
  p_emissao_id uuid,
  p_usuario_id uuid default null,
  p_payload_sanitizado jsonb default '{}'::jsonb,
  p_snapshot_itens jsonb default null
)
returns table (
  emissao_id uuid,
  tentativa integer,
  tentativa_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_classificacao text;
  v_emissao public.fiscal_emissoes%rowtype;
  v_tentativa integer;
  v_tentativa_id uuid;
  v_pode_claim boolean;
begin
  if p_empresa_id is null or p_emissao_id is null then
    raise exception 'empresa e emissão são obrigatórios';
  end if;

  if p_payload_sanitizado is null then
    raise exception 'payload sanitizado da tentativa é obrigatório';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_empresa_id::text),
    pg_catalog.hashtext(p_emissao_id::text)
  );

  select e.*
  into v_emissao
  from public.fiscal_emissoes e
  where e.id = p_emissao_id
    and e.empresa_id = p_empresa_id
  for update;

  if not found then
    return;
  end if;

  v_status := v_emissao.status;
  v_classificacao := coalesce(v_emissao.resposta_resumo->>'classificacao', '');

  v_pode_claim :=
    v_status = 'reservada'
    or v_status = 'rejeitada'
    or (
      v_status = 'erro_comunicacao'
      and v_classificacao = 'erro_envio'
    );

  if not v_pode_claim then
    return;
  end if;

  update public.fiscal_emissoes e
  set
    status = 'enviando',
    tentativas = coalesce(e.tentativas, 0) + 1,
    enviada_at = coalesce(e.enviada_at, pg_catalog.now())
  where e.id = p_emissao_id
    and e.empresa_id = p_empresa_id
    and e.status = v_status
  returning e.*
    into v_emissao;

  if not found then
    return;
  end if;

  v_tentativa := coalesce(v_emissao.tentativas, 1);
  v_tentativa_id := gen_random_uuid();

  insert into public.fiscal_emissao_tentativas (
    id,
    empresa_id,
    emissao_id,
    tentativa,
    usuario_id,
    modelo,
    ambiente,
    serie,
    numero,
    codigo_numerico,
    tipo_emissao,
    payload_sanitizado,
    snapshot_itens,
    iniciada_at
  )
  values (
    v_tentativa_id,
    p_empresa_id,
    p_emissao_id,
    v_tentativa,
    p_usuario_id,
    v_emissao.modelo,
    v_emissao.ambiente,
    v_emissao.serie,
    v_emissao.numero,
    v_emissao.codigo_numerico,
    v_emissao.tipo_emissao,
    p_payload_sanitizado,
    p_snapshot_itens,
    pg_catalog.now()
  );

  return query
  select
    p_emissao_id,
    v_tentativa,
    v_tentativa_id;
end;
$function$;

revoke all
on function public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated;

grant execute
on function public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid, uuid, jsonb, jsonb)
to service_role;

comment on function public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid, uuid, jsonb, jsonb) is
  'Claim atômico: reservada/rejeitada/(erro_comunicacao+classificacao=erro_envio) → enviando. Incrementa tentativas e grava o filho imutável. Sem MAX+1 no app. Sempre filtrado por empresa_id da emissão.';

commit;
