begin;

create table if not exists public.fiscal_ambiente_alteracoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ambiente_anterior smallint not null,
  ambiente_novo smallint not null,
  motivo text not null,
  usuario_id uuid null references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fiscal_ambiente_alteracoes_ambientes_check
    check (
      ambiente_anterior in (1,2)
      and ambiente_novo in (1,2)
      and ambiente_anterior <> ambiente_novo
    ),
  constraint fiscal_ambiente_alteracoes_motivo_check
    check (char_length(btrim(motivo)) between 10 and 500)
);

create index if not exists ix_fiscal_ambiente_alteracoes_empresa_data
  on public.fiscal_ambiente_alteracoes (
    empresa_id,
    created_at desc
  );

alter table public.fiscal_ambiente_alteracoes enable row level security;

drop policy if exists fiscal_ambiente_alteracoes_select_empresa
  on public.fiscal_ambiente_alteracoes;

create policy fiscal_ambiente_alteracoes_select_empresa
on public.fiscal_ambiente_alteracoes
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = fiscal_ambiente_alteracoes.empresa_id
      and ue.ativo = true
  )
);

revoke insert, update, delete
on public.fiscal_ambiente_alteracoes
from authenticated, anon;

commit;
