-- Editor NF-e 55 comum: transporte/infos na devolução e itens de outras
-- entradas do MESMO fornecedor/empresa. Estoque continua só na RPC de saída.

alter table public.fiscal_devolucoes_fornecedor
  add column if not exists dados_transporte jsonb not null default '{}'::jsonb;

alter table public.fiscal_devolucoes_fornecedor
  add column if not exists informacao_complementar_usuario text;

alter table public.fiscal_devolucoes_fornecedor
  add column if not exists informacao_adicional_fisco text;

comment on column public.fiscal_devolucoes_fornecedor.dados_transporte is
  'Snapshot de transporte/volumes da NF-e 55. Não movimenta estoque.';

comment on column public.fiscal_devolucoes_fornecedor.informacao_complementar_usuario is
  'Texto complementar informado pelo usuário. Não substitui textos fiscais automáticos.';

create or replace function public.fiscal_dev_forn_assert_item_mesmo_fornecedor()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
  v_cnpj_cabecalho text;
  v_cnpj_item text;
  v_status_entrada text;
  v_entrada_item uuid;
begin
  select d.empresa_id, e.cnpj_emitente
    into v_empresa, v_cnpj_cabecalho
  from public.fiscal_devolucoes_fornecedor d
  join public.fiscal_documentos_entrada e
    on e.id = d.documento_entrada_id
   and e.empresa_id = d.empresa_id
  where d.id = new.devolucao_id;

  if v_empresa is distinct from new.empresa_id then
    raise exception 'O item da devolução deve pertencer à mesma empresa do cabeçalho.';
  end if;

  select i.documento_entrada_id
    into v_entrada_item
  from public.fiscal_documentos_entrada_itens i
  where i.id = new.documento_entrada_item_id
    and i.empresa_id = new.empresa_id;

  if v_entrada_item is null then
    raise exception 'O item original da NF-e não pertence à empresa da devolução.';
  end if;

  select e.cnpj_emitente, e.status, e.empresa_id
    into v_cnpj_item, v_status_entrada, v_empresa
  from public.fiscal_documentos_entrada e
  where e.id = v_entrada_item
    and e.empresa_id = new.empresa_id;

  if v_empresa is distinct from new.empresa_id then
    raise exception 'A NF-e de entrada do item não pertence à empresa da devolução.';
  end if;

  if v_status_entrada is distinct from 'entrada_concluida' then
    raise exception 'Só é possível devolver itens de uma NF-e de entrada já processada.';
  end if;

  if v_cnpj_item is distinct from v_cnpj_cabecalho then
    raise exception 'Não é possível adicionar itens de outro fornecedor nesta devolução. Crie uma devolução separada para esse fornecedor.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_dev_forn_itens_mesmo_fornecedor
  on public.fiscal_devolucoes_fornecedor_itens;

create trigger trg_fiscal_dev_forn_itens_mesmo_fornecedor
before insert or update of empresa_id, devolucao_id, documento_entrada_item_id
on public.fiscal_devolucoes_fornecedor_itens
for each row
execute function public.fiscal_dev_forn_assert_item_mesmo_fornecedor();
