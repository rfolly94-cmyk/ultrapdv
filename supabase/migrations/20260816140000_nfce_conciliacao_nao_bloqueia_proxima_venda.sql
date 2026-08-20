begin;

-- UltraPDV — NFC-e em conciliação não bloqueia a venda seguinte
--
-- Causa 1 (trava): rpc_iniciar_tentativa_emissao_fiscal existia só no banco,
-- sem corpo no repositório. Era chamada após a reserva. Uma verificação
-- por empresa (qualquer NFC-e em enviando/aguardando_reconciliacao)
-- impedia emitir a venda seguinte. A trava correta é só desta emissão.
--
-- Causa 2 (numeração): se proximo_numero ficou atrás de um número já
-- reservado (ex.: 18 EM_CONCILIACAO), o INSERT violava
-- fiscal_emissoes_numero_unico e a próxima venda não emitia.
-- Número já usado/reservado permanece ocupado; o próximo é
-- GREATEST(contador, max(numero)+1) na mesma empresa/modelo/série/ambiente.
--
-- Idempotência por chave (venda) permanece: reemitir a MESMA venda
-- devolve a emissão existente e não cria outro número.

drop function if exists public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid);

create function public.rpc_iniciar_tentativa_emissao_fiscal(
  p_empresa_id uuid,
  p_emissao_id uuid
)
returns table(emissao_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
begin
  if p_empresa_id is null or p_emissao_id is null then
    raise exception 'empresa e emissão são obrigatórios';
  end if;

  -- Serializa somente ESTA emissão. Não consulta outras vendas.
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

  -- Já em envio / conciliação / terminal DESTA emissão: não devolver
  -- sucesso (evita segundo POST Geranet). Outra venda tem outro id.
  if v_status is distinct from 'reservada'
     and v_status is distinct from 'rejeitada' then
    return;
  end if;

  update public.fiscal_emissoes e
  set
    status = 'enviando',
    tentativas = pg_catalog.coalesce(e.tentativas, 0) + 1,
    enviada_at = pg_catalog.coalesce(e.enviada_at, pg_catalog.now())
  where e.id = p_emissao_id
    and e.empresa_id = p_empresa_id
    and e.status = v_status;

  if not found then
    return;
  end if;

  return query select p_emissao_id;
end;
$function$;

revoke all
on function public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid)
from public, anon, authenticated;

grant execute
on function public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid)
to service_role;

comment on function public.rpc_iniciar_tentativa_emissao_fiscal(uuid, uuid) is
  'Marca esta emissão como enviando. Não bloqueia outras vendas da empresa. '
  'aguardando_reconciliacao desta emissão impede retransmiti-la; a venda seguinte reserva outro número.';

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
  v_max_usado bigint;
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

  -- Mesma venda/chave: devolve a emissão existente (incl. conciliação).
  -- Não varre outras vendas da empresa.
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

  -- Serializa a sequência da série/ambiente entre vendas diferentes.
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

  select pg_catalog.coalesce(pg_catalog.max(e.numero), 0) + 1
  into v_max_usado
  from public.fiscal_emissoes e
  where e.empresa_id = p_empresa_id
    and e.modelo = p_modelo
    and e.serie = p_serie
    and e.ambiente = p_ambiente;

  v_numero := pg_catalog.greatest(
    pg_catalog.coalesce(v_numeracao.proximo_numero, 1),
    pg_catalog.coalesce(v_max_usado, 1)
  );

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

comment on function public.rpc_reservar_emissao_fiscal(
  uuid,
  varchar,
  integer,
  smallint,
  uuid,
  text,
  uuid
) is
  'Reserva NFC-e/NF-e por chave_idempotencia (venda). Emissões em conciliação de outras vendas não bloqueiam. Número = GREATEST(contador, último nº usado + 1).';

commit;
