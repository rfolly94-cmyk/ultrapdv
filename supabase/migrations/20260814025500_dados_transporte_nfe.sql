begin;

-- ============================================================
-- UltraPDV — Transportador / Veículo / Volumes da NF-e 55
-- Snapshot comercial por venda.
-- ============================================================

alter table public.vendas
  add column if not exists dados_transporte jsonb null;

comment on column public.vendas.dados_transporte is
  'Snapshot dos dados de transporte usados/preparados para NF-e 55: mod_frete, transportador, veículo e volumes.';

alter table public.vendas
  drop constraint if exists vendas_dados_transporte_objeto_check;

alter table public.vendas
  add constraint vendas_dados_transporte_objeto_check
  check (
    dados_transporte is null
    or jsonb_typeof(dados_transporte) = 'object'
  )
  not valid;

create index if not exists
  ix_vendas_empresa_dados_transporte
on public.vendas (empresa_id)
where dados_transporte is not null;

notify pgrst, 'reload schema';

commit;
