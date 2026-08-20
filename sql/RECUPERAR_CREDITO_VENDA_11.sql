begin;

do $$
declare
  v_venda record;
  v_pag record;
  v_credito_id uuid;
  v_valor numeric(14,2);
begin
  select
    v.id,
    v.empresa_id,
    v.cliente_id,
    v.numero,
    v.valor_total,
    v.troco,
    v.status
  into v_venda
  from public.vendas v
  where v.id = '99c5899e-b66d-4dec-b527-88e3813388fd'::uuid
  for update;

  if not found then
    raise exception 'Venda #11 não encontrada.';
  end if;

  if v_venda.numero <> 11 then
    raise exception 'A venda encontrada não é a venda nº 11.';
  end if;

  if v_venda.status <> 'cancelada' then
    raise exception 'A venda #11 não está cancelada.';
  end if;

  if v_venda.cliente_id is null then
    raise exception 'A venda #11 não possui cliente identificado.';
  end if;

  select
    vp.id,
    vp.valor,
    fp.nome,
    fp.tipo,
    fp.movimenta_caixa,
    fp.permite_fiado
  into v_pag
  from public.vendas_pagamentos vp
  join public.formas_pagamento fp
    on fp.empresa_id = vp.empresa_id
   and fp.id = vp.forma_pagamento_id
  where vp.empresa_id = v_venda.empresa_id
    and vp.venda_id = v_venda.id
    and upper(coalesce(fp.tipo, '')) = 'DINHEIRO'
  order by vp.id
  limit 1;

  if not found then
    raise exception 'Pagamento em Dinheiro da venda #11 não encontrado.';
  end if;

  if not coalesce(v_pag.movimenta_caixa, false)
     or coalesce(v_pag.permite_fiado, false) then
    raise exception 'Forma Dinheiro está com configuração incompatível.';
  end if;

  v_valor :=
    greatest(
      round(
        coalesce(v_pag.valor, 0)
        - coalesce(v_venda.troco, 0),
        2
      ),
      0
    );

  if v_valor <> 3.00 then
    raise exception
      'Valor líquido esperado para a venda #11 é R$ 3,00, mas foi encontrado R$ %.',
      to_char(v_valor, 'FM999999990D00');
  end if;

  select c.id
  into v_credito_id
  from public.carteira_cliente_creditos c
  where c.empresa_id = v_venda.empresa_id
    and c.venda_id = v_venda.id
    and c.origem = 'CANCELAMENTO_VENDA'
  for update;

  if v_credito_id is null then
    insert into public.carteira_cliente_creditos (
      empresa_id,
      cliente_id,
      origem,
      venda_id,
      recebimento_id,
      valor_original,
      valor_disponivel,
      status,
      observacao
    )
    values (
      v_venda.empresa_id,
      v_venda.cliente_id,
      'CANCELAMENTO_VENDA',
      v_venda.id,
      null,
      v_valor,
      v_valor,
      'DISPONIVEL',
      'Recuperação do crédito não gerado no cancelamento da venda nº 11.'
    )
    returning id
    into v_credito_id;

    insert into public.carteira_cliente_movimentacoes (
      empresa_id,
      cliente_id,
      usuario_id,
      tipo,
      origem,
      valor,
      venda_id,
      titulo_id,
      recebimento_id,
      descricao
    )
    values (
      v_venda.empresa_id,
      v_venda.cliente_id,
      null,
      'CREDITO',
      'CREDITO_CANCELAMENTO_VENDA',
      v_valor,
      v_venda.id,
      null,
      null,
      'Crédito recuperado do cancelamento da venda nº 11.'
    );
  end if;

  -- Registra a origem do valor cancelado para auditoria, sem duplicar.
  insert into public.carteira_cliente_recebimento_estornos (
    empresa_id,
    cliente_id,
    recebimento_id,
    alocacao_id,
    venda_id,
    titulo_id,
    usuario_id,
    valor,
    destino,
    status,
    credito_id,
    motivo,
    concluido_at,
    venda_pagamento_id,
    origem
  )
  select
    v_venda.empresa_id,
    v_venda.cliente_id,
    null,
    null,
    v_venda.id,
    null,
    null,
    v_valor,
    'CREDITO',
    'CONVERTIDO_CREDITO',
    v_credito_id,
    'Recuperação do crédito da venda nº 11.',
    now(),
    v_pag.id,
    'PAGAMENTO_VENDA'
  where not exists (
    select 1
    from public.carteira_cliente_recebimento_estornos e
    where e.empresa_id = v_venda.empresa_id
      and e.venda_pagamento_id = v_pag.id
  );
end;
$$;

commit;
