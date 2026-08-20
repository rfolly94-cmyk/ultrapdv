begin;

-- Fundação de operações fiscais genéricas (Bonificação / Transferência).
-- origem_tipo da emissão = operacao_fiscal. Sem venda, sem financeiro.
-- Estoque só nas RPCs de saída/recebimento. Sem CFOP/CST seed.

insert into public.fiscal_tipos_operacao (
  codigo,
  rotulo,
  requer_documento_origem,
  disponivel,
  movimenta_estoque,
  vincula_venda
)
values (
  'bonificacao',
  'Bonificação',
  false,
  true,
  true,
  false
)
on conflict (codigo) do update
set
  rotulo = excluded.rotulo,
  requer_documento_origem = excluded.requer_documento_origem,
  disponivel = true,
  movimenta_estoque = true,
  vincula_venda = false;

update public.fiscal_tipos_operacao
set disponivel = true,
    movimenta_estoque = true,
    vincula_venda = false
where codigo in ('bonificacao', 'transferencia');

-- Vínculo cadastral explícito: só estabelecimentos Ultra que o usuário
-- declarar. Não usa heurística de nome/CNPJ raiz.
create table if not exists public.fiscal_vinculos_transferencia (
  id uuid primary key default gen_random_uuid(),
  empresa_origem_id uuid not null
    references public.empresas(id)
    on delete cascade,
  empresa_destino_id uuid not null
    references public.empresas(id)
    on delete cascade,
  ativo boolean not null default true,
  created_by uuid null
    references public.usuarios(id)
    on delete set null,
  created_at timestamptz not null default now(),
  constraint fiscal_vinculo_transf_distintos
    check (empresa_origem_id <> empresa_destino_id),
  constraint uq_fiscal_vinculo_transf
    unique (empresa_origem_id, empresa_destino_id)
);

comment on table public.fiscal_vinculos_transferencia is
  'Declaração explícita de que o destino é elegível para transferência a partir da empresa origem. Não infere titularidade por nome ou raiz de CNPJ.';

create index if not exists ix_fiscal_vinculo_transf_origem
  on public.fiscal_vinculos_transferencia (empresa_origem_id, ativo);

create table if not exists public.fiscal_operacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  tipo_operacao_interno text not null
    references public.fiscal_tipos_operacao(codigo),
  natureza_id uuid null
    references public.fiscal_naturezas_operacao(id)
    on delete restrict,
  destinatario_tipo text not null,
  destinatario_id uuid null,
  destino_empresa_id uuid null
    references public.empresas(id)
    on delete restrict,
  destino_gerenciado_no_ultra boolean not null default false,
  vinculo_transferencia_id uuid null
    references public.fiscal_vinculos_transferencia(id)
    on delete restrict,
  status text not null default 'rascunho',
  observacao text null,
  natureza_descricao text null,
  tp_nf text null,
  fin_nfe text null,
  tipo_destino text null,
  uf_empresa text null,
  uf_destinatario text null,
  dados_transporte jsonb not null default '{}'::jsonb,
  informacao_complementar_usuario text null,
  informacao_adicional_fisco text null,
  snapshot_fiscal jsonb not null default '{}'::jsonb,
  emissao_fiscal_id uuid null
    references public.fiscal_emissoes(id)
    on delete restrict,
  saida_estoque_processada_at timestamptz null,
  saida_estoque_processada_por uuid null
    references public.usuarios(id)
    on delete set null,
  recebimento_processado_at timestamptz null,
  recebimento_processado_por uuid null
    references public.usuarios(id)
    on delete set null,
  created_by uuid null
    references public.usuarios(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_operacoes_tipo_check
    check (tipo_operacao_interno in ('bonificacao', 'transferencia')),
  constraint fiscal_operacoes_dest_tipo_check
    check (destinatario_tipo in ('cliente', 'estabelecimento')),
  constraint fiscal_operacoes_status_check
    check (status in (
      'rascunho',
      'pronta_para_verificacao',
      'pronta_para_emissao',
      'enviando',
      'aguardando_reconciliacao',
      'autorizada',
      'aguardando_saida',
      'em_transito',
      'recebida',
      'concluida',
      'rejeitada',
      'cancelada'
    )),
  constraint fiscal_operacoes_tp_nf_check
    check (tp_nf is null or tp_nf in ('0', '1')),
  constraint fiscal_operacoes_fin_nfe_check
    check (fin_nfe is null or fin_nfe in ('1', '2', '3', '4')),
  constraint fiscal_operacoes_destino_check
    check (tipo_destino is null or tipo_destino in ('interna', 'interestadual'))
);

comment on table public.fiscal_operacoes is
  'Operação fiscal genérica da NF-e 55 (bonificação/transferência). Sem venda e sem financeiro. Emissão em fiscal_emissoes com origem_tipo=operacao_fiscal.';

create index if not exists ix_fiscal_operacoes_empresa
  on public.fiscal_operacoes (empresa_id, tipo_operacao_interno, created_at desc);

create index if not exists ix_fiscal_operacoes_emissao
  on public.fiscal_operacoes (emissao_fiscal_id)
  where emissao_fiscal_id is not null;

drop trigger if exists trg_fiscal_operacoes_updated_at on public.fiscal_operacoes;
create trigger trg_fiscal_operacoes_updated_at
before update on public.fiscal_operacoes
for each row
execute function public.ultrapdv_set_updated_at();

create table if not exists public.fiscal_operacoes_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  operacao_id uuid not null
    references public.fiscal_operacoes(id)
    on delete cascade,
  produto_id uuid not null
    references public.produtos(id)
    on delete restrict,
  quantidade numeric(14,4) not null,
  valor_unitario numeric(14,4) not null,
  valor_total numeric(14,2) not null,
  grupo_fiscal_id uuid null
    references public.grupos_fiscais(id)
    on delete restrict,
  cfop_resolvido text null,
  snapshot_fiscal jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_operacoes_itens_qtd_check
    check (quantidade > 0),
  constraint fiscal_operacoes_itens_valor_check
    check (valor_unitario >= 0 and valor_total >= 0)
);

create index if not exists ix_fiscal_operacoes_itens_op
  on public.fiscal_operacoes_itens (empresa_id, operacao_id);

drop trigger if exists trg_fiscal_operacoes_itens_updated_at
  on public.fiscal_operacoes_itens;
create trigger trg_fiscal_operacoes_itens_updated_at
before update on public.fiscal_operacoes_itens
for each row
execute function public.ultrapdv_set_updated_at();

alter table public.estoque_movimentacoes
  add column if not exists fiscal_operacao_id uuid;

alter table public.estoque_movimentacoes
  add column if not exists fiscal_operacao_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'estoque_movimentacoes_fiscal_operacao_fkey'
  ) then
    alter table public.estoque_movimentacoes
      add constraint estoque_movimentacoes_fiscal_operacao_fkey
      foreign key (fiscal_operacao_id)
      references public.fiscal_operacoes(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'estoque_movimentacoes_fiscal_operacao_item_fkey'
  ) then
    alter table public.estoque_movimentacoes
      add constraint estoque_movimentacoes_fiscal_operacao_item_fkey
      foreign key (fiscal_operacao_item_id)
      references public.fiscal_operacoes_itens(id)
      on delete restrict;
  end if;
end
$$;

alter table public.estoque_movimentacoes
  drop constraint if exists estoque_movimentacoes_tipo_check;

alter table public.estoque_movimentacoes
  add constraint estoque_movimentacoes_tipo_check
  check (
    tipo in (
      'ENTRADA',
      'SAIDA',
      'AJUSTE_POSITIVO',
      'AJUSTE_NEGATIVO',
      'VENDA',
      'ESTORNO_EDICAO',
      'CANCELAMENTO_VENDA',
      'DEVOLUCAO_FORNECEDOR',
      'BONIFICACAO_SAIDA',
      'TRANSFERENCIA_SAIDA',
      'TRANSFERENCIA_ENTRADA'
    )
  );

create unique index if not exists uq_estoque_mov_operacao_item_saida
  on public.estoque_movimentacoes (empresa_id, fiscal_operacao_item_id)
  where fiscal_operacao_item_id is not null
    and tipo in ('BONIFICACAO_SAIDA', 'TRANSFERENCIA_SAIDA');

create unique index if not exists uq_estoque_mov_operacao_item_entrada
  on public.estoque_movimentacoes (empresa_id, fiscal_operacao_item_id)
  where fiscal_operacao_item_id is not null
    and tipo = 'TRANSFERENCIA_ENTRADA';

create or replace function public.fiscal_operacoes_assert_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
  v_tipo text;
  v_ativo boolean;
  v_cliente_empresa uuid;
  v_vinculo public.fiscal_vinculos_transferencia%rowtype;
begin
  if tg_table_name = 'fiscal_operacoes' then
    if new.tipo_operacao_interno not in ('bonificacao', 'transferencia') then
      raise exception 'Esta tabela aceita apenas bonificação ou transferência.';
    end if;

    if new.tipo_operacao_interno = 'bonificacao' then
      if new.destinatario_tipo is distinct from 'cliente' then
        raise exception 'Bonificação exige destinatário do tipo cliente.';
      end if;
      if new.destinatario_id is not null then
        select c.empresa_id into v_empresa
        from public.clientes c
        where c.id = new.destinatario_id;
        if v_empresa is distinct from new.empresa_id then
          raise exception 'O destinatário da bonificação não pertence à empresa ativa.';
        end if;
      end if;
    end if;

    if new.tipo_operacao_interno = 'transferencia' then
      if new.destinatario_tipo is distinct from 'estabelecimento' then
        raise exception 'Transferência não aceita cliente comum como destino.';
      end if;
      if new.vinculo_transferencia_id is not null then
        select * into v_vinculo
        from public.fiscal_vinculos_transferencia v
        where v.id = new.vinculo_transferencia_id;
        if not found or v_vinculo.ativo is not true then
          raise exception 'Não foi possível confirmar que o estabelecimento de destino é elegível para transferência.';
        end if;
        if v_vinculo.empresa_origem_id is distinct from new.empresa_id then
          raise exception 'O vínculo de transferência não pertence à empresa de origem.';
        end if;
        if new.destino_empresa_id is distinct from v_vinculo.empresa_destino_id then
          raise exception 'O destino da transferência deve ser o estabelecimento do vínculo.';
        end if;
      end if;
    end if;

    if new.natureza_id is not null then
      select n.empresa_id, n.tipo_operacao_interno, n.ativo
        into v_empresa, v_tipo, v_ativo
      from public.fiscal_naturezas_operacao n
      where n.id = new.natureza_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'A natureza de operação não pertence à empresa da operação fiscal.';
      end if;
      if v_tipo is distinct from new.tipo_operacao_interno then
        raise exception 'A natureza selecionada não pertence a esta operação.';
      end if;
      if v_ativo is not true then
        raise exception 'A natureza de operação precisa estar ativa.';
      end if;
    end if;
  end if;

  if tg_table_name = 'fiscal_operacoes_itens' then
    select o.empresa_id into v_empresa
    from public.fiscal_operacoes o
    where o.id = new.operacao_id;
    if v_empresa is distinct from new.empresa_id then
      raise exception 'O item deve pertencer à mesma empresa da operação fiscal.';
    end if;

    select p.empresa_id into v_empresa
    from public.produtos p
    where p.id = new.produto_id;
    if v_empresa is distinct from new.empresa_id then
      raise exception 'O produto não pertence à empresa da operação fiscal.';
    end if;

    if new.grupo_fiscal_id is not null then
      select g.empresa_id into v_empresa
      from public.grupos_fiscais g
      where g.id = new.grupo_fiscal_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'O grupo fiscal do item não pertence à empresa da operação.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_operacoes_mesma_empresa
  on public.fiscal_operacoes;
create trigger trg_fiscal_operacoes_mesma_empresa
before insert or update of empresa_id, tipo_operacao_interno, natureza_id,
  destinatario_tipo, destinatario_id, destino_empresa_id, vinculo_transferencia_id
on public.fiscal_operacoes
for each row
execute function public.fiscal_operacoes_assert_mesma_empresa();

drop trigger if exists trg_fiscal_operacoes_itens_mesma_empresa
  on public.fiscal_operacoes_itens;
create trigger trg_fiscal_operacoes_itens_mesma_empresa
before insert or update of empresa_id, operacao_id, produto_id, grupo_fiscal_id
on public.fiscal_operacoes_itens
for each row
execute function public.fiscal_operacoes_assert_mesma_empresa();

create or replace function public.rpc_vincular_estabelecimento_transferencia(
  p_empresa_origem_id uuid,
  p_empresa_destino_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.';
  end if;
  if not public.tem_acesso_empresa(p_empresa_origem_id)
     or not public.tem_acesso_empresa(p_empresa_destino_id) then
    raise exception 'Não foi possível confirmar que o estabelecimento de destino é elegível para transferência.';
  end if;
  if p_empresa_origem_id = p_empresa_destino_id then
    raise exception 'Origem e destino da transferência devem ser estabelecimentos distintos.';
  end if;

  insert into public.fiscal_vinculos_transferencia (
    empresa_origem_id,
    empresa_destino_id,
    created_by
  )
  values (
    p_empresa_origem_id,
    p_empresa_destino_id,
    auth.uid()
  )
  on conflict (empresa_origem_id, empresa_destino_id)
  do update set ativo = true
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.rpc_confirmar_saida_operacao_fiscal(
  p_empresa_id uuid,
  p_operacao_id uuid
)
returns table (
  operacao_id uuid,
  status text,
  itens_movimentados integer,
  quantidade_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_usuario uuid;
  v_op public.fiscal_operacoes%rowtype;
  v_emissao_status text;
  v_item record;
  v_anterior numeric(14,4);
  v_atual numeric(14,4);
  v_movimentados integer := 0;
  v_quantidade numeric(14,4) := 0;
  v_tipo_mov text;
  v_status_final text;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.';
  end if;
  if not public.tem_acesso_empresa(p_empresa_id) then
    raise exception 'Usuário sem acesso à empresa.';
  end if;

  select o.*
    into v_op
  from public.fiscal_operacoes o
  where o.id = p_operacao_id
    and o.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Operação fiscal não encontrada nesta empresa.';
  end if;

  if v_op.saida_estoque_processada_at is not null
     or v_op.status in ('em_transito', 'recebida', 'concluida') then
    return query
    select
      p_operacao_id,
      v_op.status,
      0::integer,
      0::numeric;
    return;
  end if;

  if v_op.status = 'cancelada' then
    raise exception 'Operação fiscal cancelada.';
  end if;

  if v_op.emissao_fiscal_id is null then
    raise exception 'A NF-e ainda não foi emitida.';
  end if;

  select e.status into v_emissao_status
  from public.fiscal_emissoes e
  where e.id = v_op.emissao_fiscal_id
    and e.empresa_id = p_empresa_id;

  if v_emissao_status is distinct from 'autorizada' then
    raise exception 'A saída só pode ser confirmada depois que a NF-e estiver autorizada.';
  end if;

  if v_op.tipo_operacao_interno = 'bonificacao' then
    v_tipo_mov := 'BONIFICACAO_SAIDA';
    v_status_final := 'concluida';
  elsif v_op.tipo_operacao_interno = 'transferencia' then
    v_tipo_mov := 'TRANSFERENCIA_SAIDA';
    if v_op.destino_gerenciado_no_ultra then
      v_status_final := 'em_transito';
    else
      v_status_final := 'concluida';
    end if;
  else
    raise exception 'Tipo de operação sem saída de estoque nesta etapa.';
  end if;

  for v_item in
    select i.*
    from public.fiscal_operacoes_itens i
    where i.empresa_id = p_empresa_id
      and i.operacao_id = p_operacao_id
    order by i.created_at
    for update
  loop
    if exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.fiscal_operacao_item_id = v_item.id
        and em.tipo in ('BONIFICACAO_SAIDA', 'TRANSFERENCIA_SAIDA')
    ) then
      continue;
    end if;

    if not exists (
      select 1 from public.produtos p
      where p.id = v_item.produto_id
        and p.empresa_id = p_empresa_id
    ) then
      raise exception 'Produto da operação não pertence à empresa ativa.';
    end if;

    insert into public.estoque_atual (empresa_id, produto_id, quantidade, estoque_minimo)
    values (p_empresa_id, v_item.produto_id, 0, 0)
    on conflict (empresa_id, produto_id) do nothing;

    select ea.quantidade
      into v_anterior
    from public.estoque_atual ea
    where ea.empresa_id = p_empresa_id
      and ea.produto_id = v_item.produto_id
    for update;

    if v_anterior is null then
      raise exception 'Estoque do produto não encontrado.';
    end if;

    if v_anterior < v_item.quantidade then
      raise exception 'Estoque insuficiente para confirmar a saída.';
    end if;

    v_atual := v_anterior - v_item.quantidade;

    update public.estoque_atual
    set quantidade = v_atual
    where empresa_id = p_empresa_id
      and produto_id = v_item.produto_id;

    insert into public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao,
      fiscal_operacao_id,
      fiscal_operacao_item_id
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      v_usuario,
      v_tipo_mov,
      'NFE_OPERACAO_FISCAL',
      v_item.quantidade,
      v_anterior,
      v_atual,
      case
        when v_tipo_mov = 'BONIFICACAO_SAIDA' then 'Saída por bonificação'
        else 'Saída por transferência'
      end,
      p_operacao_id,
      v_item.id
    );

    v_movimentados := v_movimentados + 1;
    v_quantidade := v_quantidade + v_item.quantidade;
  end loop;

  if v_movimentados = 0
     and not exists (
       select 1 from public.estoque_movimentacoes em
       where em.empresa_id = p_empresa_id
         and em.fiscal_operacao_id = p_operacao_id
         and em.tipo in ('BONIFICACAO_SAIDA', 'TRANSFERENCIA_SAIDA')
     ) then
    raise exception 'A operação não possui itens para saída de estoque.';
  end if;

  update public.fiscal_operacoes as o
  set
    status = v_status_final,
    saida_estoque_processada_at = coalesce(o.saida_estoque_processada_at, now()),
    saida_estoque_processada_por = coalesce(o.saida_estoque_processada_por, v_usuario)
  where o.id = p_operacao_id
    and o.empresa_id = p_empresa_id;

  return query
  select
    p_operacao_id,
    v_status_final,
    v_movimentados,
    v_quantidade;
end;
$$;

create or replace function public.rpc_confirmar_recebimento_transferencia(
  p_empresa_id uuid,
  p_operacao_id uuid
)
returns table (
  operacao_id uuid,
  status text,
  itens_movimentados integer,
  quantidade_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_usuario uuid;
  v_op public.fiscal_operacoes%rowtype;
  v_item record;
  v_codigo text;
  v_produto_dest uuid;
  v_anterior numeric(14,4);
  v_atual numeric(14,4);
  v_movimentados integer := 0;
  v_quantidade numeric(14,4) := 0;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.';
  end if;
  if not public.tem_acesso_empresa(p_empresa_id) then
    raise exception 'Usuário sem acesso à empresa.';
  end if;

  select o.*
    into v_op
  from public.fiscal_operacoes o
  where o.id = p_operacao_id
    and o.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Transferência não encontrada nesta empresa.';
  end if;

  if v_op.tipo_operacao_interno is distinct from 'transferencia' then
    raise exception 'Somente transferência possui recebimento de estoque.';
  end if;

  if v_op.recebimento_processado_at is not null
     or v_op.status in ('recebida', 'concluida') then
    return query
    select p_operacao_id, v_op.status, 0::integer, 0::numeric;
    return;
  end if;

  if v_op.saida_estoque_processada_at is null
     or v_op.status is distinct from 'em_transito' then
    raise exception 'Confirme a saída da origem antes do recebimento.';
  end if;

  if v_op.destino_gerenciado_no_ultra is not true
     or v_op.destino_empresa_id is null then
    raise exception 'Este destino não possui estoque gerenciado neste UltraPDV.';
  end if;

  if not public.tem_acesso_empresa(v_op.destino_empresa_id) then
    raise exception 'Usuário sem acesso ao estabelecimento de destino.';
  end if;

  for v_item in
    select i.*
    from public.fiscal_operacoes_itens i
    where i.empresa_id = p_empresa_id
      and i.operacao_id = p_operacao_id
    order by i.created_at
    for update
  loop
    if exists (
      select 1 from public.estoque_movimentacoes em
      where em.fiscal_operacao_item_id = v_item.id
        and em.tipo = 'TRANSFERENCIA_ENTRADA'
        and em.empresa_id = v_op.destino_empresa_id
    ) then
      continue;
    end if;

    select p.codigo into v_codigo
    from public.produtos p
    where p.id = v_item.produto_id
      and p.empresa_id = p_empresa_id;

    select p.id
      into v_produto_dest
    from public.produtos p
    where p.empresa_id = v_op.destino_empresa_id
      and p.codigo = v_codigo;

    if v_produto_dest is null then
      raise exception 'Produto % não está cadastrado no estabelecimento de destino.', coalesce(v_codigo, 'sem código');
    end if;

    insert into public.estoque_atual (empresa_id, produto_id, quantidade, estoque_minimo)
    values (v_op.destino_empresa_id, v_produto_dest, 0, 0)
    on conflict (empresa_id, produto_id) do nothing;

    select ea.quantidade
      into v_anterior
    from public.estoque_atual ea
    where ea.empresa_id = v_op.destino_empresa_id
      and ea.produto_id = v_produto_dest
    for update;

    v_atual := coalesce(v_anterior, 0) + v_item.quantidade;

    update public.estoque_atual
    set quantidade = v_atual
    where empresa_id = v_op.destino_empresa_id
      and produto_id = v_produto_dest;

    insert into public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao,
      fiscal_operacao_id,
      fiscal_operacao_item_id
    )
    values (
      v_op.destino_empresa_id,
      v_produto_dest,
      v_usuario,
      'TRANSFERENCIA_ENTRADA',
      'NFE_OPERACAO_FISCAL',
      v_item.quantidade,
      coalesce(v_anterior, 0),
      v_atual,
      'Entrada por transferência',
      p_operacao_id,
      v_item.id
    );

    v_movimentados := v_movimentados + 1;
    v_quantidade := v_quantidade + v_item.quantidade;
  end loop;

  update public.fiscal_operacoes as o
  set
    status = 'concluida',
    recebimento_processado_at = coalesce(o.recebimento_processado_at, now()),
    recebimento_processado_por = coalesce(o.recebimento_processado_por, v_usuario)
  where o.id = p_operacao_id
    and o.empresa_id = p_empresa_id;

  return query
  select p_operacao_id, 'concluida'::text, v_movimentados, v_quantidade;
end;
$$;

alter table public.fiscal_vinculos_transferencia enable row level security;
alter table public.fiscal_operacoes enable row level security;
alter table public.fiscal_operacoes_itens enable row level security;

drop policy if exists fiscal_vinculo_transf_select on public.fiscal_vinculos_transferencia;
drop policy if exists fiscal_vinculo_transf_insert on public.fiscal_vinculos_transferencia;
drop policy if exists fiscal_vinculo_transf_update on public.fiscal_vinculos_transferencia;
drop policy if exists fiscal_operacoes_select_empresa on public.fiscal_operacoes;
drop policy if exists fiscal_operacoes_insert_empresa on public.fiscal_operacoes;
drop policy if exists fiscal_operacoes_update_empresa on public.fiscal_operacoes;
drop policy if exists fiscal_operacoes_itens_select_empresa on public.fiscal_operacoes_itens;
drop policy if exists fiscal_operacoes_itens_insert_empresa on public.fiscal_operacoes_itens;
drop policy if exists fiscal_operacoes_itens_update_empresa on public.fiscal_operacoes_itens;
drop policy if exists fiscal_operacoes_itens_delete_empresa on public.fiscal_operacoes_itens;

create policy fiscal_vinculo_transf_select
  on public.fiscal_vinculos_transferencia for select
  using (public.tem_acesso_empresa(empresa_origem_id));

create policy fiscal_vinculo_transf_insert
  on public.fiscal_vinculos_transferencia for insert
  with check (
    public.tem_acesso_empresa(empresa_origem_id)
    and public.tem_acesso_empresa(empresa_destino_id)
  );

create policy fiscal_vinculo_transf_update
  on public.fiscal_vinculos_transferencia for update
  using (public.tem_acesso_empresa(empresa_origem_id))
  with check (public.tem_acesso_empresa(empresa_origem_id));

create policy fiscal_operacoes_select_empresa
  on public.fiscal_operacoes for select
  using (public.tem_acesso_empresa(empresa_id));

create policy fiscal_operacoes_insert_empresa
  on public.fiscal_operacoes for insert
  with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_operacoes_update_empresa
  on public.fiscal_operacoes for update
  using (public.tem_acesso_empresa(empresa_id))
  with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_operacoes_itens_select_empresa
  on public.fiscal_operacoes_itens for select
  using (public.tem_acesso_empresa(empresa_id));

create policy fiscal_operacoes_itens_insert_empresa
  on public.fiscal_operacoes_itens for insert
  with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_operacoes_itens_update_empresa
  on public.fiscal_operacoes_itens for update
  using (public.tem_acesso_empresa(empresa_id))
  with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_operacoes_itens_delete_empresa
  on public.fiscal_operacoes_itens for delete
  using (public.tem_acesso_empresa(empresa_id));

grant execute on function public.rpc_vincular_estabelecimento_transferencia(uuid, uuid) to authenticated;
grant execute on function public.rpc_confirmar_saida_operacao_fiscal(uuid, uuid) to authenticated;
grant execute on function public.rpc_confirmar_recebimento_transferencia(uuid, uuid) to authenticated;

commit;
