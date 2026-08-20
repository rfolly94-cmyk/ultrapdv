begin;

-- Natureza escolhida na preparação da NF-e 55 da venda.
-- Pertence à empresa da venda; nesta etapa só operação interna de venda.

alter table public.vendas
  add column if not exists natureza_id uuid null
    references public.fiscal_naturezas_operacao(id)
    on delete set null;

comment on column public.vendas.natureza_id is
  'Natureza de operação escolhida na preparação da NF-e 55 desta venda. Se nulo, usa a natureza padrão de venda da empresa.';

create index if not exists ix_vendas_empresa_natureza
  on public.vendas (empresa_id, natureza_id)
  where natureza_id is not null;

create or replace function public.vendas_assert_natureza_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
  v_tipo text;
begin
  if new.natureza_id is null then
    return new;
  end if;

  select n.empresa_id, n.tipo_operacao_interno
    into v_empresa, v_tipo
  from public.fiscal_naturezas_operacao n
  where n.id = new.natureza_id;

  if v_empresa is null
     or v_empresa is distinct from new.empresa_id then
    raise exception 'A natureza de operação não pertence à empresa da venda.';
  end if;

  if v_tipo is distinct from 'venda' then
    raise exception 'A NF-e desta venda só pode usar natureza do tipo Venda.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vendas_natureza_mesma_empresa
  on public.vendas;

create trigger trg_vendas_natureza_mesma_empresa
before insert or update of empresa_id, natureza_id
on public.vendas
for each row
execute function public.vendas_assert_natureza_mesma_empresa();

commit;
