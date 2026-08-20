begin;

-- Destinatário fiscal: indIEDest 1/2/9 no cadastro e snapshot da venda PDV.
-- Multiempresa: coluna na tabela já isolada por empresa_id; backfill só
-- a partir de contribuinte_icms da mesma linha (true→1, false→9). Não inventa 2.

alter table public.clientes
  add column if not exists indicador_ie_destinatario text;

update public.clientes
set indicador_ie_destinatario = case
  when contribuinte_icms is true then '1'
  else '9'
end
where indicador_ie_destinatario is null;

alter table public.clientes
  alter column indicador_ie_destinatario set default '9';

alter table public.clientes
  alter column indicador_ie_destinatario set not null;

alter table public.clientes
  drop constraint if exists clientes_indicador_ie_destinatario_check;

alter table public.clientes
  add constraint clientes_indicador_ie_destinatario_check
  check (indicador_ie_destinatario in ('1', '2', '9'));

comment on column public.clientes.indicador_ie_destinatario is
  'Sugestão de indIEDest do cadastro (1 contribuinte, 2 isento, 9 não contribuinte). A NF-e usa o snapshot da operação quando já persistido.';

alter table public.vendas
  add column if not exists snapshot_fiscal jsonb;

comment on column public.vendas.snapshot_fiscal is
  'Snapshot fiscal da venda PDV (consumidor_final, indicador_ie_destinatario). Isolado por empresa_id da venda. Não substitui fiscal_operacoes.snapshot_fiscal quando a NF-e manual existir.';

alter table public.vendas
  drop constraint if exists vendas_snapshot_fiscal_objeto_check;

alter table public.vendas
  add constraint vendas_snapshot_fiscal_objeto_check
  check (
    snapshot_fiscal is null
    or jsonb_typeof(snapshot_fiscal) = 'object'
  )
  not valid;

create index if not exists ix_vendas_empresa_snapshot_fiscal
  on public.vendas (empresa_id)
  where snapshot_fiscal is not null;

create or replace function public.clientes_sincronizar_indicador_ie()
returns trigger
language plpgsql
as $$
begin
  if new.indicador_ie_destinatario in ('1', '2', '9') then
    new.contribuinte_icms := (new.indicador_ie_destinatario = '1');
  elsif new.contribuinte_icms is true then
    new.indicador_ie_destinatario := '1';
  else
    new.indicador_ie_destinatario := '9';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clientes_sincronizar_indicador_ie
  on public.clientes;

create trigger trg_clientes_sincronizar_indicador_ie
before insert or update of contribuinte_icms, indicador_ie_destinatario
on public.clientes
for each row
execute function public.clientes_sincronizar_indicador_ie();

notify pgrst, 'reload schema';

commit;
