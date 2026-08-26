begin;

-- Snapshot tributário imutável do item da venda no fechamento comercial.
-- Não backfill de vendas antigas. Isolado por empresa_id da linha.
-- Não altera rpc_finalizar_venda, claim, numeração nem reconciliação.

alter table public.vendas_itens
  add column if not exists snapshot_fiscal jsonb;

comment on column public.vendas_itens.snapshot_fiscal is
  'Snapshot tributário do item no momento da inserção (finalização/edição da venda). NFC-e/NF-e da venda devem usar este JSONB, não o grupo fiscal vivo. Isolado por empresa_id do item.';

alter table public.vendas_itens
  drop constraint if exists vendas_itens_snapshot_fiscal_objeto_check;

alter table public.vendas_itens
  add constraint vendas_itens_snapshot_fiscal_objeto_check
  check (
    snapshot_fiscal is null
    or jsonb_typeof(snapshot_fiscal) = 'object'
  )
  not valid;

create index if not exists ix_vendas_itens_empresa_snapshot_fiscal
  on public.vendas_itens (empresa_id)
  where snapshot_fiscal is not null;

create or replace function public.vendas_itens_congelar_snapshot_tributario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_grupo public.grupos_fiscais%rowtype;
  v_fiscal public.produtos_fiscal%rowtype;
  v_produto public.produtos%rowtype;
  v_origem text;
  v_ncm text;
  v_cest text;
  v_origem_produto text;
  v_cfop_interno text;
  v_cfop_interestadual text;
  v_cfop text;
begin
  if new.empresa_id is null then
    raise exception 'empresa_id é obrigatório no item da venda';
  end if;

  if new.snapshot_fiscal is not null
     and jsonb_typeof(new.snapshot_fiscal) = 'object'
     and coalesce(new.snapshot_fiscal->>'versao', '') <> ''
     and coalesce(new.snapshot_fiscal->>'origem', '') in (
       'finalizacao',
       'edicao_venda'
     )
     and coalesce(new.snapshot_fiscal->>'ncm', '') <> ''
     and coalesce(
       new.snapshot_fiscal->>'cfop_interno',
       new.snapshot_fiscal->>'cfop',
       ''
     ) ~ '^[0-9]{4}$'
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.snapshot_fiscal is not null
     and jsonb_typeof(old.snapshot_fiscal) = 'object'
     and coalesce(old.snapshot_fiscal->>'origem', '') in (
       'finalizacao',
       'edicao_venda',
       'fallback_legado'
     )
     and coalesce(old.snapshot_fiscal->>'ncm', '') <> ''
  then
    new.snapshot_fiscal := old.snapshot_fiscal;
    return new;
  end if;

  v_origem := case
    when tg_op = 'UPDATE' then 'edicao_venda'
    else 'finalizacao'
  end;

  if new.grupo_fiscal_id is not null then
    select g.*
    into v_grupo
    from public.grupos_fiscais as g
    where g.id = new.grupo_fiscal_id
      and g.empresa_id = new.empresa_id;
  end if;

  if new.produto_id is not null then
    select p.*
    into v_produto
    from public.produtos as p
    where p.id = new.produto_id
      and p.empresa_id = new.empresa_id;

    select f.*
    into v_fiscal
    from public.produtos_fiscal as f
    where f.produto_id = new.produto_id
      and f.empresa_id = new.empresa_id;
  end if;

  v_ncm := coalesce(
    nullif(btrim(new.ncm), ''),
    nullif(btrim(v_fiscal.ncm), '')
  );
  v_cest := coalesce(
    nullif(btrim(new.cest), ''),
    nullif(btrim(v_fiscal.cest), '')
  );
  v_origem_produto := coalesce(
    nullif(btrim(new.origem_produto), ''),
    nullif(btrim(v_fiscal.origem_produto), '')
  );
  v_cfop_interno := nullif(btrim(v_grupo.cfop_interno), '');
  v_cfop_interestadual := nullif(btrim(v_grupo.cfop_interestadual), '');
  v_cfop := coalesce(
    nullif(btrim(new.cfop), ''),
    v_cfop_interno
  );

  new.snapshot_fiscal := jsonb_strip_nulls(
    jsonb_build_object(
      'versao', 1,
      'origem', v_origem,
      'congelado_em', pg_catalog.now(),
      'grupo_fiscal_id', new.grupo_fiscal_id,
      'grupo_fiscal_nome', v_grupo.nome,
      'ncm', v_ncm,
      'cest', v_cest,
      'origem_produto', v_origem_produto,
      'unidade_medida', new.unidade_medida,
      'codigo_barras', v_produto.codigo_barras,
      'tipo_item', v_produto.tipo_item,
      'cfop', v_cfop,
      'cfop_interno', v_cfop_interno,
      'cfop_interestadual', v_cfop_interestadual,
      'icms_cst_csosn', coalesce(
        nullif(btrim(new.icms_cst_csosn), ''),
        nullif(btrim(v_grupo.icms_cst_csosn), '')
      ),
      'icms_aliquota', v_grupo.icms_aliquota,
      'pis_cst', coalesce(
        nullif(btrim(new.pis_cst), ''),
        nullif(btrim(v_grupo.pis_cst), '')
      ),
      'pis_aliquota', v_grupo.pis_aliquota,
      'cofins_cst', coalesce(
        nullif(btrim(new.cofins_cst), ''),
        nullif(btrim(v_grupo.cofins_cst), '')
      ),
      'cofins_aliquota', v_grupo.cofins_aliquota,
      'ipi_aplicavel', v_grupo.ipi_aplicavel,
      'ipi_cst', v_grupo.ipi_cst,
      'ipi_aliquota', v_grupo.ipi_aliquota,
      'ipi_enquadramento', v_grupo.ipi_enquadramento,
      'cst_ibscbs', coalesce(
        nullif(btrim(new.cst_ibscbs), ''),
        nullif(btrim(v_grupo.cst_ibscbs), '')
      ),
      'classificacao_ibscbs', coalesce(
        nullif(btrim(new.classificacao_ibscbs), ''),
        nullif(btrim(v_grupo.classificacao_ibscbs), '')
      ),
      'aliquota_ibs_uf', v_grupo.aliquota_ibs_uf,
      'aliquota_ibs_municipio', v_grupo.aliquota_ibs_municipio,
      'aliquota_cbs', v_grupo.aliquota_cbs,
      'percentual_reducao_ibs_uf', v_grupo.percentual_reducao_ibs_uf,
      'percentual_reducao_ibs_municipio', v_grupo.percentual_reducao_ibs_municipio,
      'percentual_reducao_cbs', v_grupo.percentual_reducao_cbs,
      'ibscbs_manual', v_grupo.ibscbs_manual
    )
  );

  if new.cfop is null and v_cfop is not null then
    new.cfop := v_cfop;
  end if;

  if new.icms_cst_csosn is null and v_grupo.icms_cst_csosn is not null then
    new.icms_cst_csosn := v_grupo.icms_cst_csosn;
  end if;

  if new.pis_cst is null and v_grupo.pis_cst is not null then
    new.pis_cst := v_grupo.pis_cst;
  end if;

  if new.cofins_cst is null and v_grupo.cofins_cst is not null then
    new.cofins_cst := v_grupo.cofins_cst;
  end if;

  update public.vendas as v
  set snapshot_fiscal = coalesce(v.snapshot_fiscal, '{}'::jsonb)
    || jsonb_build_object(
      'tributacao_itens',
      jsonb_build_object(
        'versao', 1,
        'origem', v_origem,
        'congelado_em', pg_catalog.now()
      )
    )
  where v.id = new.venda_id
    and v.empresa_id = new.empresa_id;

  return new;
end;
$function$;

drop trigger if exists trg_vendas_itens_congelar_snapshot_tributario
  on public.vendas_itens;

create trigger trg_vendas_itens_congelar_snapshot_tributario
before insert on public.vendas_itens
for each row
execute function public.vendas_itens_congelar_snapshot_tributario();

comment on function public.vendas_itens_congelar_snapshot_tributario() is
  'Congela NCM/CFOP/CST/alíquotas do grupo e do produto da MESMA empresa no INSERT de vendas_itens. Não sobrescreve snapshot completo. Sem backfill.';

notify pgrst, 'reload schema';

commit;
