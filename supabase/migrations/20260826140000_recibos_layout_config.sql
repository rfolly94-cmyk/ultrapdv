begin;

-- Layout do recibo de venda por empresa (JSONB).
-- Não backfill. Isolado por empresa_id. Sem dados globais.

create table if not exists public.recibos_layout_config (
  empresa_id uuid primary key references public.empresas (id) on delete cascade,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint recibos_layout_config_objeto_check
    check (jsonb_typeof(layout) = 'object')
);

comment on table public.recibos_layout_config is
  'Configuração visual do recibo de venda da empresa ativa. Não altera dados comerciais. Isolado por empresa_id.';

alter table public.recibos_layout_config enable row level security;

drop policy if exists recibos_layout_config_select_empresa
  on public.recibos_layout_config;
create policy recibos_layout_config_select_empresa
  on public.recibos_layout_config
  for select
  to authenticated
  using (public.tem_acesso_empresa(empresa_id));

drop policy if exists recibos_layout_config_insert_empresa
  on public.recibos_layout_config;
create policy recibos_layout_config_insert_empresa
  on public.recibos_layout_config
  for insert
  to authenticated
  with check (public.tem_acesso_empresa(empresa_id));

drop policy if exists recibos_layout_config_update_empresa
  on public.recibos_layout_config;
create policy recibos_layout_config_update_empresa
  on public.recibos_layout_config
  for update
  to authenticated
  using (public.tem_acesso_empresa(empresa_id))
  with check (public.tem_acesso_empresa(empresa_id));

revoke all on table public.recibos_layout_config from public, anon;

grant select, insert, update
  on table public.recibos_layout_config
  to authenticated;

grant all
  on table public.recibos_layout_config
  to service_role;

notify pgrst, 'reload schema';

commit;
