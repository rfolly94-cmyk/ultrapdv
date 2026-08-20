begin;

-- ============================================================
-- UltraPDV
-- Cancelamento de venda com cliente identificado:
-- pagamento imediato + fiado recebido -> DEVOLUCAO ou CREDITO
--
-- Depende da migration 20260813170000.
-- ============================================================

do $$
begin
  if to_regclass('public.carteira_cliente_creditos') is null
     or to_regclass('public.carteira_cliente_recebimento_estornos') is null then
    raise exception
      'A migration 20260813170000_carteira_creditos_cancelamento_pago.sql precisa estar aplicada antes desta.';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Generaliza o registro de estorno:
-- antes ele representava apenas recebimento da carteira/fiado;
-- agora também pode representar pagamento imediato da venda.
-- ------------------------------------------------------------
alter table public.carteira_cliente_recebimento_estornos
  alter column recebimento_id drop not null,
  alter column alocacao_id drop not null,
  alter column titulo_id drop not null;

alter table public.carteira_cliente_recebimento_estornos
  add column if not exists venda_pagamento_id uuid null,
  add column if not exists origem text not null default 'RECEBIMENTO_FIADO';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'carteira_receb_estornos_venda_pagamento_empresa_fkey'
      and conrelid = 'public.carteira_cliente_recebimento_estornos'::regclass
  ) then
    alter table public.carteira_cliente_recebimento_estornos
      add constraint carteira_receb_estornos_venda_pagamento_empresa_fkey
      foreign key (empresa_id, venda_pagamento_id)
      references public.vendas_pagamentos(empresa_id, id)
      on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'carteira_receb_estornos_origem_check'
      and conrelid = 'public.carteira_cliente_recebimento_estornos'::regclass
  ) then
    alter table public.carteira_cliente_recebimento_estornos
      add constraint carteira_receb_estornos_origem_check
      check (
        origem in (
          'RECEBIMENTO_FIADO',
          'PAGAMENTO_VENDA'
        )
      );
  end if;
end;
$$;

create unique index if not exists
  uq_carteira_receb_estornos_venda_pagamento
on public.carteira_cliente_recebimento_estornos (
  empresa_id,
  venda_pagamento_id
)
where venda_pagamento_id is not null;

-- ------------------------------------------------------------
-- Motor corrigido
-- ------------------------------------------------------------
create or replace function public.rpc_cancelar_venda_comercial(
  p_empresa_id uuid,
  p_usuario_id uuid,
  p_venda_id uuid,
  p_motivo text,
  p_destino_recebido text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_venda public.vendas%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_destino text :=
    nullif(
      upper(
        btrim(
          coalesce(
            p_destino_recebido,
            ''
          )
        )
      ),
      ''
    );

  -- Estoque
  v_mov record;
  v_estoque record;
  v_saldo_anterior numeric;
  v_saldo_posterior numeric;
  v_qtd_movimentos integer := 0;
  v_qtd_estoque_estornada numeric := 0;

  -- Pagamento imediato
  v_pag record;
  v_pagamento_liquido numeric(14,2);
  v_pagamento_imediato_bruto numeric(14,2) := 0;
  v_pagamento_imediato_liquido numeric(14,2) := 0;
  v_troco_restante numeric(14,2) := 0;

  -- Carteira / fiado
  v_titulo record;
  v_titulos_qtd integer := 0;
  v_recebido_fiado numeric(14,2) := 0;
  v_valor_aberto_cancelado numeric(14,2) := 0;
  v_aloc record;

  -- Destino do dinheiro já recebido
  v_total_pago_cliente numeric(14,2) := 0;
  v_credito_id uuid;
  v_credito_gerado numeric(14,2) := 0;
  v_devolucao_registrada numeric(14,2) := 0;

  -- Resumo cliente
  v_saldo_cliente_anterior numeric(14,2) := 0;
  v_saldo_cliente_atual numeric(14,2) := 0;
  v_credito_cliente_atual numeric(14,2) := 0;

  -- Comercial
  v_pagamentos_cancelados integer := 0;
begin
  if p_empresa_id is null
     or p_usuario_id is null
     or p_venda_id is null then
    raise exception
      'Empresa, usuário e venda são obrigatórios.';
  end if;

  if v_motivo is null
     or length(v_motivo) < 5 then
    raise exception
      'Informe o motivo do cancelamento com pelo menos 5 caracteres.';
  end if;

  if v_destino is not null
     and v_destino not in ('DEVOLUCAO', 'CREDITO') then
    raise exception
      'Destino do valor recebido inválido.';
  end if;

  if not exists (
    select 1
    from public.usuarios u
    where u.id = p_usuario_id
      and u.ativo = true
  ) then
    raise exception
      'Usuário interno não encontrado ou inativo.';
  end if;

  if not exists (
    select 1
    from public.usuarios_empresas ue
    where ue.usuario_id = p_usuario_id
      and ue.empresa_id = p_empresa_id
      and ue.ativo = true
  ) then
    raise exception
      'Usuário não possui vínculo ativo com a empresa.';
  end if;

  select v.*
  into v_venda
  from public.vendas v
  where v.empresa_id = p_empresa_id
    and v.id = p_venda_id
  for update;

  if not found then
    raise exception
      'Venda não encontrada.';
  end if;

  if v_venda.status = 'cancelada' then
    return jsonb_build_object(
      'ok', true,
      'venda_id', v_venda.id,
      'numero', v_venda.numero,
      'status', 'cancelada',
      'reutilizada', true,
      'mensagem', 'A venda já estava cancelada.'
    );
  end if;

  if v_venda.status <> 'finalizada' then
    raise exception
      'Somente venda finalizada pode ser cancelada.';
  end if;

  -- Documento fiscal autorizado/ambíguo precisa ser resolvido antes.
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
    raise exception
      'A venda possui documento fiscal autorizado ou em estado fiscal pendente/ambíguo. Resolva o fiscal antes do cancelamento comercial.';
  end if;

  if exists (
    select 1
    from public.estoque_movimentacoes em
    where em.empresa_id = p_empresa_id
      and em.venda_id = p_venda_id
      and em.tipo = 'CANCELAMENTO_VENDA'
  ) then
    raise exception
      'Já existe movimento de cancelamento de estoque para esta venda, mas a venda ainda não está cancelada. Revise a consistência.';
  end if;

  -- ==========================================================
  -- 1. Quanto foi pago imediatamente?
  --
  -- Só considera formas que efetivamente representam pagamento
  -- imediato (movimenta_caixa=true) e exclui FIADO.
  -- O troco fica em vendas.troco, então é retirado da soma.
  -- ==========================================================
  if v_venda.cliente_id is not null then
    select
      coalesce(
        sum(vp.valor),
        0
      )::numeric(14,2)
    into v_pagamento_imediato_bruto
    from public.vendas_pagamentos vp
    join public.formas_pagamento fp
      on fp.empresa_id = vp.empresa_id
     and fp.id = vp.forma_pagamento_id
    where vp.empresa_id = p_empresa_id
      and vp.venda_id = p_venda_id
      and vp.status = 'confirmado'
      and fp.permite_fiado = false
      and fp.movimenta_caixa = true;

    v_pagamento_imediato_liquido :=
      greatest(
        v_pagamento_imediato_bruto
        - coalesce(v_venda.troco, 0),
        0
      );
  end if;

  -- ==========================================================
  -- 2. Quanto do FIADO dessa venda já foi recebido?
  -- ==========================================================
  select count(*)
  into v_titulos_qtd
  from public.carteira_cliente_titulos t
  where t.empresa_id = p_empresa_id
    and t.venda_id = p_venda_id;

  if v_titulos_qtd > 1 then
    raise exception
      'Foram encontrados múltiplos títulos de carteira para a mesma venda. Cancelamento bloqueado para revisão.';
  end if;

  if v_titulos_qtd = 1 then
    select
      t.id,
      t.cliente_id,
      t.valor_original,
      t.valor_aberto,
      t.status
    into v_titulo
    from public.carteira_cliente_titulos t
    where t.empresa_id = p_empresa_id
      and t.venda_id = p_venda_id
    for update;

    select
      coalesce(
        sum(a.valor),
        0
      )::numeric(14,2)
    into v_recebido_fiado
    from public.carteira_cliente_recebimento_alocacoes a
    join public.carteira_cliente_itens ci
      on ci.empresa_id = a.empresa_id
     and ci.id = a.item_id
    where a.empresa_id = p_empresa_id
      and ci.titulo_id = v_titulo.id;

    v_valor_aberto_cancelado :=
      coalesce(
        v_titulo.valor_aberto,
        0
      );
  end if;

  if v_venda.cliente_id is not null then
    v_total_pago_cliente :=
      round(
        v_pagamento_imediato_liquido
        + v_recebido_fiado,
        2
      );
  end if;

  if v_total_pago_cliente > 0
     and v_destino is null then
    raise exception
      'O cliente já pagou R$ % desta venda. Escolha DEVOLUCAO ou CREDITO.',
      to_char(
        v_total_pago_cliente,
        'FM999999990D00'
      );
  end if;

  if v_destino = 'CREDITO'
     and v_venda.cliente_id is null then
    raise exception
      'Não é possível gerar crédito sem cliente identificado na venda.';
  end if;

  -- ==========================================================
  -- 3. Estoque
  -- ==========================================================
  for v_mov in
    select
      em.produto_id,
      sum(em.quantidade)::numeric as quantidade
    from public.estoque_movimentacoes em
    where em.empresa_id = p_empresa_id
      and em.venda_id = p_venda_id
      and em.tipo = 'VENDA'
    group by em.produto_id
    order by em.produto_id
  loop
    if coalesce(v_mov.quantidade, 0) <= 0 then
      raise exception
        'Movimento de estoque inválido encontrado na venda.';
    end if;

    select
      ea.id,
      ea.quantidade
    into v_estoque
    from public.estoque_atual ea
    where ea.empresa_id = p_empresa_id
      and ea.produto_id = v_mov.produto_id
    for update;

    if not found then
      raise exception
        'Estoque atual não encontrado para o produto %.',
        v_mov.produto_id;
    end if;

    v_saldo_anterior :=
      coalesce(v_estoque.quantidade, 0);

    v_saldo_posterior :=
      v_saldo_anterior
      + v_mov.quantidade;

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
    )
    values (
      p_empresa_id,
      v_mov.produto_id,
      p_venda_id,
      p_usuario_id,
      'CANCELAMENTO_VENDA',
      'CANCELAMENTO_VENDA',
      v_mov.quantidade,
      v_saldo_anterior,
      v_saldo_posterior,
      format(
        'Estorno de estoque pelo cancelamento da venda nº %s.',
        coalesce(
          v_venda.numero::text,
          p_venda_id::text
        )
      )
    );

    v_qtd_movimentos :=
      v_qtd_movimentos + 1;

    v_qtd_estoque_estornada :=
      v_qtd_estoque_estornada
      + v_mov.quantidade;
  end loop;

  -- ==========================================================
  -- 4. Se houver valor já pago pelo cliente, cria o destino
  --    antes de registrar cada origem do valor.
  -- ==========================================================
  if v_total_pago_cliente > 0
     and v_destino = 'CREDITO' then

    select c.id
    into v_credito_id
    from public.carteira_cliente_creditos c
    where c.empresa_id = p_empresa_id
      and c.venda_id = p_venda_id
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
        p_empresa_id,
        v_venda.cliente_id,
        'CANCELAMENTO_VENDA',
        p_venda_id,
        null,
        v_total_pago_cliente,
        v_total_pago_cliente,
        'DISPONIVEL',
        concat(
          'Crédito gerado pelo cancelamento da venda nº ',
          coalesce(
            v_venda.numero::text,
            'sem número'
          )
        )
      )
      returning id
      into v_credito_id;
    end if;

    v_credito_gerado :=
      v_total_pago_cliente;

    insert into public.carteira_cliente_movimentacoes (
      empresa_id,
      cliente_id,
      usuario_id,
      tipo,
      origem,
      valor,
      venda_id,
      titulo_id,
      descricao
    )
    values (
      p_empresa_id,
      v_venda.cliente_id,
      p_usuario_id,
      'CREDITO',
      'CREDITO_CANCELAMENTO_VENDA',
      v_total_pago_cliente,
      p_venda_id,
      case
        when v_titulos_qtd = 1
          then v_titulo.id
        else null
      end,
      concat(
        'Crédito ao cliente pelo cancelamento da venda nº ',
        coalesce(
          v_venda.numero::text,
          'sem número'
        )
      )
    );
  end if;

  -- ==========================================================
  -- 5. Registra pagamentos imediatos desta venda
  --
  -- O troco é descontado somente de forma que permita troco.
  -- ==========================================================
  if v_venda.cliente_id is not null
     and v_pagamento_imediato_liquido > 0 then

    v_troco_restante :=
      coalesce(
        v_venda.troco,
        0
      );

    for v_pag in
      select
        vp.id,
        vp.valor,
        fp.permite_troco
      from public.vendas_pagamentos vp
      join public.formas_pagamento fp
        on fp.empresa_id = vp.empresa_id
       and fp.id = vp.forma_pagamento_id
      where vp.empresa_id = p_empresa_id
        and vp.venda_id = p_venda_id
        and vp.status = 'confirmado'
        and fp.permite_fiado = false
        and fp.movimenta_caixa = true
      order by
        case
          when fp.permite_troco
            then 0
          else 1
        end,
        vp.id
    loop
      v_pagamento_liquido :=
        coalesce(v_pag.valor, 0);

      if v_pag.permite_troco
         and v_troco_restante > 0 then
        if v_pagamento_liquido >= v_troco_restante then
          v_pagamento_liquido :=
            v_pagamento_liquido
            - v_troco_restante;

          v_troco_restante := 0;
        else
          v_troco_restante :=
            v_troco_restante
            - v_pagamento_liquido;

          v_pagamento_liquido := 0;
        end if;
      end if;

      if v_pagamento_liquido > 0 then
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
          p_empresa_id,
          v_venda.cliente_id,
          null,
          null,
          p_venda_id,
          case
            when v_titulos_qtd = 1
              then v_titulo.id
            else null
          end,
          p_usuario_id,
          v_pagamento_liquido,
          v_destino,
          case
            when v_destino = 'CREDITO'
              then 'CONVERTIDO_CREDITO'
            else 'PENDENTE'
          end,
          case
            when v_destino = 'CREDITO'
              then v_credito_id
            else null
          end,
          v_motivo,
          case
            when v_destino = 'CREDITO'
              then now()
            else null
          end,
          v_pag.id,
          'PAGAMENTO_VENDA'
        where not exists (
          select 1
          from public.carteira_cliente_recebimento_estornos e
          where e.empresa_id = p_empresa_id
            and e.venda_pagamento_id = v_pag.id
        );
      end if;
    end loop;
  end if;

  -- ==========================================================
  -- 6. Registra as parcelas do FIADO já recebidas
  -- ==========================================================
  if v_titulos_qtd = 1
     and v_recebido_fiado > 0 then
    for v_aloc in
      select
        a.id as alocacao_id,
        a.recebimento_id,
        a.valor
      from public.carteira_cliente_recebimento_alocacoes a
      join public.carteira_cliente_itens ci
        on ci.empresa_id = a.empresa_id
       and ci.id = a.item_id
      where a.empresa_id = p_empresa_id
        and ci.titulo_id = v_titulo.id
      order by a.id
      for update of a
    loop
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
      values (
        p_empresa_id,
        v_titulo.cliente_id,
        v_aloc.recebimento_id,
        v_aloc.alocacao_id,
        p_venda_id,
        v_titulo.id,
        p_usuario_id,
        v_aloc.valor,
        v_destino,
        case
          when v_destino = 'CREDITO'
            then 'CONVERTIDO_CREDITO'
          else 'PENDENTE'
        end,
        case
          when v_destino = 'CREDITO'
            then v_credito_id
          else null
        end,
        v_motivo,
        case
          when v_destino = 'CREDITO'
            then now()
          else null
        end,
        null,
        'RECEBIMENTO_FIADO'
      )
      on conflict (
        empresa_id,
        alocacao_id
      )
      do nothing;
    end loop;
  end if;

  if v_total_pago_cliente > 0
     and v_destino = 'DEVOLUCAO' then
    v_devolucao_registrada :=
      v_total_pago_cliente;

    insert into public.carteira_cliente_movimentacoes (
      empresa_id,
      cliente_id,
      usuario_id,
      tipo,
      origem,
      valor,
      venda_id,
      titulo_id,
      descricao
    )
    values (
      p_empresa_id,
      v_venda.cliente_id,
      p_usuario_id,
      'ESTORNO',
      'DEVOLUCAO_CANCELAMENTO_VENDA',
      v_total_pago_cliente,
      p_venda_id,
      case
        when v_titulos_qtd = 1
          then v_titulo.id
        else null
      end,
      concat(
        'Devolução pendente pelo cancelamento da venda nº ',
        coalesce(
          v_venda.numero::text,
          'sem número'
        )
      )
    );
  end if;

  -- ==========================================================
  -- 7. Cancela somente a dívida ainda aberta do FIADO
  -- ==========================================================
  if v_titulos_qtd = 1 then
    v_saldo_cliente_anterior :=
      public.carteira_recalcular_saldo_cliente_interno(
        p_empresa_id,
        v_titulo.cliente_id
      );

    if v_valor_aberto_cancelado > 0 then
      insert into public.carteira_cliente_movimentacoes (
        empresa_id,
        cliente_id,
        usuario_id,
        tipo,
        origem,
        valor,
        venda_id,
        titulo_id,
        descricao
      )
      values (
        p_empresa_id,
        v_titulo.cliente_id,
        p_usuario_id,
        'ESTORNO',
        'CANCELAMENTO_VENDA',
        v_valor_aberto_cancelado,
        p_venda_id,
        v_titulo.id,
        concat(
          'Estorno do saldo aberto pelo cancelamento da venda nº ',
          coalesce(
            v_venda.numero::text,
            'sem número'
          )
        )
      );
    end if;

    update public.carteira_cliente_itens ci
    set
      valor_aberto = 0,
      status = 'CANCELADO'
    where ci.empresa_id = p_empresa_id
      and ci.titulo_id = v_titulo.id
      and ci.status <> 'CANCELADO';

    update public.carteira_cliente_titulos t
    set
      valor_aberto = 0,
      status = 'CANCELADO'
    where t.empresa_id = p_empresa_id
      and t.id = v_titulo.id;

    v_saldo_cliente_atual :=
      public.carteira_recalcular_saldo_cliente_interno(
        p_empresa_id,
        v_titulo.cliente_id
      );
  elsif v_venda.cliente_id is not null then
    select coalesce(c.saldo_devedor, 0)
    into v_saldo_cliente_atual
    from public.clientes c
    where c.empresa_id = p_empresa_id
      and c.id = v_venda.cliente_id;

    v_saldo_cliente_anterior :=
      v_saldo_cliente_atual;
  end if;

  if v_venda.cliente_id is not null then
    v_credito_cliente_atual :=
      public.carteira_credito_disponivel_cliente_interno(
        p_empresa_id,
        v_venda.cliente_id
      );
  end if;

  -- ==========================================================
  -- 8. Comercial
  -- ==========================================================
  update public.vendas_pagamentos vp
  set
    status = 'cancelado',
    updated_at = now()
  where vp.empresa_id = p_empresa_id
    and vp.venda_id = p_venda_id
    and vp.status = 'confirmado';

  get diagnostics
    v_pagamentos_cancelados = row_count;

  update public.vendas v
  set
    status = 'cancelada',
    cancelada_at = now(),
    cancelada_por = p_usuario_id,
    motivo_cancelamento = v_motivo,
    updated_at = now()
  where v.empresa_id = p_empresa_id
    and v.id = p_venda_id;

  return jsonb_build_object(
    'ok', true,
    'venda_id', p_venda_id,
    'numero', v_venda.numero,
    'status', 'cancelada',
    'cliente_id', v_venda.cliente_id,

    'estoque_quantidade_estornada',
      v_qtd_estoque_estornada,
    'estoque_movimentos_estornados',
      v_qtd_movimentos,

    'pagamento_imediato_liquido',
      v_pagamento_imediato_liquido,
    'fiado_recebido',
      v_recebido_fiado,
    'fiado_saldo_aberto_cancelado',
      v_valor_aberto_cancelado,
    'valor_pago_cliente_tratado',
      v_total_pago_cliente,
    'destino_valor_recebido',
      v_destino,

    'credito_gerado',
      v_credito_gerado,
    'credito_cliente_disponivel',
      v_credito_cliente_atual,

    'devolucao_registrada',
      v_devolucao_registrada,
    'devolucao_status',
      case
        when v_devolucao_registrada > 0
          then 'PENDENTE'
        else null
      end,

    'saldo_cliente_anterior',
      v_saldo_cliente_anterior,
    'saldo_cliente_atual',
      v_saldo_cliente_atual,

    'pagamentos_cancelados',
      v_pagamentos_cancelados,
    'motivo',
      v_motivo
  );
end;
$function$;

-- Mantém compatibilidade com chamadas antigas.
create or replace function public.rpc_cancelar_venda_comercial(
  p_empresa_id uuid,
  p_usuario_id uuid,
  p_venda_id uuid,
  p_motivo text
)
returns jsonb
language sql
security definer
set search_path = public, auth
as $function$
  select public.rpc_cancelar_venda_comercial(
    p_empresa_id,
    p_usuario_id,
    p_venda_id,
    p_motivo,
    null
  );
$function$;

revoke all
on function public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text,
  text
)
from public;

revoke all
on function public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text,
  text
)
from authenticated;

revoke all
on function public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text
)
from public;

revoke all
on function public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text
)
from authenticated;

grant execute
on function public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text,
  text
)
to service_role;

grant execute
on function public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text
)
to service_role;

notify pgrst, 'reload schema';

commit;
