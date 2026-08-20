begin;

-- Notas que já efetivaram estoque não podem ficar em
-- "pronta_para_entrada". Reconcilia pelo movimento ou pelo
-- snapshot quantidade_entrada_efetivada.

update public.fiscal_documentos_entrada as d
set
  status = 'entrada_concluida',
  data_entrada = coalesce(d.data_entrada, now()),
  entrada_estoque_processada_at = coalesce(
    d.entrada_estoque_processada_at,
    now()
  )
where d.status is distinct from 'entrada_concluida'
  and d.status is distinct from 'cancelada'
  and (
    exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = d.empresa_id
        and em.documento_entrada_id = d.id
    )
    or exists (
      select 1
      from public.fiscal_documentos_entrada_itens i
      where i.empresa_id = d.empresa_id
        and i.documento_entrada_id = d.id
        and coalesce(i.quantidade_entrada_efetivada, 0) > 0
    )
  );

create or replace function public.rpc_reconciliar_status_entrada(
  p_empresa_id uuid,
  p_documento_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_status text;
  v_efetivada boolean;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if not public.tem_acesso_empresa(p_empresa_id) then
    raise exception 'Usuário sem acesso à empresa.';
  end if;

  select d.status
    into v_status
  from public.fiscal_documentos_entrada d
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Documento de entrada não encontrado nesta empresa.';
  end if;

  if v_status in ('entrada_concluida', 'cancelada') then
    return v_status;
  end if;

  v_efetivada := exists (
    select 1
    from public.estoque_movimentacoes em
    where em.empresa_id = p_empresa_id
      and em.documento_entrada_id = p_documento_id
  ) or exists (
    select 1
    from public.fiscal_documentos_entrada_itens i
    where i.empresa_id = p_empresa_id
      and i.documento_entrada_id = p_documento_id
      and coalesce(i.quantidade_entrada_efetivada, 0) > 0
  );

  if not v_efetivada then
    return v_status;
  end if;

  update public.fiscal_documentos_entrada as d
  set
    status = 'entrada_concluida',
    data_entrada = coalesce(d.data_entrada, now()),
    entrada_estoque_processada_at = coalesce(
      d.entrada_estoque_processada_at,
      now()
    )
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id;

  return 'entrada_concluida';
end;
$$;

grant execute on function public.rpc_reconciliar_status_entrada(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
