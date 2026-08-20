begin;

-- ============================================================
-- UltraPDV — edição completa de venda pelo próprio PDV
--
-- Mantém o MESMO venda_id e o MESMO número comercial.
-- Reverte o estoque antigo e aplica o novo dentro da mesma
-- transação. Pagamentos confirmados antigos ficam cancelados e
-- um novo conjunto confirmado é inserido.
--
-- Segurança:
-- - bloqueia documento fiscal autorizado/ambíguo;
-- - bloqueia venda que já possui histórico FIADO/Carteira;
-- - preço de item existente vem do snapshot original da venda;
-- - produto novo usa produtos.preco_venda do banco;
-- - frontend nunca define preço.
-- ============================================================

create or replace function public.rpc_editar_venda_pdv(
  p_empresa_id uuid,
  p_venda_id uuid,
  p_cliente_id uuid default null,
  p_desconto numeric default 0,
  p_troco numeric default 0,
  p_itens jsonb default '[]'::jsonb,
  p_pagamentos jsonb default '[]'::jsonb
)
returns table (
  venda_id uuid,
  numero bigint,
  valor_produtos numeric,
  desconto numeric,
  acrescimo numeric,
  frete numeric,
  valor_total numeric,
  troco numeric,
  status text
)
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_usuario_id uuid;
  v_venda public.vendas%rowtype;

  v_item jsonb;
  v_pagamento jsonb;
  v_resolvidos jsonb := '[]'::jsonb;

  v_produto record;
  v_item_antigo record;
  v_item_resolvido jsonb;

  v_produto_id uuid;
  v_venda_item_id uuid;
  v_qtd numeric;
  v_valor_unitario numeric;
  v_desconto_item numeric;
  v_acrescimo_item numeric;
  v_total_item numeric;

  v_valor_produtos numeric := 0;
  v_desconto_itens numeric := 0;
  v_acrescimo_itens numeric := 0;
  v_desconto_total numeric := 0;
  v_total_venda numeric := 0;

  v_forma record;
  v_forma_id uuid;
  v_valor_pagamento numeric;
  v_total_pagamentos numeric := 0;
  v_parcelas integer;
  v_indicador text;
  v_tem_troco boolean := false;
  v_tem_fiado boolean := false;

  v_estoque record;
  v_saldo_anterior numeric;
  v_saldo_posterior numeric;
  v_mov record;
begin
  v_usuario_id := auth.uid();

  if v_usuario_id is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if not exists (
    select 1
    from public.usuarios u
    where u.id = v_usuario_id
      and u.ativo = true
  ) then
    raise exception 'Usuário ativo não encontrado.';
  end if;

  if not exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = v_usuario_id
      and ue.empresa_id = p_empresa_id
      and ue.ativo = true
  ) then
    raise exception 'Usuário não possui acesso à empresa informada.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_empresa_id::text),
    hashtext(p_venda_id::text)
  );

  select v.*
  into v_venda
  from public.vendas v
  where v.empresa_id = p_empresa_id
    and v.id = p_venda_id
  for update;

  if not found then
    raise exception 'Venda não encontrada.';
  end if;

  if v_venda.status <> 'finalizada' then
    raise exception 'Somente venda finalizada pode ser editada.';
  end if;

  if exists (
    select 1
    from public.fiscal_emissoes fe
    where fe.empresa_id = p_empresa_id
      and fe.origem_tipo = 'venda'
      and fe.origem_id = p_venda_id
      and fe.status in (
        'autorizada',
        'enviando',
        'erro_comunicacao',
        'aguardando_reconciliacao'
      )
  ) then
    raise exception 'Esta venda possui documento fiscal autorizado ou em estado sensível. Cancele/reconcilie o documento fiscal antes de editar.';
  end if;

  -- Conservador por integridade: uma venda que já entrou na Carteira
  -- pode ter baixa/alocação imutável. O cancelamento comercial já possui
  -- o fluxo correto para esse cenário.
  if exists (
    select 1
    from public.carteira_cliente_titulos ct
    where ct.empresa_id = p_empresa_id
      and ct.venda_id = p_venda_id
  ) then
    raise exception 'Venda com histórico FIADO/Carteira não pode ser editada diretamente. Cancele a venda e refaça o lançamento.';
  end if;

  if p_cliente_id is not null
     and not exists (
       select 1
       from public.clientes c
       where c.empresa_id = p_empresa_id
         and c.id = p_cliente_id
         and c.ativo = true
     ) then
    raise exception 'Cliente não encontrado, inativo ou pertence a outra empresa.';
  end if;

  if coalesce(p_desconto, 0) < 0 then
    raise exception 'Desconto não pode ser negativo.';
  end if;

  if coalesce(p_troco, 0) < 0 then
    raise exception 'Troco não pode ser negativo.';
  end if;

  if coalesce(jsonb_typeof(p_itens), '') <> 'array'
     or jsonb_array_length(p_itens) = 0 then
    raise exception 'A venda deve possuir ao menos um item.';
  end if;

  if coalesce(jsonb_typeof(p_pagamentos), '') <> 'array'
     or jsonb_array_length(p_pagamentos) = 0 then
    raise exception 'A venda deve possuir ao menos um pagamento.';
  end if;

  -- ----------------------------------------------------------
  -- Resolve itens SEM confiar em preço vindo do navegador.
  -- Item original: mantém preço/desconto/acréscimo do snapshot.
  -- Item novo: usa preço atual do produto.
  -- ----------------------------------------------------------
  for v_item in
    select value
    from jsonb_array_elements(p_itens)
  loop
    begin
      v_produto_id := (v_item ->> 'produto_id')::uuid;
      v_qtd := (v_item ->> 'quantidade')::numeric;
      v_venda_item_id := nullif(v_item ->> 'venda_item_id', '')::uuid;
    exception
      when others then
        raise exception 'Item inválido na edição da venda.';
    end;

    if v_qtd is null or v_qtd <= 0 then
      raise exception 'Quantidade deve ser maior que zero.';
    end if;

    select
      p.id,
      p.codigo,
      p.nome,
      p.unidade_medida,
      p.preco_venda,
      p.grupo_fiscal_id,
      pf.ncm,
      pf.cest,
      pf.origem_produto
    into v_produto
    from public.produtos p
    left join public.produtos_fiscal pf
      on pf.empresa_id = p_empresa_id
     and pf.produto_id = p.id
    where p.empresa_id = p_empresa_id
      and p.id = v_produto_id
      and p.ativo = true;

    if not found then
      raise exception 'Produto não encontrado, inativo ou pertence a outra empresa: %.', v_produto_id;
    end if;

    v_desconto_item := 0;
    v_acrescimo_item := 0;

    if v_venda_item_id is not null then
      select vi.*
      into v_item_antigo
      from public.vendas_itens vi
      where vi.empresa_id = p_empresa_id
        and vi.venda_id = p_venda_id
        and vi.id = v_venda_item_id
        and vi.produto_id = v_produto_id;

      if not found then
        raise exception 'Um item original informado não pertence a esta venda.';
      end if;

      v_valor_unitario := v_item_antigo.valor_unitario;
      v_desconto_item := coalesce(v_item_antigo.desconto, 0);
      v_acrescimo_item := coalesce(v_item_antigo.acrescimo, 0);
    else
      v_valor_unitario := coalesce(v_produto.preco_venda, 0);
    end if;

    if v_valor_unitario < 0 then
      raise exception 'Preço inválido para o produto %.', v_produto.nome;
    end if;

    v_total_item := round(
      (v_qtd * v_valor_unitario)
      - v_desconto_item
      + v_acrescimo_item,
      2
    );

    if v_total_item < 0 then
      raise exception 'Total inválido para o produto %.', v_produto.nome;
    end if;

    v_valor_produtos :=
      v_valor_produtos +
      round(v_qtd * v_valor_unitario, 2);

    v_desconto_itens :=
      v_desconto_itens + v_desconto_item;

    v_acrescimo_itens :=
      v_acrescimo_itens + v_acrescimo_item;

    v_resolvidos := v_resolvidos || jsonb_build_array(
      jsonb_build_object(
        'produto_id', v_produto.id,
        'produto_codigo', v_produto.codigo,
        'produto_nome', v_produto.nome,
        'unidade_medida', v_produto.unidade_medida,
        'quantidade', v_qtd,
        'valor_unitario', v_valor_unitario,
        'desconto', v_desconto_item,
        'acrescimo', v_acrescimo_item,
        'valor_total', v_total_item,
        'grupo_fiscal_id', v_produto.grupo_fiscal_id,
        'ncm', v_produto.ncm,
        'cest', v_produto.cest,
        'origem_produto', v_produto.origem_produto
      )
    );
  end loop;

  v_desconto_total := round(
    v_desconto_itens + coalesce(p_desconto, 0),
    2
  );

  v_total_venda := round(
    v_valor_produtos
    - v_desconto_total
    + v_acrescimo_itens
    + coalesce(v_venda.frete, 0)
    + greatest(
        coalesce(v_venda.acrescimo, 0) - v_acrescimo_itens,
        0
      ),
    2
  );

  if v_total_venda <= 0 then
    raise exception 'O total da venda deve ser maior que zero.';
  end if;

  -- ----------------------------------------------------------
  -- Valida pagamentos antes de tocar em estoque/itens.
  -- ----------------------------------------------------------
  for v_pagamento in
    select value
    from jsonb_array_elements(p_pagamentos)
  loop
    begin
      v_forma_id := (v_pagamento ->> 'forma_pagamento_id')::uuid;
      v_valor_pagamento := (v_pagamento ->> 'valor')::numeric;
      v_parcelas := coalesce(nullif(v_pagamento ->> 'quantidade_parcelas', '')::integer, 1);
      v_indicador := coalesce(nullif(btrim(v_pagamento ->> 'indicador_pagamento'), ''), '0');
    exception
      when others then
        raise exception 'Pagamento inválido na edição da venda.';
    end;

    select fp.*
    into v_forma
    from public.formas_pagamento fp
    where fp.empresa_id = p_empresa_id
      and fp.id = v_forma_id
      and fp.ativo = true;

    if not found then
      raise exception 'Forma de pagamento não encontrada ou inativa.';
    end if;

    if v_valor_pagamento is null or v_valor_pagamento <= 0 then
      raise exception 'Valor do pagamento deve ser maior que zero.';
    end if;

    if v_parcelas < 1 then
      raise exception 'Quantidade de parcelas inválida.';
    end if;

    if v_parcelas > 1 and not v_forma.permite_parcelamento then
      raise exception 'A forma de pagamento % não permite parcelamento.', v_forma.nome;
    end if;

    if v_indicador not in ('0', '1') then
      raise exception 'Indicador de pagamento inválido.';
    end if;

    if v_forma.permite_fiado then
      v_tem_fiado := true;
      if p_cliente_id is null then
        raise exception 'Pagamento fiado exige cliente.';
      end if;
    end if;

    if v_forma.permite_troco then
      v_tem_troco := true;
    end if;

    v_total_pagamentos := v_total_pagamentos + v_valor_pagamento;
  end loop;

  if coalesce(p_troco, 0) > 0 and not v_tem_troco then
    raise exception 'Foi informado troco, mas nenhuma forma selecionada permite troco.';
  end if;

  if abs(
    v_total_pagamentos -
    (v_total_venda + coalesce(p_troco, 0))
  ) > 0.01 then
    raise exception 'Pagamentos não conferem. Total da venda: %, troco: %, informado: %.',
      v_total_venda,
      coalesce(p_troco, 0),
      v_total_pagamentos;
  end if;

  -- ----------------------------------------------------------
  -- Reverte estoque da composição ANTIGA.
  -- ----------------------------------------------------------
  for v_mov in
    select
      vi.produto_id,
      sum(vi.quantidade)::numeric as quantidade
    from public.vendas_itens vi
    where vi.empresa_id = p_empresa_id
      and vi.venda_id = p_venda_id
    group by vi.produto_id
    order by vi.produto_id
  loop
    select ea.*
    into v_estoque
    from public.estoque_atual ea
    where ea.empresa_id = p_empresa_id
      and ea.produto_id = v_mov.produto_id
    for update;

    if not found then
      raise exception 'Estoque atual não encontrado para um produto da venda.';
    end if;

    v_saldo_anterior := coalesce(v_estoque.quantidade, 0);
    v_saldo_posterior := v_saldo_anterior + v_mov.quantidade;

    update public.estoque_atual
    set
      quantidade = v_saldo_posterior,
      updated_at = now()
    where id = v_estoque.id;

    insert into public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      venda_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao
    ) values (
      p_empresa_id,
      v_mov.produto_id,
      p_venda_id,
      v_usuario_id,
      'AJUSTE_POSITIVO',
      'EDICAO_VENDA',
      v_mov.quantidade,
      v_saldo_anterior,
      v_saldo_posterior,
      concat('Estorno técnico dos itens antes da edição da venda nº ', coalesce(v_venda.numero::text, p_venda_id::text), '.')
    );
  end loop;

  -- Pagamentos antigos ficam preservados como histórico, mas não ativos.
  update public.vendas_pagamentos
  set status = 'cancelado'
  where empresa_id = p_empresa_id
    and venda_id = p_venda_id
    and status = 'confirmado';

  -- Sem Carteira, os itens antigos podem ser removidos com segurança.
  delete from public.vendas_itens
  where empresa_id = p_empresa_id
    and venda_id = p_venda_id;

  -- ----------------------------------------------------------
  -- Insere nova composição + baixa novo estoque.
  -- ----------------------------------------------------------
  for v_item_resolvido in
    select value
    from jsonb_array_elements(v_resolvidos)
  loop
    insert into public.vendas_itens (
      empresa_id,
      venda_id,
      produto_id,
      produto_codigo,
      produto_nome,
      unidade_medida,
      quantidade,
      valor_unitario,
      desconto,
      acrescimo,
      valor_total,
      grupo_fiscal_id,
      ncm,
      cest,
      origem_produto
    ) values (
      p_empresa_id,
      p_venda_id,
      (v_item_resolvido ->> 'produto_id')::uuid,
      v_item_resolvido ->> 'produto_codigo',
      v_item_resolvido ->> 'produto_nome',
      coalesce(nullif(v_item_resolvido ->> 'unidade_medida', ''), 'UN'),
      (v_item_resolvido ->> 'quantidade')::numeric,
      (v_item_resolvido ->> 'valor_unitario')::numeric,
      (v_item_resolvido ->> 'desconto')::numeric,
      (v_item_resolvido ->> 'acrescimo')::numeric,
      (v_item_resolvido ->> 'valor_total')::numeric,
      nullif(v_item_resolvido ->> 'grupo_fiscal_id', '')::uuid,
      nullif(v_item_resolvido ->> 'ncm', ''),
      nullif(v_item_resolvido ->> 'cest', ''),
      nullif(v_item_resolvido ->> 'origem_produto', '')
    );

    v_produto_id := (v_item_resolvido ->> 'produto_id')::uuid;
    v_qtd := (v_item_resolvido ->> 'quantidade')::numeric;

    select ea.*
    into v_estoque
    from public.estoque_atual ea
    where ea.empresa_id = p_empresa_id
      and ea.produto_id = v_produto_id
    for update;

    if not found then
      raise exception 'Estoque atual não encontrado para o produto %.', v_produto_id;
    end if;

    v_saldo_anterior := coalesce(v_estoque.quantidade, 0);

    if v_saldo_anterior < v_qtd then
      raise exception 'Estoque insuficiente para o produto %. Disponível: %, necessário: %.',
        v_item_resolvido ->> 'produto_nome',
        v_saldo_anterior,
        v_qtd;
    end if;

    v_saldo_posterior := v_saldo_anterior - v_qtd;

    update public.estoque_atual
    set
      quantidade = v_saldo_posterior,
      updated_at = now()
    where id = v_estoque.id;

    insert into public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      venda_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao
    ) values (
      p_empresa_id,
      v_produto_id,
      p_venda_id,
      v_usuario_id,
      'VENDA',
      'EDICAO_VENDA',
      v_qtd,
      v_saldo_anterior,
      v_saldo_posterior,
      concat('Nova composição após edição da venda nº ', coalesce(v_venda.numero::text, p_venda_id::text), '.')
    );
  end loop;

  -- ----------------------------------------------------------
  -- Novo conjunto de pagamentos confirmados.
  -- ----------------------------------------------------------
  for v_pagamento in
    select value
    from jsonb_array_elements(p_pagamentos)
  loop
    v_forma_id := (v_pagamento ->> 'forma_pagamento_id')::uuid;
    v_valor_pagamento := (v_pagamento ->> 'valor')::numeric;
    v_parcelas := coalesce(nullif(v_pagamento ->> 'quantidade_parcelas', '')::integer, 1);
    v_indicador := coalesce(nullif(btrim(v_pagamento ->> 'indicador_pagamento'), ''), '0');

    select fp.*
    into v_forma
    from public.formas_pagamento fp
    where fp.empresa_id = p_empresa_id
      and fp.id = v_forma_id
      and fp.ativo = true;

    insert into public.vendas_pagamentos (
      empresa_id,
      venda_id,
      forma_pagamento_id,
      valor,
      quantidade_parcelas,
      forma_pagamento_codigo,
      forma_pagamento_nome,
      codigo_fiscal,
      indicador_pagamento,
      bandeira,
      autorizacao,
      troco,
      status
    ) values (
      p_empresa_id,
      p_venda_id,
      v_forma.id,
      v_valor_pagamento,
      v_parcelas,
      v_forma.codigo,
      v_forma.nome,
      v_forma.codigo_fiscal,
      v_indicador,
      nullif(v_pagamento ->> 'bandeira', ''),
      nullif(v_pagamento ->> 'autorizacao', ''),
      0,
      'confirmado'
    );
  end loop;

  update public.vendas
  set
    cliente_id = p_cliente_id,
    valor_produtos = round(v_valor_produtos, 2),
    desconto = round(v_desconto_total, 2),
    acrescimo = round(coalesce(v_venda.acrescimo, 0), 2),
    valor_total = round(v_total_venda, 2),
    troco = round(coalesce(p_troco, 0), 2),
    usuario_id = v_usuario_id,
    updated_at = now()
  where empresa_id = p_empresa_id
    and id = p_venda_id;

  -- Se a edição de uma venda originalmente à vista passar a usar FIADO,
  -- cria a Carteira somente depois de toda a nova venda estar consistente.
  if v_tem_fiado then
    perform public.carteira_criar_debito_venda_interno(
      p_empresa_id,
      p_venda_id
    );
  end if;

  return query
  select
    v.id,
    v.numero,
    v.valor_produtos,
    v.desconto,
    v.acrescimo,
    v.frete,
    v.valor_total,
    v.troco,
    v.status
  from public.vendas v
  where v.empresa_id = p_empresa_id
    and v.id = p_venda_id;
end;
$function$;

revoke all
on function public.rpc_editar_venda_pdv(
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  jsonb,
  jsonb
)
from public;

revoke all
on function public.rpc_editar_venda_pdv(
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  jsonb,
  jsonb
)
from anon;

grant execute
on function public.rpc_editar_venda_pdv(
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  jsonb,
  jsonb
)
to authenticated;

notify pgrst, 'reload schema';

commit;
