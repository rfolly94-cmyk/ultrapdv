begin;

-- ============================================================
-- UltraPDV — Numeração fiscal separada por ambiente
--
-- 1 = Produção
-- 2 = Homologação
--
-- Esta migration NÃO troca o ambiente atual da empresa.
-- Ela apenas passa a manter sequências independentes.
-- ============================================================

alter table public.fiscal_numeracoes
  add column if not exists ambiente smallint;

-- Backfill:
-- 1) prioriza o ambiente da emissão mais recente daquela série/modelo;
-- 2) se nunca houve emissão, usa o ambiente fiscal atual da empresa;
-- 3) fallback conservador: homologação (2).
update public.fiscal_numeracoes n
set ambiente =
  coalesce(
    (
      select e.ambiente
      from public.fiscal_emissoes e
      where e.empresa_id = n.empresa_id
        and e.modelo = n.modelo
        and e.serie = n.serie
      order by e.created_at desc
      limit 1
    ),
    (
      select
        case
          when lower(trim(ef.ambiente::text)) in ('1', 'producao', 'produção')
            then 1
          else 2
        end
      from public.empresas_fiscal ef
      where ef.empresa_id = n.empresa_id
      limit 1
    ),
    2
  )
where n.ambiente is null;

alter table public.fiscal_numeracoes
  alter column ambiente set not null;

alter table public.fiscal_numeracoes
  drop constraint if exists fiscal_numeracoes_ambiente_check;

alter table public.fiscal_numeracoes
  add constraint fiscal_numeracoes_ambiente_check
  check (ambiente in (1, 2));

-- ------------------------------------------------------------
-- Remove UNIQUE legado (empresa, modelo, serie), se existir.
-- Precisamos permitir a MESMA série em homologação e produção.
-- ------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.fiscal_numeracoes'::regclass
      and c.contype = 'u'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%empresa_id%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%modelo%'
      and pg_catalog.pg_get_constraintdef(c.oid) ilike '%serie%'
      and pg_catalog.pg_get_constraintdef(c.oid) not ilike '%ambiente%'
  loop
    execute format(
      'alter table public.fiscal_numeracoes drop constraint %I',
      r.conname
    );
  end loop;
end
$$;

do $$
declare
  r record;
begin
  for r in
    select
      i.relname as index_name
    from pg_catalog.pg_index x
    join pg_catalog.pg_class t
      on t.oid = x.indrelid
    join pg_catalog.pg_namespace ns
      on ns.oid = t.relnamespace
    join pg_catalog.pg_class i
      on i.oid = x.indexrelid
    where ns.nspname = 'public'
      and t.relname = 'fiscal_numeracoes'
      and x.indisunique
      and not x.indisprimary
      and pg_catalog.pg_get_indexdef(i.oid) ilike '%empresa_id%'
      and pg_catalog.pg_get_indexdef(i.oid) ilike '%modelo%'
      and pg_catalog.pg_get_indexdef(i.oid) ilike '%serie%'
      and pg_catalog.pg_get_indexdef(i.oid) not ilike '%ambiente%'
  loop
    execute format(
      'drop index if exists public.%I',
      r.index_name
    );
  end loop;
end
$$;

create unique index if not exists
  fiscal_numeracoes_empresa_modelo_ambiente_serie_uidx
on public.fiscal_numeracoes (
  empresa_id,
  modelo,
  ambiente,
  serie
);

-- Só uma série ativa por modelo + ambiente.
create unique index if not exists
  fiscal_numeracoes_ativa_modelo_ambiente_uidx
on public.fiscal_numeracoes (
  empresa_id,
  modelo,
  ambiente
)
where ativo = true;

create index if not exists
  fiscal_numeracoes_empresa_ambiente_idx
on public.fiscal_numeracoes (
  empresa_id,
  ambiente,
  modelo,
  ativo
);

-- ------------------------------------------------------------
-- Emissões: o mesmo número pode existir em ambientes diferentes.
-- O índice legado não incluía ambiente.
-- ------------------------------------------------------------
drop index if exists public.fiscal_emissoes_numero_unico;

create unique index
  fiscal_emissoes_numero_unico
on public.fiscal_emissoes (
  empresa_id,
  modelo,
  ambiente,
  serie,
  numero
);

-- ============================================================
-- RPC reserva atômica — agora busca a sequência DO AMBIENTE.
-- ============================================================
create or replace function public.rpc_reservar_emissao_fiscal(
  p_empresa_id uuid,
  p_modelo varchar,
  p_serie integer,
  p_ambiente smallint,
  p_chave_idempotencia uuid,
  p_origem_tipo text default null,
  p_origem_id uuid default null
)
returns table (
  emissao_id uuid,
  empresa_id uuid,
  modelo varchar,
  serie integer,
  numero bigint,
  ambiente smallint,
  codigo_numerico varchar,
  status text,
  chave_idempotencia uuid,
  reutilizada boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existente public.fiscal_emissoes%rowtype;
  v_numeracao public.fiscal_numeracoes%rowtype;
  v_numero bigint;
  v_codigo_numerico varchar(8);
  v_emissao public.fiscal_emissoes%rowtype;
begin
  if p_empresa_id is null then
    raise exception 'empresa_id é obrigatório';
  end if;

  if p_modelo not in ('55', '65') then
    raise exception 'modelo fiscal inválido: %', p_modelo;
  end if;

  if p_serie is null or p_serie <= 0 then
    raise exception 'série fiscal inválida';
  end if;

  if p_ambiente not in (1, 2) then
    raise exception 'ambiente fiscal inválido';
  end if;

  if p_chave_idempotencia is null then
    raise exception 'chave de idempotência é obrigatória';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_empresa_id::text),
    pg_catalog.hashtext(p_chave_idempotencia::text)
  );

  select e.*
  into v_existente
  from public.fiscal_emissoes e
  where e.empresa_id = p_empresa_id
    and e.chave_idempotencia = p_chave_idempotencia
  limit 1;

  if found then
    if v_existente.modelo <> p_modelo
       or v_existente.serie <> p_serie
       or v_existente.ambiente <> p_ambiente then
      raise exception
        'chave de idempotência já usada com parâmetros fiscais diferentes';
    end if;

    return query
    select
      v_existente.id,
      v_existente.empresa_id,
      v_existente.modelo,
      v_existente.serie,
      v_existente.numero,
      v_existente.ambiente,
      v_existente.codigo_numerico,
      v_existente.status,
      v_existente.chave_idempotencia,
      true;

    return;
  end if;

  select n.*
  into v_numeracao
  from public.fiscal_numeracoes n
  where n.empresa_id = p_empresa_id
    and n.modelo = p_modelo
    and n.serie = p_serie
    and n.ambiente = p_ambiente
    and n.ativo = true
  for update;

  if not found then
    raise exception
      'numeração fiscal ativa não encontrada para modelo % série % ambiente %',
      p_modelo,
      p_serie,
      p_ambiente;
  end if;

  v_numero := v_numeracao.proximo_numero;

  if v_numero is null or v_numero <= 0 then
    raise exception 'próximo número fiscal inválido';
  end if;

  v_codigo_numerico :=
    pg_catalog.lpad(
      (
        pg_catalog.floor(
          pg_catalog.random() * 100000000
        )::bigint
      )::text,
      8,
      '0'
    );

  update public.fiscal_numeracoes
  set
    proximo_numero = v_numero + 1,
    updated_at = pg_catalog.now()
  where id = v_numeracao.id;

  insert into public.fiscal_emissoes (
    empresa_id,
    modelo,
    serie,
    numero,
    ambiente,
    chave_idempotencia,
    origem_tipo,
    origem_id,
    codigo_numerico,
    status
  )
  values (
    p_empresa_id,
    p_modelo,
    p_serie,
    v_numero,
    p_ambiente,
    p_chave_idempotencia,
    nullif(pg_catalog.btrim(p_origem_tipo), ''),
    p_origem_id,
    v_codigo_numerico,
    'reservada'
  )
  returning *
  into v_emissao;

  return query
  select
    v_emissao.id,
    v_emissao.empresa_id,
    v_emissao.modelo,
    v_emissao.serie,
    v_emissao.numero,
    v_emissao.ambiente,
    v_emissao.codigo_numerico,
    v_emissao.status,
    v_emissao.chave_idempotencia,
    false;
end;
$function$;

revoke all
on function public.rpc_reservar_emissao_fiscal(
  uuid,
  varchar,
  integer,
  smallint,
  uuid,
  text,
  uuid
)
from public, anon, authenticated;

grant execute
on function public.rpc_reservar_emissao_fiscal(
  uuid,
  varchar,
  integer,
  smallint,
  uuid,
  text,
  uuid
)
to service_role;

commit;
