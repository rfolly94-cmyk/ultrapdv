begin;

-- ============================================================
-- UltraPDV — Devolução ao fornecedor a partir da NF-e de entrada
-- Não cria venda. Não movimenta estoque no rascunho nem na
-- autorização. Saída só após NF-e autorizada + confirmação.
-- ============================================================

update public.fiscal_tipos_operacao
set disponivel = true
where codigo = 'devolucao_fornecedor';

create table if not exists public.fiscal_devolucoes_fornecedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  documento_entrada_id uuid not null
    references public.fiscal_documentos_entrada(id)
    on delete restrict,
  fornecedor_id uuid null
    references public.fornecedores(id)
    on delete restrict,
  natureza_id uuid null
    references public.fiscal_naturezas_operacao(id)
    on delete restrict,
  emissao_fiscal_id uuid null
    references public.fiscal_emissoes(id)
    on delete restrict,
  status text not null default 'rascunho',
  motivo text null,
  chave_documento_origem text not null,
  natureza_descricao text null,
  tp_nf text null,
  fin_nfe text null,
  tipo_destino text null,
  uf_empresa text null,
  uf_fornecedor text null,
  snapshot_fiscal jsonb not null default '{}'::jsonb,
  saida_estoque_processada_at timestamptz null,
  saida_estoque_processada_por uuid null
    references public.usuarios(id)
    on delete set null,
  created_by uuid null
    references public.usuarios(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_dev_forn_status_check
    check (status in (
      'rascunho',
      'pronta_para_verificacao',
      'pronta_para_emissao',
      'enviando',
      'aguardando_reconciliacao',
      'autorizada',
      'aguardando_saida',
      'concluida',
      'rejeitada',
      'cancelada'
    )),
  constraint fiscal_dev_forn_chave_check
    check (chave_documento_origem ~ '^[0-9]{44}$'),
  constraint fiscal_dev_forn_tp_nf_check
    check (tp_nf is null or tp_nf in ('0', '1')),
  constraint fiscal_dev_forn_fin_nfe_check
    check (fin_nfe is null or fin_nfe in ('1', '2', '3', '4')),
  constraint fiscal_dev_forn_destino_check
    check (tipo_destino is null or tipo_destino in ('interna', 'interestadual'))
);

comment on table public.fiscal_devolucoes_fornecedor is
  'Devolução ao fornecedor originada de NF-e de entrada da mesma empresa. Sem venda fictícia. Emissão em fiscal_emissoes com origem_tipo=devolucao_fornecedor e origem_id=devolucao.id.';

create index if not exists ix_fiscal_dev_forn_entrada
  on public.fiscal_devolucoes_fornecedor (empresa_id, documento_entrada_id, created_at desc);

create index if not exists ix_fiscal_dev_forn_emissao
  on public.fiscal_devolucoes_fornecedor (emissao_fiscal_id)
  where emissao_fiscal_id is not null;

drop trigger if exists trg_fiscal_dev_forn_updated_at
  on public.fiscal_devolucoes_fornecedor;

create trigger trg_fiscal_dev_forn_updated_at
before update on public.fiscal_devolucoes_fornecedor
for each row
execute function public.ultrapdv_set_updated_at();

create table if not exists public.fiscal_devolucoes_fornecedor_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  devolucao_id uuid not null
    references public.fiscal_devolucoes_fornecedor(id)
    on delete cascade,
  documento_entrada_item_id uuid not null
    references public.fiscal_documentos_entrada_itens(id)
    on delete restrict,
  produto_id uuid not null,
  grupo_fiscal_id uuid null
    references public.grupos_fiscais(id)
    on delete restrict,
  quantidade numeric(14,4) not null,
  valor_unitario_original numeric(14,4) not null default 0,
  valor_total numeric(14,2) not null default 0,
  cfop_resolvido text null,
  ncm text null,
  cest text null,
  snapshot_fiscal jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_dev_forn_itens_qtd_check
    check (quantidade > 0),
  constraint fiscal_dev_forn_itens_cfop_check
    check (cfop_resolvido is null or cfop_resolvido ~ '^[0-9]{4}$'),
  constraint uq_fiscal_dev_forn_item_origem
    unique (devolucao_id, documento_entrada_item_id),
  constraint fiscal_dev_forn_itens_produto_empresa_fkey
    foreign key (empresa_id, produto_id)
    references public.produtos(empresa_id, id)
    on delete restrict
);

comment on table public.fiscal_devolucoes_fornecedor_itens is
  'Itens da devolução ao fornecedor. Quantidade reserva saldo enquanto a devolução não estiver cancelada/rejeitada.';

create index if not exists ix_fiscal_dev_forn_itens_dev
  on public.fiscal_devolucoes_fornecedor_itens (empresa_id, devolucao_id);

create index if not exists ix_fiscal_dev_forn_itens_entrada_item
  on public.fiscal_devolucoes_fornecedor_itens (empresa_id, documento_entrada_item_id);

drop trigger if exists trg_fiscal_dev_forn_itens_updated_at
  on public.fiscal_devolucoes_fornecedor_itens;

create trigger trg_fiscal_dev_forn_itens_updated_at
before update on public.fiscal_devolucoes_fornecedor_itens
for each row
execute function public.ultrapdv_set_updated_at();

alter table public.estoque_movimentacoes
  add column if not exists devolucao_fornecedor_id uuid null;

alter table public.estoque_movimentacoes
  add column if not exists devolucao_fornecedor_item_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'estoque_movimentacoes_devolucao_fornecedor_fkey'
  ) then
    alter table public.estoque_movimentacoes
      add constraint estoque_movimentacoes_devolucao_fornecedor_fkey
      foreign key (devolucao_fornecedor_id)
      references public.fiscal_devolucoes_fornecedor(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'estoque_movimentacoes_devolucao_fornecedor_item_fkey'
  ) then
    alter table public.estoque_movimentacoes
      add constraint estoque_movimentacoes_devolucao_fornecedor_item_fkey
      foreign key (devolucao_fornecedor_item_id)
      references public.fiscal_devolucoes_fornecedor_itens(id)
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
      'DEVOLUCAO_FORNECEDOR'
    )
  );

create unique index if not exists uq_estoque_mov_devolucao_fornecedor_item
  on public.estoque_movimentacoes (empresa_id, devolucao_fornecedor_item_id)
  where devolucao_fornecedor_item_id is not null;

create or replace function public.fiscal_dev_forn_assert_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
  v_tipo text;
  v_ativo boolean;
  v_status_entrada text;
  v_chave text;
  v_fornecedor uuid;
begin
  if tg_table_name = 'fiscal_devolucoes_fornecedor' then
    select d.empresa_id, d.status, d.chave_acesso, d.fornecedor_id
      into v_empresa, v_status_entrada, v_chave, v_fornecedor
    from public.fiscal_documentos_entrada d
    where d.id = new.documento_entrada_id;

    if v_empresa is distinct from new.empresa_id then
      raise exception 'A devolução deve pertencer à mesma empresa da NF-e de entrada.';
    end if;

    if tg_op = 'INSERT' and v_status_entrada is distinct from 'entrada_concluida' then
      raise exception 'Só é possível devolver itens de uma NF-e de entrada já processada.';
    end if;

    if v_chave is distinct from new.chave_documento_origem then
      raise exception 'A chave referenciada deve ser a da NF-e de entrada original.';
    end if;

    if new.fornecedor_id is not null then
      if v_fornecedor is not null and new.fornecedor_id is distinct from v_fornecedor then
        raise exception 'O fornecedor da devolução deve ser o da NF-e de entrada.';
      end if;
      select f.empresa_id into v_empresa
      from public.fornecedores f
      where f.id = new.fornecedor_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'O fornecedor não pertence à empresa da devolução.';
      end if;
    end if;

    if new.natureza_id is not null then
      select n.empresa_id, n.tipo_operacao_interno, n.ativo
        into v_empresa, v_tipo, v_ativo
      from public.fiscal_naturezas_operacao n
      where n.id = new.natureza_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'A natureza da devolução não pertence à empresa ativa.';
      end if;
      if v_tipo is distinct from 'devolucao_fornecedor' then
        raise exception 'A devolução ao fornecedor só pode usar natureza do tipo devolucao_fornecedor.';
      end if;
      if v_ativo is not true then
        raise exception 'A natureza de operação precisa estar ativa.';
      end if;
    end if;
  end if;

  if tg_table_name = 'fiscal_devolucoes_fornecedor_itens' then
    select d.empresa_id into v_empresa
    from public.fiscal_devolucoes_fornecedor d
    where d.id = new.devolucao_id;
    if v_empresa is distinct from new.empresa_id then
      raise exception 'O item da devolução deve pertencer à mesma empresa do cabeçalho.';
    end if;

    select i.empresa_id into v_empresa
    from public.fiscal_documentos_entrada_itens i
    where i.id = new.documento_entrada_item_id;
    if v_empresa is distinct from new.empresa_id then
      raise exception 'O item original da NF-e não pertence à empresa da devolução.';
    end if;

    if new.grupo_fiscal_id is not null then
      select g.empresa_id into v_empresa
      from public.grupos_fiscais g
      where g.id = new.grupo_fiscal_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'O grupo fiscal do item não pertence à empresa da devolução.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_dev_forn_mesma_empresa
  on public.fiscal_devolucoes_fornecedor;
create trigger trg_fiscal_dev_forn_mesma_empresa
before insert or update of empresa_id, documento_entrada_id, fornecedor_id, natureza_id, chave_documento_origem
on public.fiscal_devolucoes_fornecedor
for each row
execute function public.fiscal_dev_forn_assert_mesma_empresa();

drop trigger if exists trg_fiscal_dev_forn_itens_mesma_empresa
  on public.fiscal_devolucoes_fornecedor_itens;
create trigger trg_fiscal_dev_forn_itens_mesma_empresa
before insert or update of empresa_id, devolucao_id, documento_entrada_item_id, produto_id, grupo_fiscal_id
on public.fiscal_devolucoes_fornecedor_itens
for each row
execute function public.fiscal_dev_forn_assert_mesma_empresa();

create or replace function public.fiscal_dev_forn_assert_saldo()
returns trigger
language plpgsql
as $$
declare
  v_efetivada numeric(14,4);
  v_reservada numeric(14,4);
  v_status text;
  v_entrada uuid;
  v_empresa uuid;
begin
  select d.status, d.documento_entrada_id, d.empresa_id
    into v_status, v_entrada, v_empresa
  from public.fiscal_devolucoes_fornecedor d
  where d.id = new.devolucao_id;

  if v_status in ('cancelada', 'rejeitada') then
    return new;
  end if;

  select i.quantidade_entrada_efetivada, i.empresa_id
    into v_efetivada, v_empresa
  from public.fiscal_documentos_entrada_itens i
  where i.id = new.documento_entrada_item_id
    and i.empresa_id = new.empresa_id
  for update;

  if v_efetivada is null or v_efetivada <= 0 then
    raise exception 'O item original não possui quantidade efetivada para devolver.';
  end if;

  select coalesce(sum(i.quantidade), 0)
    into v_reservada
  from public.fiscal_devolucoes_fornecedor_itens i
  join public.fiscal_devolucoes_fornecedor d
    on d.id = i.devolucao_id
   and d.empresa_id = i.empresa_id
  where i.empresa_id = new.empresa_id
    and i.documento_entrada_item_id = new.documento_entrada_item_id
    and i.id is distinct from new.id
    and d.status not in ('cancelada', 'rejeitada');

  if (v_reservada + new.quantidade) > v_efetivada + 0.00005 then
    raise exception 'A quantidade a devolver excede o saldo devolvível deste item.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_dev_forn_itens_saldo
  on public.fiscal_devolucoes_fornecedor_itens;
create trigger trg_fiscal_dev_forn_itens_saldo
before insert or update of quantidade, documento_entrada_item_id, devolucao_id
on public.fiscal_devolucoes_fornecedor_itens
for each row
execute function public.fiscal_dev_forn_assert_saldo();

create or replace function public.rpc_confirmar_saida_devolucao_fornecedor(
  p_empresa_id uuid,
  p_devolucao_id uuid
)
returns table (
  devolucao_id uuid,
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
  v_dev public.fiscal_devolucoes_fornecedor%rowtype;
  v_emissao_status text;
  v_item record;
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

  select d.*
    into v_dev
  from public.fiscal_devolucoes_fornecedor d
  where d.id = p_devolucao_id
    and d.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Devolução não encontrada nesta empresa.';
  end if;

  if v_dev.saida_estoque_processada_at is not null
     or v_dev.status = 'concluida' then
    raise exception 'A saída desta devolução já foi processada.';
  end if;

  if v_dev.status = 'cancelada' then
    raise exception 'Devolução cancelada.';
  end if;

  if v_dev.emissao_fiscal_id is null then
    raise exception 'A NF-e de devolução ainda não foi emitida.';
  end if;

  select e.status
    into v_emissao_status
  from public.fiscal_emissoes e
  where e.id = v_dev.emissao_fiscal_id
    and e.empresa_id = p_empresa_id;

  if v_emissao_status is distinct from 'autorizada' then
    raise exception 'A saída só pode ser confirmada depois que a NF-e de devolução estiver autorizada.';
  end if;

  if exists (
    select 1
    from public.estoque_movimentacoes em
    where em.empresa_id = p_empresa_id
      and em.devolucao_fornecedor_id = p_devolucao_id
  ) then
    raise exception 'A saída desta devolução já foi processada.';
  end if;

  for v_item in
    select i.*
    from public.fiscal_devolucoes_fornecedor_itens i
    where i.empresa_id = p_empresa_id
      and i.devolucao_id = p_devolucao_id
    order by i.created_at
    for update
  loop
    if v_item.produto_id is null then
      raise exception 'Item da devolução sem produto vinculado.';
    end if;

    if not exists (
      select 1
      from public.produtos p
      where p.id = v_item.produto_id
        and p.empresa_id = p_empresa_id
    ) then
      raise exception 'Produto da devolução não pertence à empresa ativa.';
    end if;

    if exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.devolucao_fornecedor_item_id = v_item.id
    ) then
      raise exception 'A saída desta devolução já foi processada.';
    end if;

    insert into public.estoque_atual (
      empresa_id,
      produto_id,
      quantidade,
      estoque_minimo
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      0,
      0
    )
    on conflict (empresa_id, produto_id)
    do nothing;

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
      raise exception 'Estoque insuficiente para confirmar a saída da devolução.';
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
      documento_entrada_id,
      devolucao_fornecedor_id,
      devolucao_fornecedor_item_id
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      v_usuario,
      'DEVOLUCAO_FORNECEDOR',
      'NFE_DEVOLUCAO_FORNECEDOR',
      v_item.quantidade,
      v_anterior,
      v_atual,
      'Saída pela devolução ao fornecedor',
      v_dev.documento_entrada_id,
      p_devolucao_id,
      v_item.id
    );

    v_movimentados := v_movimentados + 1;
    v_quantidade := v_quantidade + v_item.quantidade;
  end loop;

  if v_movimentados = 0 then
    raise exception 'A devolução não possui itens para saída de estoque.';
  end if;

  update public.fiscal_devolucoes_fornecedor as d
  set
    status = 'concluida',
    saida_estoque_processada_at = now(),
    saida_estoque_processada_por = v_usuario
  where d.id = p_devolucao_id
    and d.empresa_id = p_empresa_id;

  return query
  select
    p_devolucao_id,
    'concluida'::text,
    v_movimentados,
    v_quantidade;
end;
$$;

comment on function public.rpc_confirmar_saida_devolucao_fornecedor(uuid, uuid) is
  'Confirma saída de estoque da devolução ao fornecedor após NF-e autorizada. Atômica e idempotente.';

revoke all on function public.rpc_confirmar_saida_devolucao_fornecedor(uuid, uuid) from public;
grant execute on function public.rpc_confirmar_saida_devolucao_fornecedor(uuid, uuid) to authenticated;

alter table public.fiscal_devolucoes_fornecedor enable row level security;
alter table public.fiscal_devolucoes_fornecedor_itens enable row level security;

drop policy if exists fiscal_dev_forn_select_empresa on public.fiscal_devolucoes_fornecedor;
drop policy if exists fiscal_dev_forn_insert_empresa on public.fiscal_devolucoes_fornecedor;
drop policy if exists fiscal_dev_forn_update_empresa on public.fiscal_devolucoes_fornecedor;
drop policy if exists fiscal_dev_forn_itens_select_empresa on public.fiscal_devolucoes_fornecedor_itens;
drop policy if exists fiscal_dev_forn_itens_insert_empresa on public.fiscal_devolucoes_fornecedor_itens;
drop policy if exists fiscal_dev_forn_itens_update_empresa on public.fiscal_devolucoes_fornecedor_itens;

create policy fiscal_dev_forn_select_empresa
on public.fiscal_devolucoes_fornecedor for select to authenticated
using (public.tem_acesso_empresa(empresa_id));
create policy fiscal_dev_forn_insert_empresa
on public.fiscal_devolucoes_fornecedor for insert to authenticated
with check (public.tem_acesso_empresa(empresa_id));
create policy fiscal_dev_forn_update_empresa
on public.fiscal_devolucoes_fornecedor for update to authenticated
using (public.tem_acesso_empresa(empresa_id))
with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_dev_forn_itens_select_empresa
on public.fiscal_devolucoes_fornecedor_itens for select to authenticated
using (public.tem_acesso_empresa(empresa_id));
create policy fiscal_dev_forn_itens_insert_empresa
on public.fiscal_devolucoes_fornecedor_itens for insert to authenticated
with check (public.tem_acesso_empresa(empresa_id));
create policy fiscal_dev_forn_itens_update_empresa
on public.fiscal_devolucoes_fornecedor_itens for update to authenticated
using (public.tem_acesso_empresa(empresa_id))
with check (public.tem_acesso_empresa(empresa_id));

grant select, insert, update on public.fiscal_devolucoes_fornecedor to authenticated;
grant select, insert, update on public.fiscal_devolucoes_fornecedor_itens to authenticated;

revoke all on public.fiscal_devolucoes_fornecedor from anon;
revoke all on public.fiscal_devolucoes_fornecedor_itens from anon;

commit;
