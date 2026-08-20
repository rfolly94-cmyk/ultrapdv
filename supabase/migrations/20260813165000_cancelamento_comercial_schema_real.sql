begin;

-- ============================================================
-- UltraPDV — Cancelamento comercial definitivo
-- Baseado no schema real enviado em 2026-08-13.
--
-- NÃO usa:
-- - filial_id
-- - custo_medio / valor_estoque
-- - documento_tipo / documento_id
-- - carteira_cliente legada
-- - caixas_movimentacoes
--
-- Fluxo:
-- fiscal -> estoque -> carteira/fiado -> pagamentos -> venda
-- ============================================================

create or replace function public.rpc_cancelar_venda_comercial(
  p_empresa_id uuid,
  p_usuario_id uuid,
  p_venda_id uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_venda public.vendas%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');

  -- Estoque
  v_mov record;
  v_estoque record;
  v_saldo_anterior numeric;
  v_saldo_posterior numeric;
  v_qtd_movimentos integer := 0;
  v_qtd_estoque_estornada numeric := 0;

  -- Carteira
  v_titulo record;
  v_titulos_qtd integer := 0;
  v_alocacoes_qtd integer := 0;
  v_fiado_pagamento numeric := 0;
  v_fiado_estornado numeric := 0;
  v_saldo_cliente_anterior numeric := 0;
  v_saldo_cliente_atual numeric := 0;
  v_titulo_cancelado boolean := false;

  -- Comercial
  v_pagamentos_cancelados integer := 0;
begin
  -- ----------------------------------------------------------
  -- Validações básicas
  -- ----------------------------------------------------------
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

  -- ----------------------------------------------------------
  -- Gate fiscal
  --
  -- Documento autorizado precisa ser cancelado primeiro.
  -- Estado ambíguo também bloqueia, pois a autorização pode ter
  -- ocorrido na SEFAZ apesar de o sistema ainda não ter certeza.
  -- ----------------------------------------------------------
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

  -- ----------------------------------------------------------
  -- Consistência: impede segundo estorno de estoque enquanto a
  -- venda ainda não estiver marcada como cancelada.
  -- ----------------------------------------------------------
  if exists (
    select 1
    from public.estoque_movimentacoes em
    where em.empresa_id = p_empresa_id
      and em.venda_id = p_venda_id
      and em.tipo = 'CANCELAMENTO_VENDA'
  ) then
    raise exception
      'Já existe movimento de cancelamento de estoque para esta venda, mas a venda ainda não está cancelada. Revise a consistência antes de tentar novamente.';
  end if;

  -- ----------------------------------------------------------
  -- Carteira / FIADO — valida ANTES de mexer no estoque.
  --
  -- Se a venda fiado já recebeu qualquer alocação, bloqueia.
  -- Não convertemos recebimento anterior em crédito automático:
  -- isso exige um fluxo próprio de estorno/devolução de dinheiro.
  -- ----------------------------------------------------------
  select
    coalesce(sum(vp.valor), 0)
  into v_fiado_pagamento
  from public.vendas_pagamentos vp
  join public.formas_pagamento fp
    on fp.empresa_id = vp.empresa_id
   and fp.id = vp.forma_pagamento_id
  where vp.empresa_id = p_empresa_id
    and vp.venda_id = p_venda_id
    and vp.status = 'confirmado'
    and fp.permite_fiado = true;

  select count(*)
  into v_titulos_qtd
  from public.carteira_cliente_titulos t
  where t.empresa_id = p_empresa_id
    and t.venda_id = p_venda_id;

  if v_titulos_qtd > 1 then
    raise exception
      'Foram encontrados múltiplos títulos de carteira para a mesma venda. Cancelamento bloqueado para revisão.';
  end if;

  if v_fiado_pagamento > 0
     and v_titulos_qtd = 0 then
    raise exception
      'A venda possui pagamento fiado, mas o título da carteira não foi encontrado. Cancelamento bloqueado para revisão.';
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

    if v_titulo.status <> 'CANCELADO' then
      perform ci.id
      from public.carteira_cliente_itens ci
      where ci.empresa_id = p_empresa_id
        and ci.titulo_id = v_titulo.id
      order by ci.id
      for update;

      select count(*)
      into v_alocacoes_qtd
      from public.carteira_cliente_recebimento_alocacoes a
      join public.carteira_cliente_itens ci
        on ci.empresa_id = a.empresa_id
       and ci.id = a.item_id
      where a.empresa_id = p_empresa_id
        and ci.titulo_id = v_titulo.id;

      if v_alocacoes_qtd > 0 then
        raise exception
          'Esta venda fiado já possui recebimento total ou parcial. Estorne/revise o recebimento da carteira antes de cancelar a venda.';
      end if;

      if v_titulo.status <> 'ABERTO'
         or v_titulo.valor_aberto <> v_titulo.valor_original
         or exists (
           select 1
           from public.carteira_cliente_itens ci
           where ci.empresa_id = p_empresa_id
             and ci.titulo_id = v_titulo.id
             and (
               ci.status <> 'ABERTO'
               or ci.valor_aberto <> ci.valor_original
             )
         ) then
        raise exception
          'O título da carteira já possui baixa ou alteração de saldo. Revise a carteira antes de cancelar a venda.';
      end if;
    end if;
  end if;

  -- ----------------------------------------------------------
  -- ESTOQUE
  --
  -- Fonte da verdade: movimentos reais tipo VENDA ligados
  -- diretamente a estoque_movimentacoes.venda_id.
  --
  -- Agrupa por produto para devolver exatamente a quantidade
  -- que efetivamente saiu do estoque.
  -- ----------------------------------------------------------
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

  -- ----------------------------------------------------------
  -- CARTEIRA
  -- ----------------------------------------------------------
  if v_titulos_qtd = 1 then
    -- Relê com lock; o bloco de validação acima garantiu que não
    -- há recebimento/alocação a desfazer.
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

    if v_titulo.status <> 'CANCELADO' then
      v_saldo_cliente_anterior :=
        public.carteira_recalcular_saldo_cliente_interno(
          p_empresa_id,
          v_titulo.cliente_id
        );

      v_fiado_estornado :=
        v_titulo.valor_aberto;

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
        v_fiado_estornado,
        p_venda_id,
        v_titulo.id,
        concat(
          'Estorno da carteira pelo cancelamento da venda nº ',
          coalesce(
            v_venda.numero::text,
            'sem número'
          )
        )
      );

      v_saldo_cliente_atual :=
        public.carteira_recalcular_saldo_cliente_interno(
          p_empresa_id,
          v_titulo.cliente_id
        );

      v_titulo_cancelado := true;
    else
      v_saldo_cliente_atual :=
        public.carteira_recalcular_saldo_cliente_interno(
          p_empresa_id,
          v_titulo.cliente_id
        );

      v_saldo_cliente_anterior :=
        v_saldo_cliente_atual;

      v_titulo_cancelado := true;
    end if;
  end if;

  -- ----------------------------------------------------------
  -- PAGAMENTOS
  -- ----------------------------------------------------------
  update public.vendas_pagamentos vp
  set
    status = 'cancelado',
    updated_at = now()
  where vp.empresa_id = p_empresa_id
    and vp.venda_id = p_venda_id
    and vp.status = 'confirmado';

  get diagnostics
    v_pagamentos_cancelados = row_count;

  -- ----------------------------------------------------------
  -- VENDA
  -- ----------------------------------------------------------
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
    'estoque_quantidade_estornada', v_qtd_estoque_estornada,
    'estoque_movimentos_estornados', v_qtd_movimentos,
    'fiado_estornado', v_fiado_estornado,
    'carteira_titulo_cancelado', v_titulo_cancelado,
    'saldo_cliente_anterior', v_saldo_cliente_anterior,
    'saldo_cliente_atual', v_saldo_cliente_atual,
    'pagamentos_cancelados', v_pagamentos_cancelados,
    'motivo', v_motivo
  );
end;
$function$;

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

notify pgrst, 'reload schema';

commit;
