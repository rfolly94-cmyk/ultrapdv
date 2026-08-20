begin;

-- ============================================================
-- UltraPDV — Histórico imutável de tentativas fiscais
-- Data: 2026-08-18
--
-- fiscal_emissoes continua sendo o cabeçalho / estado vigente.
-- Cada POST real à Geranet vira um filho em fiscal_emissao_tentativas.
-- Sem backfill: emissões antigas ficam sem tentativa histórica.
-- Não inventa payload antigo.
-- ============================================================

-- ------------------------------------------------------------
-- UNIQUE (id, empresa_id) para FK composta da tentativa
-- ------------------------------------------------------------
do $$
declare
  v_tipo text;
  v_cols text[];
begin
  select
    c.contype::text,
    (
      select array_agg(a.attname order by k.ord)
      from unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute as a
        on a.attrelid = c.conrelid
       and a.attnum = k.attnum
    )
  into v_tipo, v_cols
  from pg_constraint as c
  where c.conrelid = 'public.fiscal_emissoes'::regclass
    and c.conname = 'fiscal_emissoes_id_empresa_unique';

  if found then
    if v_tipo is distinct from 'u'
       or v_cols is distinct from array['id', 'empresa_id']::text[] then
      raise exception
        'fiscal_emissoes_id_empresa_unique existe com definição divergente (tipo=%, colunas=%). Esperado UNIQUE (id, empresa_id).',
        v_tipo,
        v_cols;
    end if;
  else
    alter table public.fiscal_emissoes
      add constraint fiscal_emissoes_id_empresa_unique
      unique (id, empresa_id);
  end if;
end
$$;

create table if not exists public.fiscal_emissao_tentativas (
  id uuid primary key default gen_random_uuid(),

  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,

  emissao_id uuid not null,

  tentativa integer not null,

  usuario_id uuid null,

  modelo varchar not null,
  ambiente smallint not null,
  serie integer not null,
  numero bigint not null,
  codigo_numerico varchar null,
  tipo_emissao text null,

  payload_sanitizado jsonb not null,
  snapshot_itens jsonb null,

  http_status integer null,
  cstat text null,
  motivo text null,
  geranet_log_id bigint null,

  resposta_sanitizada jsonb null,

  xml_hex text null,
  pdf_hex text null,

  iniciada_at timestamptz not null default now(),
  respondida_at timestamptz null,
  classificacao_inicial text null,
  finalizada_at timestamptz null,

  constraint fiscal_emissao_tentativas_emissao_empresa_fkey
    foreign key (emissao_id, empresa_id)
    references public.fiscal_emissoes (id, empresa_id)
    on delete cascade,

  constraint fiscal_emissao_tentativas_unica
    unique (empresa_id, emissao_id, tentativa),

  constraint fiscal_emissao_tentativas_tentativa_check
    check (tentativa >= 1)
);

comment on table public.fiscal_emissao_tentativas is
  'Histórico imutável de cada POST real à Geranet. Não backfill de emissões anteriores.';

comment on column public.fiscal_emissao_tentativas.payload_sanitizado is
  'Payload efetivamente enviado, sem certificado, senha, API key, CSC ou equivalentes.';

comment on column public.fiscal_emissao_tentativas.snapshot_itens is
  'Itens fiscais resolvidos usados naquele POST. Autossuficiente para auditoria.';

comment on column public.fiscal_emissao_tentativas.classificacao_inicial is
  'Resultado inicial desta transmissão. Reconciliação não reescreve este campo.';

create index if not exists fiscal_emissao_tentativas_empresa_emissao_idx
  on public.fiscal_emissao_tentativas (
    empresa_id,
    emissao_id,
    tentativa
  );

-- ------------------------------------------------------------
-- Imutabilidade após finalizada_at
-- ------------------------------------------------------------
create or replace function public.fiscal_emissao_tentativas_proteger_imutabilidade()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Tentativa fiscal é imutável e não pode ser excluída.';
  end if;

  if old.finalizada_at is not null then
    raise exception
      'Tentativa fiscal já finalizada não pode ser alterada.';
  end if;

  if new.empresa_id is distinct from old.empresa_id
     or new.emissao_id is distinct from old.emissao_id
     or new.tentativa is distinct from old.tentativa
     or new.usuario_id is distinct from old.usuario_id
     or new.modelo is distinct from old.modelo
     or new.ambiente is distinct from old.ambiente
     or new.serie is distinct from old.serie
     or new.numero is distinct from old.numero
     or new.codigo_numerico is distinct from old.codigo_numerico
     or new.tipo_emissao is distinct from old.tipo_emissao
     or new.payload_sanitizado is distinct from old.payload_sanitizado
     or new.snapshot_itens is distinct from old.snapshot_itens
     or new.iniciada_at is distinct from old.iniciada_at
  then
    raise exception
      'Campos históricos da tentativa fiscal não podem ser alterados.';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_fiscal_emissao_tentativas_imutavel
  on public.fiscal_emissao_tentativas;

create trigger trg_fiscal_emissao_tentativas_imutavel
before update or delete on public.fiscal_emissao_tentativas
for each row
execute function public.fiscal_emissao_tentativas_proteger_imutabilidade();

-- ------------------------------------------------------------
-- RLS / GRANTS
-- ------------------------------------------------------------
alter table public.fiscal_emissao_tentativas
  enable row level security;

drop policy if exists usuario_visualiza_fiscal_emissao_tentativas
  on public.fiscal_emissao_tentativas;

create policy usuario_visualiza_fiscal_emissao_tentativas
  on public.fiscal_emissao_tentativas
  for select
  to authenticated
  using (
    public.tem_acesso_empresa(empresa_id)
  );

revoke all
  on table public.fiscal_emissao_tentativas
  from public, anon, authenticated;

grant select
  on table public.fiscal_emissao_tentativas
  to authenticated;

grant all
  on table public.fiscal_emissao_tentativas
  to service_role;

-- ------------------------------------------------------------
-- RPC: claim atômico + insert da tentativa
-- ------------------------------------------------------------
drop function if exists public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid);
drop function if exists public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid, uuid, jsonb, jsonb);

create function public.rpc_iniciar_tentativa_emissao_fiscal(
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
  v_emissao public.fiscal_emissoes%rowtype;
  v_tentativa integer;
  v_tentativa_id uuid;
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

  select e.status
  into v_status
  from public.fiscal_emissoes e
  where e.id = p_emissao_id
    and e.empresa_id = p_empresa_id
  for update;

  if not found then
    return;
  end if;

  if v_status is distinct from 'reservada'
     and v_status is distinct from 'rejeitada' then
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
  'Claim atômico: reservada/rejeitada → enviando, incrementa tentativas e grava o filho imutável da transmissão. Sem MAX+1 no app.';

-- ------------------------------------------------------------
-- RPC: arquivar POST de transmissão de contingência já claimada
-- Não altera o claim rpc_iniciar_transmissao_contingencia.
-- ------------------------------------------------------------
create or replace function public.rpc_anexar_tentativa_transmissao_fiscal(
  p_empresa_id uuid,
  p_emissao_id uuid,
  p_usuario_id uuid default null,
  p_payload_sanitizado jsonb default '{}'::jsonb,
  p_snapshot_itens jsonb default null
)
returns table (
  tentativa integer,
  tentativa_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_emissao public.fiscal_emissoes%rowtype;
  v_tentativa integer;
  v_tentativa_id uuid;
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

  if v_emissao.status is distinct from 'transmitindo_contingencia' then
    return;
  end if;

  update public.fiscal_emissoes e
  set tentativas = coalesce(e.tentativas, 0) + 1
  where e.id = p_emissao_id
    and e.empresa_id = p_empresa_id
    and e.status = 'transmitindo_contingencia'
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
    v_tentativa,
    v_tentativa_id;
end;
$function$;

revoke all
on function public.rpc_anexar_tentativa_transmissao_fiscal(uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated;

grant execute
on function public.rpc_anexar_tentativa_transmissao_fiscal(uuid, uuid, uuid, jsonb, jsonb)
to service_role;

comment on function public.rpc_anexar_tentativa_transmissao_fiscal(uuid, uuid, uuid, jsonb, jsonb) is
  'Arquiva o POST de transmissão de NFC-e em contingência já claimada. Não muda XML, número nem tpEmis.';

notify pgrst, 'reload schema';

commit;
