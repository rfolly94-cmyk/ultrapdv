begin;

-- Matriz de CFOP por natureza + grupo fiscal + destino.
-- Reutiliza public.fiscal_natureza_cfop_regras (já criada).
-- Sem seed de CFOP. Sem cruzamento entre empresas.

delete from public.fiscal_natureza_cfop_regras
where grupo_fiscal_id is null;

alter table public.fiscal_natureza_cfop_regras
  alter column grupo_fiscal_id set not null;

drop index if exists public.uq_fiscal_natureza_cfop_regra;

alter table public.fiscal_natureza_cfop_regras
  drop constraint if exists uq_fiscal_natureza_cfop_regra;

alter table public.fiscal_natureza_cfop_regras
  add constraint uq_fiscal_natureza_cfop_regra
  unique (empresa_id, natureza_id, grupo_fiscal_id, tipo_destino);

comment on table public.fiscal_natureza_cfop_regras is
  'Matriz de CFOP por empresa, natureza, grupo fiscal e destino (interna/interestadual). Sem seed. Venda padrão pode cair no CFOP do grupo fiscal enquanto não houver regra.';

comment on column public.fiscal_natureza_cfop_regras.tipo_destino is
  'interna = mesma UF do emitente; interestadual = UF distinta.';

drop policy if exists fiscal_natureza_cfop_regras_select_empresa
  on public.fiscal_natureza_cfop_regras;
drop policy if exists fiscal_natureza_cfop_regras_insert_empresa
  on public.fiscal_natureza_cfop_regras;
drop policy if exists fiscal_natureza_cfop_regras_update_empresa
  on public.fiscal_natureza_cfop_regras;
drop policy if exists fiscal_natureza_cfop_regras_delete_empresa
  on public.fiscal_natureza_cfop_regras;

create policy fiscal_natureza_cfop_regras_select_empresa
on public.fiscal_natureza_cfop_regras
for select
to authenticated
using (public.tem_acesso_empresa(empresa_id));

create policy fiscal_natureza_cfop_regras_insert_empresa
on public.fiscal_natureza_cfop_regras
for insert
to authenticated
with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_natureza_cfop_regras_update_empresa
on public.fiscal_natureza_cfop_regras
for update
to authenticated
using (public.tem_acesso_empresa(empresa_id))
with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_natureza_cfop_regras_delete_empresa
on public.fiscal_natureza_cfop_regras
for delete
to authenticated
using (public.tem_acesso_empresa(empresa_id));

grant select, insert, update, delete
  on public.fiscal_natureza_cfop_regras
  to authenticated;

revoke all
  on public.fiscal_natureza_cfop_regras
  from anon;

create or replace function public.vendas_assert_natureza_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
  v_tipo text;
  v_ativo boolean;
begin
  if new.natureza_id is null then
    return new;
  end if;

  select n.empresa_id, n.tipo_operacao_interno, n.ativo
    into v_empresa, v_tipo, v_ativo
  from public.fiscal_naturezas_operacao n
  where n.id = new.natureza_id;

  if v_empresa is null
     or v_empresa is distinct from new.empresa_id then
    raise exception 'A natureza de operação não pertence à empresa da venda.';
  end if;

  if v_tipo is distinct from 'venda' then
    raise exception 'A NF-e desta venda só pode usar natureza do tipo Venda.';
  end if;

  if v_ativo is not true then
    raise exception 'A natureza de operação precisa estar ativa.';
  end if;

  return new;
end;
$$;

commit;
