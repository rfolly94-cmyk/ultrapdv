begin;

create table if not exists public.transportadoras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome_razao_social text not null,
  nome_fantasia text null,
  cpf_cnpj text not null,
  inscricao_estadual text null,
  rntrc text null,
  telefone text null,
  email text null,
  logradouro text null,
  numero text null,
  complemento text null,
  bairro text null,
  municipio text null,
  codigo_municipio_ibge text null,
  uf text null,
  cep text null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_transportadoras_documento
    check (cpf_cnpj ~ '^[0-9]{11}$' or cpf_cnpj ~ '^[0-9]{14}$'),
  constraint ck_transportadoras_uf
    check (uf is null or uf ~ '^[A-Z]{2}$'),
  constraint ck_transportadoras_cep
    check (cep is null or cep ~ '^[0-9]{8}$')
);

create unique index if not exists uq_transportadoras_empresa_documento
  on public.transportadoras (empresa_id, cpf_cnpj);

create index if not exists ix_transportadoras_empresa_ativo_nome
  on public.transportadoras (empresa_id, ativo, nome_razao_social);

create table if not exists public.transportadoras_veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  transportadora_id uuid not null references public.transportadoras(id) on delete cascade,
  placa text not null,
  uf text null,
  rntrc text null,
  descricao text null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_transportadoras_veiculos_placa
    check (placa ~ '^[A-Z0-9]{7}$'),
  constraint ck_transportadoras_veiculos_uf
    check (uf is null or uf ~ '^[A-Z]{2}$')
);

create unique index if not exists uq_transportadoras_veiculos_empresa_placa
  on public.transportadoras_veiculos (empresa_id, placa);

create index if not exists ix_transportadoras_veiculos_transportadora
  on public.transportadoras_veiculos (transportadora_id, ativo);

alter table public.transportadoras enable row level security;
alter table public.transportadoras_veiculos enable row level security;

drop policy if exists transportadoras_select_empresa on public.transportadoras;
create policy transportadoras_select_empresa
on public.transportadoras
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = transportadoras.empresa_id
      and ue.ativo = true
  )
);

drop policy if exists transportadoras_veiculos_select_empresa on public.transportadoras_veiculos;
create policy transportadoras_veiculos_select_empresa
on public.transportadoras_veiculos
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = transportadoras_veiculos.empresa_id
      and ue.ativo = true
  )
);

-- Escrita é feita somente pelo backend/service_role.
revoke insert, update, delete on public.transportadoras from authenticated, anon;
revoke insert, update, delete on public.transportadoras_veiculos from authenticated, anon;

comment on table public.transportadoras is
'Cadastro reutilizável de transportadoras por empresa. A venda mantém snapshot próprio em vendas.dados_transporte.';

comment on table public.transportadoras_veiculos is
'Veículos vinculados a transportadoras. A venda mantém snapshot do veículo selecionado.';

commit;
