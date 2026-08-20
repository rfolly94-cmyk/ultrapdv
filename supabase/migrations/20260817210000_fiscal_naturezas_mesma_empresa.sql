begin;

-- Isolamento multiempresa das naturezas / CFOP / snapshot da emissão.
-- Cadastro fiscal não pode apontar para registro de outra empresa.

drop index if exists public.uq_fiscal_natureza_cfop_regra;
drop index if exists public.ix_fiscal_natureza_cfop_natureza;

create unique index if not exists uq_fiscal_natureza_cfop_regra
  on public.fiscal_natureza_cfop_regras (
    empresa_id,
    natureza_id,
    (coalesce(grupo_fiscal_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    tipo_destino
  );

create index if not exists ix_fiscal_natureza_cfop_natureza
  on public.fiscal_natureza_cfop_regras (
    empresa_id,
    natureza_id,
    ativo
  );

create or replace function public.fiscal_assert_cfop_regra_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa_natureza uuid;
  v_empresa_grupo uuid;
begin
  if new.empresa_id is null then
    raise exception 'A regra de CFOP precisa da empresa ativa.';
  end if;

  select n.empresa_id
    into v_empresa_natureza
  from public.fiscal_naturezas_operacao n
  where n.id = new.natureza_id;

  if v_empresa_natureza is null
     or v_empresa_natureza is distinct from new.empresa_id then
    raise exception 'A regra de CFOP deve usar natureza da mesma empresa.';
  end if;

  if new.grupo_fiscal_id is not null then
    select g.empresa_id
      into v_empresa_grupo
    from public.grupos_fiscais g
    where g.id = new.grupo_fiscal_id;

    if v_empresa_grupo is null
       or v_empresa_grupo is distinct from new.empresa_id then
      raise exception 'A regra de CFOP deve usar grupo fiscal da mesma empresa.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_cfop_regra_mesma_empresa
  on public.fiscal_natureza_cfop_regras;

create trigger trg_fiscal_cfop_regra_mesma_empresa
before insert or update of empresa_id, natureza_id, grupo_fiscal_id
on public.fiscal_natureza_cfop_regras
for each row
execute function public.fiscal_assert_cfop_regra_mesma_empresa();

create or replace function public.fiscal_assert_emissao_natureza_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa_natureza uuid;
  v_empresa_origem uuid;
begin
  if new.natureza_id is not null then
    select n.empresa_id
      into v_empresa_natureza
    from public.fiscal_naturezas_operacao n
    where n.id = new.natureza_id;

    if v_empresa_natureza is null
       or v_empresa_natureza is distinct from new.empresa_id then
      raise exception 'A natureza de operação não pertence à empresa da emissão.';
    end if;
  end if;

  if new.documento_origem_emissao_id is not null then
    select e.empresa_id
      into v_empresa_origem
    from public.fiscal_emissoes e
    where e.id = new.documento_origem_emissao_id;

    if v_empresa_origem is null
       or v_empresa_origem is distinct from new.empresa_id then
      raise exception 'O documento de origem não pertence à empresa da emissão.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_emissoes_natureza_mesma_empresa
  on public.fiscal_emissoes;

create trigger trg_fiscal_emissoes_natureza_mesma_empresa
before insert or update of empresa_id, natureza_id, documento_origem_emissao_id
on public.fiscal_emissoes
for each row
execute function public.fiscal_assert_emissao_natureza_mesma_empresa();

comment on function public.fiscal_assert_cfop_regra_mesma_empresa() is
  'Impede regra de CFOP cruzando natureza ou grupo fiscal de outra empresa.';

comment on function public.fiscal_assert_emissao_natureza_mesma_empresa() is
  'Impede emissão com natureza ou documento de origem de outra empresa.';

commit;
