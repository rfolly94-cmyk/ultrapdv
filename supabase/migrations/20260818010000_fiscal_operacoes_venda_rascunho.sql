begin;

-- Rascunho de NF-e de venda na tela Nova NF-e.
-- A venda comercial só nasce em rpc_finalizar_venda; venda_id é preenchido depois.
-- Não altera o motor comercial nem a emissão Geranet de venda.

alter table public.fiscal_operacoes
  drop constraint if exists fiscal_operacoes_tipo_check;

alter table public.fiscal_operacoes
  add constraint fiscal_operacoes_tipo_check
  check (tipo_operacao_interno in ('bonificacao', 'transferencia', 'venda'));

alter table public.fiscal_operacoes
  add column if not exists venda_id uuid null
    references public.vendas(id)
    on delete restrict;

comment on column public.fiscal_operacoes.venda_id is
  'Venda comercial criada por rpc_finalizar_venda a partir deste rascunho. Nulo enquanto for só rascunho fiscal.';

create unique index if not exists uq_fiscal_operacoes_venda_id
  on public.fiscal_operacoes (empresa_id, venda_id)
  where venda_id is not null;

create or replace function public.fiscal_operacoes_assert_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
  v_tipo text;
  v_ativo boolean;
  v_cliente_empresa uuid;
  v_vinculo public.fiscal_vinculos_transferencia%rowtype;
begin
  if tg_table_name = 'fiscal_operacoes' then
    if new.tipo_operacao_interno not in ('bonificacao', 'transferencia', 'venda') then
      raise exception 'Esta tabela aceita apenas bonificação, transferência ou venda.';
    end if;

    if new.tipo_operacao_interno in ('bonificacao', 'venda') then
      if new.destinatario_tipo is distinct from 'cliente' then
        raise exception 'Esta operação exige destinatário do tipo cliente.';
      end if;
      if new.destinatario_id is not null then
        select c.empresa_id into v_empresa
        from public.clientes c
        where c.id = new.destinatario_id;
        if v_empresa is distinct from new.empresa_id then
          raise exception 'O destinatário não pertence à empresa ativa.';
        end if;
      end if;
    end if;

    if new.tipo_operacao_interno = 'transferencia' then
      if new.destinatario_tipo is distinct from 'estabelecimento' then
        raise exception 'Transferência não aceita cliente comum como destino.';
      end if;
      if new.vinculo_transferencia_id is not null then
        select * into v_vinculo
        from public.fiscal_vinculos_transferencia v
        where v.id = new.vinculo_transferencia_id;
        if not found or v_vinculo.ativo is not true then
          raise exception 'Não foi possível confirmar que o estabelecimento de destino é elegível para transferência.';
        end if;
        if v_vinculo.empresa_origem_id is distinct from new.empresa_id then
          raise exception 'O vínculo de transferência não pertence à empresa de origem.';
        end if;
        if new.destino_empresa_id is distinct from v_vinculo.empresa_destino_id then
          raise exception 'O destino da transferência deve ser o estabelecimento do vínculo.';
        end if;
      end if;
    end if;

    if new.venda_id is not null then
      if new.tipo_operacao_interno is distinct from 'venda' then
        raise exception 'Somente operação de venda pode vincular uma venda comercial.';
      end if;
      select v.empresa_id into v_empresa
      from public.vendas v
      where v.id = new.venda_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'A venda vinculada não pertence à empresa ativa.';
      end if;
    end if;

    if new.natureza_id is not null then
      select n.empresa_id, n.tipo_operacao_interno, n.ativo
        into v_empresa, v_tipo, v_ativo
      from public.fiscal_naturezas_operacao n
      where n.id = new.natureza_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'A natureza de operação não pertence à empresa da operação fiscal.';
      end if;
      if v_tipo is distinct from new.tipo_operacao_interno then
        raise exception 'A natureza selecionada não pertence a esta operação.';
      end if;
      if v_ativo is not true then
        raise exception 'A natureza de operação precisa estar ativa.';
      end if;
    end if;
  end if;

  if tg_table_name = 'fiscal_operacoes_itens' then
    select o.empresa_id into v_empresa
    from public.fiscal_operacoes o
    where o.id = new.operacao_id;
    if v_empresa is distinct from new.empresa_id then
      raise exception 'O item deve pertencer à mesma empresa da operação fiscal.';
    end if;

    select p.empresa_id into v_empresa
    from public.produtos p
    where p.id = new.produto_id;
    if v_empresa is distinct from new.empresa_id then
      raise exception 'O produto não pertence à empresa da operação fiscal.';
    end if;

    if new.grupo_fiscal_id is not null then
      select g.empresa_id into v_empresa
      from public.grupos_fiscais g
      where g.id = new.grupo_fiscal_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'O grupo fiscal do item não pertence à empresa da operação.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_operacoes_mesma_empresa
  on public.fiscal_operacoes;
create trigger trg_fiscal_operacoes_mesma_empresa
before insert or update of empresa_id, tipo_operacao_interno, natureza_id,
  destinatario_tipo, destinatario_id, destino_empresa_id, vinculo_transferencia_id,
  venda_id
on public.fiscal_operacoes
for each row
execute function public.fiscal_operacoes_assert_mesma_empresa();

commit;
