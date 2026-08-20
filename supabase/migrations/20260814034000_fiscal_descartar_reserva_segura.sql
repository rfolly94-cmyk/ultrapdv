begin;

-- ============================================================
-- UltraPDV — Descarte seguro de reserva fiscal não transmitida
--
-- NÃO devolve número para a sequência.
-- NÃO chama Geranet / SEFAZ.
-- NÃO permite descartar emissão que já começou a transmissão.
-- ============================================================

create or replace function public.rpc_descartar_reserva_fiscal(
  p_empresa_id uuid,
  p_emissao_id uuid,
  p_motivo text default null
)
returns table (
  emissao_id uuid,
  modelo varchar,
  serie integer,
  numero bigint,
  status text,
  inutilizacao_pendente boolean,
  reutilizada boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_emissao public.fiscal_emissoes%rowtype;
  v_motivo text;
begin
  if p_empresa_id is null then
    raise exception 'empresa_id é obrigatório';
  end if;

  if p_emissao_id is null then
    raise exception 'emissao_id é obrigatório';
  end if;

  v_motivo :=
    coalesce(
      nullif(
        pg_catalog.btrim(p_motivo),
        ''
      ),
      'Reserva fiscal descartada antes da transmissão; número aguardando inutilização.'
    );

  -- Serializa alterações sobre a mesma emissão.
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
    raise exception 'Emissão fiscal não encontrada.';
  end if;

  -- Idempotência da ação.
  if v_emissao.status = 'aguardando_inutilizacao' then
    return query
    select
      v_emissao.id,
      v_emissao.modelo,
      v_emissao.serie,
      v_emissao.numero,
      v_emissao.status,
      true,
      true;

    return;
  end if;

  if v_emissao.status <> 'reservada' then
    raise exception
      'Somente uma emissão com status reservada pode ser descartada por este fluxo. Status atual: %',
      v_emissao.status;
  end if;

  -- A RPC que inicia transmissão incrementa tentativas e grava enviada_at.
  -- Se qualquer um desses sinais existir, não tratamos mais como reserva pura.
  if coalesce(v_emissao.tentativas, 0) <> 0
     or v_emissao.enviada_at is not null
     or v_emissao.chave_acesso is not null
     or v_emissao.protocolo is not null then
    raise exception
      'A emissão possui indícios de transmissão e não pode ser descartada automaticamente.';
  end if;

  update public.fiscal_emissoes as e
  set
    status = 'aguardando_inutilizacao',
    motivo = v_motivo,
    erro_comunicacao = null
  where e.id = p_emissao_id
    and e.empresa_id = p_empresa_id
    and e.status = 'reservada'
    and coalesce(e.tentativas, 0) = 0
    and e.enviada_at is null
    and e.chave_acesso is null
    and e.protocolo is null
  returning e.*
  into v_emissao;

  if not found then
    raise exception
      'A reserva mudou de estado durante a operação. Atualize a página e confira a situação fiscal.';
  end if;

  return query
  select
    v_emissao.id,
    v_emissao.modelo,
    v_emissao.serie,
    v_emissao.numero,
    v_emissao.status,
    true,
    false;
end;
$function$;

revoke all
on function public.rpc_descartar_reserva_fiscal(
  uuid,
  uuid,
  text
)
from public;

revoke all
on function public.rpc_descartar_reserva_fiscal(
  uuid,
  uuid,
  text
)
from anon;

revoke all
on function public.rpc_descartar_reserva_fiscal(
  uuid,
  uuid,
  text
)
from authenticated;

grant execute
on function public.rpc_descartar_reserva_fiscal(
  uuid,
  uuid,
  text
)
to service_role;

comment on function public.rpc_descartar_reserva_fiscal(
  uuid,
  uuid,
  text
) is
'Descarta somente reserva fiscal nunca transmitida. Mantém o número consumido e marca aguardando_inutilizacao.';

commit;
