begin;

-- ============================================================
-- UltraPDV — Fundação de operações fiscais da NF-e 55
--
-- tipo_operacao_interno NÃO é finNFe.
-- Venda continua usando CFOP do grupo fiscal.
-- Demais operações não recebem seed de CFOP.
-- natureza_operacao_padrao em empresas_fiscal é preservada.
-- ============================================================

create table if not exists public.fiscal_tipos_operacao (
  codigo text primary key,
  rotulo text not null,
  requer_documento_origem boolean not null default false,
  disponivel boolean not null default false,
  movimenta_estoque boolean not null default false,
  vincula_venda boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.fiscal_tipos_operacao is
  'Catálogo interno de tipos de operação da NF-e 55. Não confundir com finNFe.';

insert into public.fiscal_tipos_operacao (
  codigo,
  rotulo,
  requer_documento_origem,
  disponivel,
  movimenta_estoque,
  vincula_venda
)
values
  ('venda', 'Venda', false, true, true, true),
  ('devolucao_venda', 'Devolução de venda', true, false, true, true),
  ('devolucao_fornecedor', 'Devolução para fornecedor', true, false, true, false),
  ('transferencia', 'Transferência', false, false, true, false),
  ('remessa', 'Remessa', false, false, true, false),
  ('retorno', 'Retorno', true, false, true, false),
  ('complementar', 'NF-e complementar', true, false, false, false),
  ('ajuste', 'NF-e de ajuste', false, false, false, false),
  ('nota_credito', 'Nota de crédito', true, false, false, false),
  ('nota_debito', 'Nota de débito', true, false, false, false),
  ('outra', 'Outra operação', false, false, false, false)
on conflict (codigo) do update
set
  rotulo = excluded.rotulo,
  requer_documento_origem = excluded.requer_documento_origem,
  disponivel = excluded.disponivel,
  movimenta_estoque = excluded.movimenta_estoque,
  vincula_venda = excluded.vincula_venda;

create table if not exists public.fiscal_naturezas_operacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  tipo_operacao_interno text not null
    references public.fiscal_tipos_operacao(codigo),
  descricao text not null,
  tp_nf text not null,
  fin_nfe text not null,
  padrao boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_naturezas_descricao_check
    check (char_length(btrim(descricao)) between 1 and 60),
  constraint fiscal_naturezas_tp_nf_check
    check (tp_nf in ('0', '1')),
  constraint fiscal_naturezas_fin_nfe_check
    check (fin_nfe in ('1', '2', '3', '4'))
);

comment on table public.fiscal_naturezas_operacao is
  'Naturezas de operação por empresa. descricao → natOp; tp_nf → tipo; fin_nfe → finalidade fiscal (1–4 nesta etapa).';

comment on column public.fiscal_naturezas_operacao.tipo_operacao_interno is
  'Operação interna (venda, transferência, remessa…). Não é finNFe.';

comment on column public.fiscal_naturezas_operacao.descricao is
  'Texto enviado em nfe.naturezaOperacao / natOp.';

comment on column public.fiscal_naturezas_operacao.tp_nf is
  '0 = entrada, 1 = saída.';

comment on column public.fiscal_naturezas_operacao.fin_nfe is
  'Finalidade fiscal 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução. 5/6 não são persistidos nesta etapa.';

create index if not exists ix_fiscal_naturezas_empresa_tipo
  on public.fiscal_naturezas_operacao (
    empresa_id,
    tipo_operacao_interno,
    ativo
  );

create unique index if not exists uq_fiscal_naturezas_padrao_por_tipo
  on public.fiscal_naturezas_operacao (
    empresa_id,
    tipo_operacao_interno
  )
  where padrao;

drop trigger if exists trg_fiscal_naturezas_operacao_updated_at
  on public.fiscal_naturezas_operacao;

create trigger trg_fiscal_naturezas_operacao_updated_at
before update on public.fiscal_naturezas_operacao
for each row
execute function public.ultrapdv_set_updated_at();

create or replace function public.fiscal_naturezas_garantir_padrao_unico()
returns trigger
language plpgsql
as $$
begin
  if new.padrao then
    update public.fiscal_naturezas_operacao
    set padrao = false
    where empresa_id = new.empresa_id
      and tipo_operacao_interno = new.tipo_operacao_interno
      and id is distinct from new.id
      and padrao;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_naturezas_padrao_unico
  on public.fiscal_naturezas_operacao;

create trigger trg_fiscal_naturezas_padrao_unico
before insert or update of padrao, tipo_operacao_interno, empresa_id
on public.fiscal_naturezas_operacao
for each row
execute function public.fiscal_naturezas_garantir_padrao_unico();

-- Arquitetura futura de CFOP por natureza. Sem seed.
create table if not exists public.fiscal_natureza_cfop_regras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  natureza_id uuid not null
    references public.fiscal_naturezas_operacao(id)
    on delete cascade,
  grupo_fiscal_id uuid null
    references public.grupos_fiscais(id)
    on delete cascade,
  tipo_destino text not null,
  cfop text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_natureza_cfop_tipo_destino_check
    check (tipo_destino in ('interna', 'interestadual')),
  constraint fiscal_natureza_cfop_cfop_check
    check (cfop ~ '^[0-9]{4}$')
);

comment on table public.fiscal_natureza_cfop_regras is
  'Regras explícitas de CFOP por natureza/grupo/destino. Vazio nesta etapa. Venda continua usando grupos_fiscais.';

create unique index if not exists uq_fiscal_natureza_cfop_regra
  on public.fiscal_natureza_cfop_regras (
    natureza_id,
    (coalesce(grupo_fiscal_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    tipo_destino
  );

create index if not exists ix_fiscal_natureza_cfop_natureza
  on public.fiscal_natureza_cfop_regras (
    natureza_id,
    ativo
  );

drop trigger if exists trg_fiscal_natureza_cfop_regras_updated_at
  on public.fiscal_natureza_cfop_regras;

create trigger trg_fiscal_natureza_cfop_regras_updated_at
before update on public.fiscal_natureza_cfop_regras
for each row
execute function public.ultrapdv_set_updated_at();

-- Snapshot na emissão. origem_tipo/origem_id já são genéricos.
alter table public.fiscal_emissoes
  add column if not exists tipo_operacao_interno text null
    references public.fiscal_tipos_operacao(codigo);

alter table public.fiscal_emissoes
  add column if not exists natureza_id uuid null
    references public.fiscal_naturezas_operacao(id)
    on delete restrict;

alter table public.fiscal_emissoes
  add column if not exists tp_nf text null;

alter table public.fiscal_emissoes
  add column if not exists fin_nfe text null;

alter table public.fiscal_emissoes
  add column if not exists documento_origem_emissao_id uuid null
    references public.fiscal_emissoes(id)
    on delete set null;

alter table public.fiscal_emissoes
  add column if not exists chave_documento_origem text null;

alter table public.fiscal_emissoes
  drop constraint if exists fiscal_emissoes_tp_nf_check;

alter table public.fiscal_emissoes
  add constraint fiscal_emissoes_tp_nf_check
  check (tp_nf is null or tp_nf in ('0', '1'));

alter table public.fiscal_emissoes
  drop constraint if exists fiscal_emissoes_fin_nfe_check;

alter table public.fiscal_emissoes
  add constraint fiscal_emissoes_fin_nfe_check
  check (fin_nfe is null or fin_nfe in ('1', '2', '3', '4'));

comment on column public.fiscal_emissoes.tipo_operacao_interno is
  'Snapshot do tipo interno da operação no momento da emissão.';

comment on column public.fiscal_emissoes.natureza_id is
  'Natureza de operação usada na emissão.';

comment on column public.fiscal_emissoes.tp_nf is
  'Snapshot de tpNF (0 entrada / 1 saída) no momento da emissão.';

comment on column public.fiscal_emissoes.fin_nfe is
  'Snapshot de finNFe (1–4) no momento da emissão.';

comment on column public.fiscal_emissoes.documento_origem_emissao_id is
  'NF-e original referenciada (devolução/complementar/ajuste). Estrutura apenas nesta etapa.';

comment on column public.fiscal_emissoes.chave_documento_origem is
  'Chave de acesso do documento de origem, quando aplicável.';

create index if not exists ix_fiscal_emissoes_natureza
  on public.fiscal_emissoes (empresa_id, natureza_id)
  where natureza_id is not null;

create index if not exists ix_fiscal_emissoes_documento_origem
  on public.fiscal_emissoes (documento_origem_emissao_id)
  where documento_origem_emissao_id is not null;

-- Backfill: natureza padrão de venda a partir do texto legado.
insert into public.fiscal_naturezas_operacao (
  empresa_id,
  tipo_operacao_interno,
  descricao,
  tp_nf,
  fin_nfe,
  padrao,
  ativo
)
select
  ef.empresa_id,
  'venda',
  left(btrim(ef.natureza_operacao_padrao), 60),
  '1',
  '1',
  true,
  true
from public.empresas_fiscal ef
where btrim(coalesce(ef.natureza_operacao_padrao, '')) <> ''
  and not exists (
    select 1
    from public.fiscal_naturezas_operacao n
    where n.empresa_id = ef.empresa_id
      and n.tipo_operacao_interno = 'venda'
      and n.padrao
  );

-- Novas empresas: se ainda não houver natureza padrão de venda, criar a partir do texto legado.
create or replace function public.fiscal_garantir_natureza_venda_inicial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_descricao text;
begin
  v_descricao := left(btrim(coalesce(new.natureza_operacao_padrao, '')), 60);

  if v_descricao = '' then
    return new;
  end if;

  if exists (
    select 1
    from public.fiscal_naturezas_operacao n
    where n.empresa_id = new.empresa_id
      and n.tipo_operacao_interno = 'venda'
      and n.padrao
  ) then
    return new;
  end if;

  insert into public.fiscal_naturezas_operacao (
    empresa_id,
    tipo_operacao_interno,
    descricao,
    tp_nf,
    fin_nfe,
    padrao,
    ativo
  ) values (
    new.empresa_id,
    'venda',
    v_descricao,
    '1',
    '1',
    true,
    true
  );

  return new;
end;
$$;

drop trigger if exists trg_fiscal_garantir_natureza_venda_inicial
  on public.empresas_fiscal;

create trigger trg_fiscal_garantir_natureza_venda_inicial
after insert or update of natureza_operacao_padrao
on public.empresas_fiscal
for each row
execute function public.fiscal_garantir_natureza_venda_inicial();

alter table public.fiscal_tipos_operacao enable row level security;
alter table public.fiscal_naturezas_operacao enable row level security;
alter table public.fiscal_natureza_cfop_regras enable row level security;

drop policy if exists fiscal_tipos_operacao_select
  on public.fiscal_tipos_operacao;

create policy fiscal_tipos_operacao_select
on public.fiscal_tipos_operacao
for select
to authenticated
using (true);

drop policy if exists fiscal_naturezas_operacao_select_empresa
  on public.fiscal_naturezas_operacao;

create policy fiscal_naturezas_operacao_select_empresa
on public.fiscal_naturezas_operacao
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = fiscal_naturezas_operacao.empresa_id
      and ue.ativo = true
  )
);

drop policy if exists fiscal_natureza_cfop_regras_select_empresa
  on public.fiscal_natureza_cfop_regras;

create policy fiscal_natureza_cfop_regras_select_empresa
on public.fiscal_natureza_cfop_regras
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = fiscal_natureza_cfop_regras.empresa_id
      and ue.ativo = true
  )
);

revoke insert, update, delete
  on public.fiscal_tipos_operacao
  from authenticated, anon;

revoke insert, update, delete
  on public.fiscal_naturezas_operacao
  from authenticated, anon;

revoke insert, update, delete
  on public.fiscal_natureza_cfop_regras
  from authenticated, anon;

grant select on public.fiscal_tipos_operacao to authenticated;
grant select on public.fiscal_naturezas_operacao to authenticated;
grant select on public.fiscal_natureza_cfop_regras to authenticated;

commit;
