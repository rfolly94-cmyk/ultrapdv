begin;

-- ============================================================
-- UltraPDV — Contingência fiscal NFC-e 65 / Geranet
-- ============================================================

alter table public.fiscal_emissoes
  add column if not exists tipo_emissao text not null default 'normal',
  add column if not exists contingencia_justificativa text null,
  add column if not exists contingencia_gerada_at timestamptz null,
  add column if not exists contingencia_transmitida_at timestamptz null,
  add column if not exists contingencia_tentativas integer not null default 0,
  add column if not exists contingencia_erro text null,
  add column if not exists xml_contingencia_hex text null,
  add column if not exists pdf_contingencia_hex text null;

alter table public.fiscal_emissoes
  drop constraint if exists fiscal_emissoes_tipo_emissao_check;

alter table public.fiscal_emissoes
  add constraint fiscal_emissoes_tipo_emissao_check
  check (
    tipo_emissao in (
      'normal',
      'contingencia_offline'
    )
  );

alter table public.fiscal_emissoes
  drop constraint if exists fiscal_emissoes_status_check;

alter table public.fiscal_emissoes
  add constraint fiscal_emissoes_status_check
  check (
    status in (
      'reservada',
      'enviando',
      'autorizada',
      'rejeitada',
      'erro_comunicacao',
      'aguardando_reconciliacao',
      'aguardando_inutilizacao',
      'inutilizada',
      'cancelada',
      'aguardando_transmissao_contingencia',
      'transmitindo_contingencia'
    )
  );

create index if not exists ix_fiscal_emissoes_contingencia_fila
  on public.fiscal_emissoes (
    empresa_id,
    status,
    modelo,
    contingencia_gerada_at
  )
  where tipo_emissao = 'contingencia_offline';

create table if not exists public.fiscal_contingencia_config (
  empresa_id uuid primary key
    references public.empresas(id)
    on delete cascade,
  nfce_offline_habilitada boolean not null default false,
  justificativa_padrao text not null
    default 'Indisponibilidade temporária de comunicação com a SEFAZ.',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint fiscal_contingencia_justificativa_check
    check (
      char_length(btrim(justificativa_padrao)) between 15 and 256
    )
);

alter table public.fiscal_contingencia_config
  enable row level security;

drop policy if exists fiscal_contingencia_config_select_empresa
  on public.fiscal_contingencia_config;

create policy fiscal_contingencia_config_select_empresa
on public.fiscal_contingencia_config
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = fiscal_contingencia_config.empresa_id
      and ue.ativo = true
  )
);

revoke insert, update, delete
  on public.fiscal_contingencia_config
  from authenticated, anon;

create table if not exists public.fiscal_contingencia_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  emissao_id uuid not null
    references public.fiscal_emissoes(id)
    on delete cascade,
  tipo text not null,
  detalhes jsonb null,
  created_at timestamptz not null default now(),
  constraint fiscal_contingencia_eventos_tipo_check
    check (
      tipo in (
        'gerada',
        'transmissao_iniciada',
        'autorizada',
        'rejeitada',
        'comunicacao_ambigua'
      )
    )
);

create index if not exists ix_fiscal_contingencia_eventos_emissao
  on public.fiscal_contingencia_eventos (
    empresa_id,
    emissao_id,
    created_at desc
  );

alter table public.fiscal_contingencia_eventos
  enable row level security;

drop policy if exists fiscal_contingencia_eventos_select_empresa
  on public.fiscal_contingencia_eventos;

create policy fiscal_contingencia_eventos_select_empresa
on public.fiscal_contingencia_eventos
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = fiscal_contingencia_eventos.empresa_id
      and ue.ativo = true
  )
);

revoke insert, update, delete
  on public.fiscal_contingencia_eventos
  from authenticated, anon;

-- Claim atômico para transmitir o MESMO XML de contingência.
create or replace function public.rpc_iniciar_transmissao_contingencia(
  p_empresa_id uuid,
  p_emissao_id uuid
)
returns table (
  emissao_id uuid,
  status text,
  tentativa integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_emissao public.fiscal_emissoes%rowtype;
begin
  if p_empresa_id is null then
    raise exception 'empresa_id é obrigatório';
  end if;

  if p_emissao_id is null then
    raise exception 'emissao_id é obrigatório';
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
    raise exception 'Emissão fiscal não encontrada.';
  end if;

  if v_emissao.modelo <> '65' then
    raise exception 'Somente NFC-e modelo 65 usa contingência offline neste fluxo.';
  end if;

  if v_emissao.tipo_emissao <> 'contingencia_offline' then
    raise exception 'A emissão não é de contingência offline.';
  end if;

  if v_emissao.status <> 'aguardando_transmissao_contingencia' then
    return;
  end if;

  if nullif(pg_catalog.btrim(v_emissao.xml_contingencia_hex), '') is null then
    raise exception 'XML de contingência não está armazenado.';
  end if;

  update public.fiscal_emissoes e
     set status = 'transmitindo_contingencia',
         contingencia_tentativas = coalesce(e.contingencia_tentativas, 0) + 1,
         contingencia_erro = null,
         updated_at = pg_catalog.now()
   where e.id = p_emissao_id
     and e.empresa_id = p_empresa_id
     and e.status = 'aguardando_transmissao_contingencia'
  returning e.*
       into v_emissao;

  if not found then
    return;
  end if;

  insert into public.fiscal_contingencia_eventos (
    empresa_id,
    emissao_id,
    tipo,
    detalhes
  )
  values (
    p_empresa_id,
    p_emissao_id,
    'transmissao_iniciada',
    pg_catalog.jsonb_build_object(
      'tentativa',
      v_emissao.contingencia_tentativas
    )
  );

  return query
  select
    v_emissao.id,
    v_emissao.status,
    v_emissao.contingencia_tentativas;
end;
$function$;

revoke all
on function public.rpc_iniciar_transmissao_contingencia(uuid, uuid)
from public, anon, authenticated;

grant execute
on function public.rpc_iniciar_transmissao_contingencia(uuid, uuid)
to service_role;

comment on function public.rpc_iniciar_transmissao_contingencia(uuid, uuid)
is 'Claim atômico para transmissão do XML já gerado de NFC-e em contingência. Nunca gera novo número/XML.';

commit;
