begin;

-- Número manual em rascunho: p_numero opcional.
-- Sem p_numero, a reserva automática (GREATEST) permanece igual.
-- Com p_numero, exige unicidade (empresa, modelo, ambiente, série, número)
-- e avança o contador para não reutilizar o número informado.

drop function if exists public.rpc_reservar_emissao_fiscal(
  uuid,
  varchar,
  integer,
  smallint,
  uuid,
  text,
  uuid
);

create or replace function public.rpc_reservar_emissao_fiscal(
  p_empresa_id uuid,
  p_modelo varchar,
  p_serie integer,
  p_ambiente smallint,
  p_chave_idempotencia uuid,
  p_origem_tipo text default null,
  p_origem_id uuid default null,
  p_numero bigint default null
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
  v_max_usado bigint;
  v_codigo_numerico varchar(8);
  v_emissao public.fiscal_emissoes%rowtype;
  v_ocupado public.fiscal_emissoes%rowtype;
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

  if p_numero is not null and p_numero <= 0 then
    raise exception 'número fiscal inválido';
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
    and e.status <> 'inutilizada'
  order by e.created_at desc
  limit 1
  for update;

  if found then
    if v_existente.status = 'aguardando_inutilizacao' then
      raise exception
        'Existe numeração aguardando inutilização (série %, número %). Conclua a inutilização na SEFAZ antes de emitir novamente.',
        v_existente.serie,
        v_existente.numero;
    end if;

    if v_existente.modelo <> p_modelo
       or v_existente.serie <> p_serie
       or v_existente.ambiente <> p_ambiente
       or (p_numero is not null and v_existente.numero <> p_numero) then
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_empresa_id::text || ':' || p_modelo),
    pg_catalog.hashtext(p_serie::text || ':' || p_ambiente::text)
  );

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

  if p_numero is not null then
    select e.*
    into v_ocupado
    from public.fiscal_emissoes e
    where e.empresa_id = p_empresa_id
      and e.modelo = p_modelo
      and e.serie = p_serie
      and e.ambiente = p_ambiente
      and e.numero = p_numero
    limit 1
    for update;

    if found then
      raise exception
        'Já existe documento fiscal com esta empresa, ambiente, modelo, série e número.';
    end if;

    v_numero := p_numero;
  else
    select COALESCE(pg_catalog.max(e.numero), 0::bigint) + 1::bigint
    into v_max_usado
    from public.fiscal_emissoes e
    where e.empresa_id = p_empresa_id
      and e.modelo = p_modelo
      and e.serie = p_serie
      and e.ambiente = p_ambiente;

    v_numero := GREATEST(
      COALESCE(v_numeracao.proximo_numero::bigint, 1::bigint),
      COALESCE(v_max_usado, 1::bigint)
    );
  end if;

  if v_numero is null or v_numero <= 0::bigint then
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
    proximo_numero = GREATEST(
      COALESCE(v_numeracao.proximo_numero::bigint, 1::bigint),
      v_numero + 1::bigint
    ),
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
  uuid,
  bigint
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
  uuid,
  bigint
)
to service_role;

commit;
