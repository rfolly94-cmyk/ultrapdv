begin;

-- ============================================================
-- UltraPDV — Cancelamento comercial seguro da venda
-- Data: 2026-08-13
--
-- Regras:
-- 1) Se existir NF-e/NFC-e autorizada, exige cancelamento fiscal.
-- 2) Estorna estoque usando os movimentos originais da venda.
-- 3) Estorna carteira/fiado somente pelo saldo ainda ligado à venda.
-- 4) Estorna caixa quando houver caixas_movimentacoes vinculadas
--    por idempotency_key "venda:<venda_id>:%".
-- 5) Cancela pagamentos e marca a venda como cancelada.
-- 6) Tudo ocorre na mesma transação PostgreSQL.
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
as $$
declare
  v_venda public.vendas%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');

  v_mov jsonb;
  v_mov_estorno jsonb;
  v_mov_id uuid;
  v_estorno_id uuid;

  v_filial_id uuid;
  v_produto_id uuid;
  v_estoque_id uuid;
  v_quantidade numeric;
  v_estoque_anterior numeric;
  v_estoque_posterior numeric;
  v_custo_medio numeric;

  v_fiado numeric := 0;
  v_saldo_anterior numeric := 0;
  v_saldo_posterior numeric := 0;
  v_carteira_base jsonb;
  v_carteira_id uuid;
  v_carteira_estorno_id uuid;

  v_caixa_mov jsonb;
  v_caixa_mov_id uuid;
  v_caixa_estorno_id uuid;
  v_caixa_estorno jsonb;
  v_natureza_original text;
  v_natureza_estorno text;

  v_estoque_estornado numeric := 0;
  v_caixa_estornos integer := 0;
begin
  if p_empresa_id is null
     or p_usuario_id is null
     or p_venda_id is null then
    raise exception 'Empresa, usuário e venda são obrigatórios.';
  end if;

  if v_motivo is null or length(v_motivo) < 5 then
    raise exception 'Informe o motivo do cancelamento com pelo menos 5 caracteres.';
  end if;

  -- A API autenticada resolve a empresa ativa via RLS e chama
  -- esta RPC pelo backend/service_role. Aqui exigimos que o usuário
  -- interno exista; empresa/venda continuam validadas pela própria RPC.
  if not exists (
    select 1
    from public.usuarios u
    where u.id = p_usuario_id
  ) then
    raise exception 'Usuário interno não encontrado.';
  end if;

  select *
  into v_venda
  from public.vendas v
  where v.empresa_id = p_empresa_id
    and v.id = p_venda_id
  for update;

  if not found then
    raise exception 'Venda não encontrada.';
  end if;

  if v_venda.status = 'cancelada' then
    return jsonb_build_object(
      'ok', true,
      'venda_id', v_venda.id,
      'status', 'cancelada',
      'reutilizada', true,
      'mensagem', 'A venda já estava cancelada.'
    );
  end if;

  if v_venda.status <> 'finalizada' then
    raise exception 'Somente venda finalizada pode ser cancelada.';
  end if;

  -- ----------------------------------------------------------
  -- Gate fiscal
  -- ----------------------------------------------------------
  if exists (
    select 1
    from public.fiscal_emissoes fe
    where fe.empresa_id = p_empresa_id
      and fe.origem_tipo = 'venda'
      and fe.origem_id = p_venda_id
      and fe.status = 'autorizada'
  ) then
    raise exception
      'Esta venda possui documento fiscal autorizado. Cancele primeiro a NF-e/NFC-e.';
  end if;

  -- ----------------------------------------------------------
  -- Estoque
  -- Fonte: movimentos VENDA/SAIDA realmente gravados.
  -- Isso evita depender de filial_id na tabela vendas.
  -- ----------------------------------------------------------
  if to_regclass('public.estoque_movimentacoes') is not null
     and to_regclass('public.estoque_atual') is not null then

    for v_mov in
      select to_jsonb(em)
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.documento_tipo = 'VENDA'
        and em.documento_id = p_venda_id
        and upper(coalesce(em.operacao, '')) = 'SAIDA'
        and upper(coalesce(em.tipo_movimento, '')) in ('VENDA', 'SAIDA_VENDA')
      order by em.criado_em, em.id
    loop
      v_mov_id :=
        (v_mov ->> 'id')::uuid;

      v_filial_id :=
        nullif(v_mov ->> 'filial_id', '')::uuid;

      v_produto_id :=
        (v_mov ->> 'produto_id')::uuid;

      v_quantidade :=
        coalesce(
          nullif(v_mov ->> 'quantidade', '')::numeric,
          0
        );

      if v_quantidade <= 0 then
        raise exception 'Movimento de estoque inválido vinculado à venda.';
      end if;

      -- Evita estorno duplo caso exista histórico antigo inconsistente.
      if exists (
        select 1
        from public.estoque_movimentacoes em2
        where em2.empresa_id = p_empresa_id
          and em2.documento_tipo = 'VENDA'
          and em2.documento_id = p_venda_id
          and em2.produto_id = v_produto_id
          and upper(coalesce(em2.operacao, '')) = 'ENTRADA'
          and upper(coalesce(em2.tipo_movimento, '')) = 'ESTORNO_VENDA'
      ) then
        continue;
      end if;

      select
        ea.id,
        coalesce(ea.quantidade, 0),
        coalesce(ea.custo_medio, 0)
      into
        v_estoque_id,
        v_estoque_anterior,
        v_custo_medio
      from public.estoque_atual ea
      where ea.empresa_id = p_empresa_id
        and ea.produto_id = v_produto_id
        and (
          v_filial_id is null
          or ea.filial_id = v_filial_id
        )
      order by
        case
          when v_filial_id is not null
           and ea.filial_id = v_filial_id
          then 0
          else 1
        end
      limit 1
      for update;

      if not found then
        raise exception
          'Estoque atual não encontrado para o produto %.',
          v_produto_id;
      end if;

      v_estoque_posterior :=
        round(
          v_estoque_anterior + v_quantidade,
          4
        );

      update public.estoque_atual ea
      set
        quantidade = v_estoque_posterior,
        valor_estoque =
          case
            when ea.valor_estoque is null
             and ea.custo_medio is null
            then ea.valor_estoque
            else round(
              v_estoque_posterior
              * coalesce(ea.custo_medio, 0),
              2
            )
          end,
        ultima_entrada = now(),
        atualizado_em = now()
      where ea.id = v_estoque_id;

      v_estorno_id :=
        gen_random_uuid();

      -- Clona o movimento original para preservar qualquer coluna
      -- obrigatória que possa existir na instalação.
      v_mov_estorno :=
        v_mov
        || jsonb_build_object(
          'id', v_estorno_id,
          'tipo_movimento', 'ESTORNO_VENDA',
          'operacao', 'ENTRADA',
          'quantidade', v_quantidade,
          'custo_unitario',
            coalesce(
              nullif(v_mov ->> 'custo_unitario', '')::numeric,
              v_custo_medio,
              0
            ),
          'valor_total',
            round(
              v_quantidade
              * coalesce(
                  nullif(v_mov ->> 'custo_unitario', '')::numeric,
                  v_custo_medio,
                  0
                ),
              2
            ),
          'estoque_anterior', v_estoque_anterior,
          'estoque_posterior', v_estoque_posterior,
          'documento_tipo', 'VENDA',
          'documento_id', p_venda_id,
          'observacao',
            format(
              'Estorno do estoque por cancelamento da venda nº %s',
              coalesce(v_venda.numero::text, p_venda_id::text)
            ),
          'usuario_id', p_usuario_id,
          'criado_em', now(),
          'created_at', now(),
          'updated_at', now()
        );

      insert into public.estoque_movimentacoes
      select (
        jsonb_populate_record(
          null::public.estoque_movimentacoes,
          v_mov_estorno
        )
      ).*;

      v_estoque_estornado :=
        v_estoque_estornado
        + v_quantidade;
    end loop;
  end if;

  -- ----------------------------------------------------------
  -- Carteira / FIADO
  -- Calcula apenas o saldo líquido ainda ligado à venda.
  -- ----------------------------------------------------------
  if to_regclass('public.carteira_cliente') is not null
     and v_venda.cliente_id is not null then

    select
      round(
        coalesce(
          sum(
            case
              when upper(cc.tipo_movimento) in (
                'VENDA_FIADO',
                'AJUSTE_DEBITO',
                'DEBITO'
              ) then cc.valor
              when upper(cc.tipo_movimento) in (
                'ESTORNO',
                'AJUSTE_CREDITO',
                'CREDITO'
              ) then -cc.valor
              else 0
            end
          ),
          0
        ),
        2
      )
    into v_fiado
    from public.carteira_cliente cc
    where cc.empresa_id = p_empresa_id
      and cc.cliente_id = v_venda.cliente_id
      and cc.documento_tipo = 'VENDA'
      and cc.documento_id = p_venda_id;

    if v_fiado > 0 then
      select coalesce(c.saldo_devedor, 0)
      into v_saldo_anterior
      from public.clientes c
      where c.empresa_id = p_empresa_id
        and c.id = v_venda.cliente_id
      for update;

      if not found then
        raise exception 'Cliente da venda não encontrado.';
      end if;

      if v_saldo_anterior < v_fiado then
        raise exception
          'O fiado desta venda já possui recebimentos/movimentações posteriores. Revise a carteira antes de cancelar.';
      end if;

      v_saldo_posterior :=
        round(
          v_saldo_anterior - v_fiado,
          2
        );

      update public.clientes
      set
        saldo_devedor = v_saldo_posterior,
        updated_at = now()
      where empresa_id = p_empresa_id
        and id = v_venda.cliente_id;

      select to_jsonb(cc)
      into v_carteira_base
      from public.carteira_cliente cc
      where cc.empresa_id = p_empresa_id
        and cc.cliente_id = v_venda.cliente_id
        and cc.documento_tipo = 'VENDA'
        and cc.documento_id = p_venda_id
        and upper(cc.tipo_movimento) = 'VENDA_FIADO'
      order by cc.id
      limit 1;

      if v_carteira_base is not null then
        v_carteira_estorno_id :=
          gen_random_uuid();

        v_carteira_base :=
          v_carteira_base
          || jsonb_build_object(
            'id', v_carteira_estorno_id,
            'tipo_movimento', 'ESTORNO',
            'valor', v_fiado,
            'saldo_anterior', v_saldo_anterior,
            'saldo_posterior', v_saldo_posterior,
            'documento_tipo', 'VENDA',
            'documento_id', p_venda_id,
            'descricao',
              format(
                'Estorno do fiado por cancelamento da venda nº %s',
                coalesce(v_venda.numero::text, p_venda_id::text)
              ),
            'usuario_id', p_usuario_id,
            'criado_em', now(),
            'created_at', now(),
            'updated_at', now()
          );

        insert into public.carteira_cliente
        select (
          jsonb_populate_record(
            null::public.carteira_cliente,
            v_carteira_base
          )
        ).*;
      end if;
    end if;
  end if;

  -- ----------------------------------------------------------
  -- Caixa
  -- Compatível com a arquitetura já prevista:
  -- idempotency_key = venda:<venda_id>:pag:<pagamento_id>
  -- ----------------------------------------------------------
  if to_regclass('public.caixas_movimentacoes') is not null then
    for v_caixa_mov in
      execute format(
        $sql$
          select to_jsonb(m)
          from public.caixas_movimentacoes m
          where m.empresa_id = $1
            and coalesce(m.cancelada, false) = false
            and upper(coalesce(m.tipo, '')) = 'VENDA'
            and coalesce(m.idempotency_key, '')
                like $2
          order by m.criado_em, m.id
        $sql$
      )
      using
        p_empresa_id,
        'venda:' || p_venda_id::text || ':%'
    loop
      v_caixa_mov_id :=
        (v_caixa_mov ->> 'id')::uuid;

      if nullif(
        v_caixa_mov ->> 'movimento_estorno_id',
        ''
      ) is not null then
        continue;
      end if;

      v_natureza_original :=
        upper(
          coalesce(
            v_caixa_mov ->> 'natureza',
            'INFORMATIVO'
          )
        );

      v_natureza_estorno :=
        case
          when v_natureza_original = 'ENTRADA'
          then 'SAIDA'
          when v_natureza_original = 'SAIDA'
          then 'ENTRADA'
          else 'INFORMATIVO'
        end;

      v_caixa_estorno_id :=
        gen_random_uuid();

      v_caixa_estorno :=
        v_caixa_mov
        || jsonb_build_object(
          'id', v_caixa_estorno_id,
          'tipo', 'ESTORNO',
          'natureza', v_natureza_estorno,
          'origem',
            coalesce(
              v_caixa_mov ->> 'origem',
              'PDV'
            ),
          'cancelada', false,
          'movimento_estorno_id', v_caixa_mov_id,
          'idempotency_key',
            'cancelamento-venda:'
            || p_venda_id::text
            || ':mov:'
            || v_caixa_mov_id::text,
          'descricao',
            format(
              'Estorno por cancelamento da venda nº %s',
              coalesce(v_venda.numero::text, p_venda_id::text)
            ),
          'usuario_id', p_usuario_id,
          'criado_em', now()
        );

      execute
        'insert into public.caixas_movimentacoes
         select (
           jsonb_populate_record(
             null::public.caixas_movimentacoes,
             $1
           )
         ).*'
      using v_caixa_estorno;

      execute
        'update public.caixas_movimentacoes
         set cancelada = true,
             movimento_estorno_id = $1
         where empresa_id = $2
           and id = $3'
      using
        v_caixa_estorno_id,
        p_empresa_id,
        v_caixa_mov_id;

      v_caixa_estornos :=
        v_caixa_estornos + 1;
    end loop;
  end if;

  -- ----------------------------------------------------------
  -- Comercial
  -- ----------------------------------------------------------
  update public.vendas_pagamentos
  set
    status = 'cancelado',
    updated_at = now()
  where empresa_id = p_empresa_id
    and venda_id = p_venda_id
    and status = 'confirmado';

  update public.vendas
  set
    status = 'cancelada',
    cancelada_at = now(),
    cancelada_por = p_usuario_id,
    motivo_cancelamento = v_motivo
  where empresa_id = p_empresa_id
    and id = p_venda_id;

  return jsonb_build_object(
    'ok', true,
    'venda_id', p_venda_id,
    'numero', v_venda.numero,
    'status', 'cancelada',
    'estoque_quantidade_estornada', v_estoque_estornado,
    'fiado_estornado', v_fiado,
    'caixa_movimentos_estornados', v_caixa_estornos,
    'motivo', v_motivo
  );
end;
$$;

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
