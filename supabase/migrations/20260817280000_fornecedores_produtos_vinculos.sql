begin;

-- ============================================================
-- UltraPDV — Vínculo permanente fornecedor × produto UltraPDV
-- Aprendizado da NF-e de entrada. Sem filial no estoque atual
-- (unique empresa_id + produto_id). Não altera PDV/venda.
-- ============================================================

create table if not exists public.fornecedores_produtos_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  fornecedor_id uuid not null
    references public.fornecedores(id)
    on delete restrict,
  produto_id uuid not null,
  codigo_produto_fornecedor text not null,
  ean_fornecedor text null,
  descricao_fornecedor text null,
  unidade_fornecedor text null,
  fator_conversao numeric(14,6) not null default 1,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forn_prod_vinculo_cprod_check
    check (char_length(btrim(codigo_produto_fornecedor)) between 1 and 60),
  constraint forn_prod_vinculo_fator_check
    check (fator_conversao > 0 and fator_conversao <= 1000000),
  constraint uq_forn_prod_vinculo_cprod
    unique (empresa_id, fornecedor_id, codigo_produto_fornecedor),
  constraint forn_prod_vinculo_produto_empresa_fkey
    foreign key (empresa_id, produto_id)
    references public.produtos(empresa_id, id)
    on delete restrict
);

comment on table public.fornecedores_produtos_vinculos is
  'Aprendizado: empresa + fornecedor + cProd do XML → produto UltraPDV. Não compartilha entre empresas nem entre fornecedores.';

create index if not exists ix_forn_prod_vinculo_fornecedor
  on public.fornecedores_produtos_vinculos (empresa_id, fornecedor_id, ativo);

create index if not exists ix_forn_prod_vinculo_ean
  on public.fornecedores_produtos_vinculos (empresa_id, fornecedor_id, ean_fornecedor)
  where ean_fornecedor is not null;

drop trigger if exists trg_forn_prod_vinculo_updated_at
  on public.fornecedores_produtos_vinculos;

create trigger trg_forn_prod_vinculo_updated_at
before update on public.fornecedores_produtos_vinculos
for each row
execute function public.ultrapdv_set_updated_at();

create or replace function public.forn_prod_vinculo_assert_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
begin
  new.codigo_produto_fornecedor := btrim(new.codigo_produto_fornecedor);

  select f.empresa_id into v_empresa
  from public.fornecedores f
  where f.id = new.fornecedor_id;
  if v_empresa is distinct from new.empresa_id then
    raise exception 'O fornecedor do vínculo não pertence à empresa ativa.';
  end if;

  select p.empresa_id into v_empresa
  from public.produtos p
  where p.id = new.produto_id;
  if v_empresa is distinct from new.empresa_id then
    raise exception 'O produto do vínculo não pertence à empresa ativa.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_forn_prod_vinculo_mesma_empresa
  on public.fornecedores_produtos_vinculos;
create trigger trg_forn_prod_vinculo_mesma_empresa
before insert or update of empresa_id, fornecedor_id, produto_id, codigo_produto_fornecedor
on public.fornecedores_produtos_vinculos
for each row
execute function public.forn_prod_vinculo_assert_mesma_empresa();

alter table public.fiscal_documentos_entrada_itens
  add column if not exists fator_conversao numeric(14,6) not null default 1;

alter table public.fiscal_documentos_entrada_itens
  add column if not exists fator_conversao_confirmado boolean not null default false;

alter table public.fiscal_documentos_entrada_itens
  drop constraint if exists fiscal_entrada_itens_fator_check;

alter table public.fiscal_documentos_entrada_itens
  add constraint fiscal_entrada_itens_fator_check
  check (fator_conversao > 0 and fator_conversao <= 1000000);

comment on column public.fiscal_documentos_entrada_itens.fator_conversao is
  'Snapshot do fator usado nesta NF-e. quantidade_estoque = quantidade_recebida × fator. Não muda se o vínculo futuro for alterado.';

comment on column public.fiscal_documentos_entrada_itens.quantidade_entrada_efetivada is
  'Quantidade efetiva que entrou no estoque (recebida × fator). Snapshot imutável após entrada_concluida.';

create or replace function public.rpc_confirmar_entrada_nfe(
  p_empresa_id uuid,
  p_documento_id uuid
)
returns table (
  documento_id uuid,
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
  v_doc public.fiscal_documentos_entrada%rowtype;
  v_item record;
  v_produto record;
  v_anterior numeric(14,4);
  v_atual numeric(14,4);
  v_qtd_estoque numeric(14,4);
  v_movimentados integer := 0;
  v_quantidade numeric(14,4) := 0;
  v_pendente integer;
  v_un_xml text;
  v_un_prod text;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if not public.tem_acesso_empresa(p_empresa_id) then
    raise exception 'Usuário sem acesso à empresa.';
  end if;

  select d.*
    into v_doc
  from public.fiscal_documentos_entrada d
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Documento de entrada não encontrado nesta empresa.';
  end if;

  if v_doc.status = 'entrada_concluida' then
    raise exception 'Esta NF-e já teve a entrada de estoque processada.';
  end if;

  if v_doc.status = 'cancelada' then
    raise exception 'Documento de entrada cancelado.';
  end if;

  if v_doc.status = 'processando_entrada' then
    if exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.documento_entrada_id = p_documento_id
    ) then
      raise exception 'Esta NF-e já teve a entrada de estoque processada.';
    end if;
  end if;

  select count(*)
    into v_pendente
  from public.fiscal_documentos_entrada_itens i
  where i.empresa_id = p_empresa_id
    and i.documento_entrada_id = p_documento_id
    and i.quantidade_recebida > 0
    and i.produto_id is null;

  if coalesce(v_pendente, 0) > 0 then
    raise exception 'Vincule todos os itens com quantidade recebida a um produto da empresa ativa.';
  end if;

  if not exists (
    select 1
    from public.fiscal_documentos_entrada_itens i
    where i.empresa_id = p_empresa_id
      and i.documento_entrada_id = p_documento_id
      and i.quantidade_recebida > 0
      and i.produto_id is not null
  ) then
    raise exception 'Nenhum item com quantidade recebida para entrar no estoque.';
  end if;

  update public.fiscal_documentos_entrada as d
  set status = 'processando_entrada'
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id
    and d.status is distinct from 'entrada_concluida';

  for v_item in
    select i.*
    from public.fiscal_documentos_entrada_itens i
    where i.empresa_id = p_empresa_id
      and i.documento_entrada_id = p_documento_id
      and i.quantidade_recebida > 0
    order by i.numero_item
    for update
  loop
    if v_item.produto_id is null then
      raise exception 'Item % sem produto vinculado.', v_item.numero_item;
    end if;

    select p.id, p.empresa_id, p.unidade_medida, p.nome
      into v_produto
    from public.produtos p
    where p.id = v_item.produto_id
      and p.empresa_id = p_empresa_id;

    if not found then
      raise exception 'Produto do item % não pertence à empresa ativa.', v_item.numero_item;
    end if;

    v_un_xml := upper(btrim(coalesce(v_item.unidade, '')));
    v_un_prod := upper(btrim(coalesce(v_produto.unidade_medida, '')));

    if v_un_xml <> ''
       and v_un_prod <> ''
       and v_un_xml is distinct from v_un_prod
       and v_item.fator_conversao_confirmado is not true then
      raise exception
        'A unidade da NF-e (%) é diferente da unidade do produto % (%). Configure o fator de conversão antes de confirmar a entrada.',
        v_un_xml,
        v_produto.nome,
        v_un_prod;
    end if;

    if coalesce(v_item.fator_conversao, 0) <= 0 then
      raise exception 'Fator de conversão inválido no item %.', v_item.numero_item;
    end if;

    v_qtd_estoque := round(
      (v_item.quantidade_recebida * v_item.fator_conversao)::numeric,
      4
    );

    if v_qtd_estoque <= 0 then
      raise exception 'Quantidade efetiva de estoque do item % deve ser maior que zero.', v_item.numero_item;
    end if;

    if exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.documento_entrada_item_id = v_item.id
    ) then
      raise exception 'Esta NF-e já teve a entrada de estoque processada.';
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

    v_atual := v_anterior + v_qtd_estoque;

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
      documento_entrada_item_id
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      v_usuario,
      'ENTRADA',
      'NFE_ENTRADA',
      v_qtd_estoque,
      v_anterior,
      v_atual,
      'Entrada pela NF-e ' || v_doc.numero,
      p_documento_id,
      v_item.id
    );

    update public.fiscal_documentos_entrada_itens as i
    set quantidade_entrada_efetivada = v_qtd_estoque
    where i.id = v_item.id
      and i.empresa_id = p_empresa_id;

    v_movimentados := v_movimentados + 1;
    v_quantidade := v_quantidade + v_qtd_estoque;
  end loop;

  update public.fiscal_documentos_entrada as d
  set
    status = 'entrada_concluida',
    data_entrada = now(),
    entrada_estoque_processada_at = now(),
    entrada_estoque_processada_por = v_usuario
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id;

  return query
  select
    p_documento_id,
    'entrada_concluida'::text,
    v_movimentados,
    v_quantidade;
end;
$$;

comment on function public.rpc_confirmar_entrada_nfe(uuid, uuid) is
  'Confirma entrada de estoque. quantidade = recebida × fator_conversao do item. Idempotente. Não usa filial: estoque_atual é (empresa_id, produto_id).';

create or replace function public.fiscal_entrada_impedir_edicao_concluida()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'fiscal_documentos_entrada' then
    if old.status = 'entrada_concluida'
       and (
         new.chave_acesso is distinct from old.chave_acesso
         or new.fornecedor_id is distinct from old.fornecedor_id
         or new.valor_total is distinct from old.valor_total
         or new.xml_original is distinct from old.xml_original
         or new.cnpj_emitente is distinct from old.cnpj_emitente
       ) then
      raise exception 'Documento de entrada já processado não pode ser alterado.';
    end if;
  end if;

  if tg_table_name = 'fiscal_documentos_entrada_itens' then
    if exists (
      select 1
      from public.fiscal_documentos_entrada d
      where d.id = old.documento_entrada_id
        and d.empresa_id = old.empresa_id
        and d.status in ('entrada_concluida', 'processando_entrada')
    ) then
      if new.produto_id is distinct from old.produto_id
         or new.quantidade_recebida is distinct from old.quantidade_recebida
         or new.quantidade_xml is distinct from old.quantidade_xml
         or new.valor_total is distinct from old.valor_total
         or new.fator_conversao is distinct from old.fator_conversao
         or new.fator_conversao_confirmado is distinct from old.fator_conversao_confirmado
         or new.quantidade_entrada_efetivada is distinct from old.quantidade_entrada_efetivada then
        raise exception 'Itens de entrada já processada não podem ser alterados.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

alter table public.fornecedores_produtos_vinculos enable row level security;

drop policy if exists forn_prod_vinculo_select_empresa on public.fornecedores_produtos_vinculos;
drop policy if exists forn_prod_vinculo_insert_empresa on public.fornecedores_produtos_vinculos;
drop policy if exists forn_prod_vinculo_update_empresa on public.fornecedores_produtos_vinculos;

create policy forn_prod_vinculo_select_empresa
on public.fornecedores_produtos_vinculos for select to authenticated
using (public.tem_acesso_empresa(empresa_id));
create policy forn_prod_vinculo_insert_empresa
on public.fornecedores_produtos_vinculos for insert to authenticated
with check (public.tem_acesso_empresa(empresa_id));
create policy forn_prod_vinculo_update_empresa
on public.fornecedores_produtos_vinculos for update to authenticated
using (public.tem_acesso_empresa(empresa_id))
with check (public.tem_acesso_empresa(empresa_id));

grant select, insert, update on public.fornecedores_produtos_vinculos to authenticated;
revoke all on public.fornecedores_produtos_vinculos from anon;

notify pgrst, 'reload schema';

commit;
