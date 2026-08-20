begin;

-- ============================================================
-- UltraPDV
-- Carteira: créditos + tratamento de venda fiado já recebida
-- 2026-08-13
--
-- Regras:
-- - nunca altera/apaga o recebimento original;
-- - trata somente as alocações pertencentes à venda cancelada;
-- - DEVOLUCAO = registra obrigação de devolver (PENDENTE);
-- - CREDITO = converte o valor pago da venda em crédito do cliente;
-- - dívida ainda aberta é cancelada;
-- - estoque/pagamentos/venda continuam no mesmo cancelamento atômico.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Créditos do cliente
-- ------------------------------------------------------------
create table if not exists public.carteira_cliente_creditos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  cliente_id uuid not null,

  origem text not null,
  venda_id uuid null,
  recebimento_id uuid null,

  valor_original numeric(14,2) not null,
  valor_disponivel numeric(14,2) not null,

  status text not null default 'DISPONIVEL',
  observacao text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint carteira_creditos_empresa_fkey
    foreign key (empresa_id)
    references public.empresas(id)
    on delete cascade,

  constraint carteira_creditos_cliente_empresa_fkey
    foreign key (empresa_id, cliente_id)
    references public.clientes(empresa_id, id)
    on delete restrict,

  constraint carteira_creditos_venda_empresa_fkey
    foreign key (empresa_id, venda_id)
    references public.vendas(empresa_id, id)
    on delete restrict,

  constraint carteira_creditos_recebimento_empresa_fkey
    foreign key (empresa_id, recebimento_id)
    references public.carteira_cliente_recebimentos(empresa_id, id)
    on delete restrict,

  constraint carteira_creditos_empresa_id_key
    unique (empresa_id, id),

  constraint carteira_creditos_valor_original_check
    check (valor_original > 0),

  constraint carteira_creditos_valor_disponivel_check
    check (
      valor_disponivel >= 0
      and valor_disponivel <= valor_original
    ),

  constraint carteira_creditos_status_check
    check (
      status in (
        'DISPONIVEL',
        'PARCIAL',
        'UTILIZADO',
        'CANCELADO'
      )
    )
);

create unique index if not exists
  uq_carteira_credito_cancelamento_venda
on public.carteira_cliente_creditos (
  empresa_id,
  venda_id
)
where
  origem = 'CANCELAMENTO_VENDA'
  and venda_id is not null;

create index if not exists
  idx_carteira_creditos_cliente_status
on public.carteira_cliente_creditos (
  empresa_id,
  cliente_id,
  status,
  created_at desc
);

-- ------------------------------------------------------------
-- 2. Uso futuro dos créditos em novas vendas
-- ------------------------------------------------------------
create table if not exists public.carteira_cliente_credito_utilizacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  cliente_id uuid not null,
  credito_id uuid not null,
  venda_id uuid null,
  usuario_id uuid null,
  valor numeric(14,2) not null,
  observacao text null,
  created_at timestamptz not null default now(),

  constraint carteira_credito_usos_empresa_fkey
    foreign key (empresa_id)
    references public.empresas(id)
    on delete cascade,

  constraint carteira_credito_usos_cliente_empresa_fkey
    foreign key (empresa_id, cliente_id)
    references public.clientes(empresa_id, id)
    on delete restrict,

  constraint carteira_credito_usos_credito_empresa_fkey
    foreign key (empresa_id, credito_id)
    references public.carteira_cliente_creditos(empresa_id, id)
    on delete restrict,

  constraint carteira_credito_usos_venda_empresa_fkey
    foreign key (empresa_id, venda_id)
    references public.vendas(empresa_id, id)
    on delete restrict,

  constraint carteira_credito_usos_usuario_fkey
    foreign key (usuario_id)
    references public.usuarios(id)
    on delete set null,

  constraint carteira_credito_usos_valor_check
    check (valor > 0)
);

create index if not exists
  idx_carteira_credito_usos_credito
on public.carteira_cliente_credito_utilizacoes (
  empresa_id,
  credito_id,
  created_at
);

-- ------------------------------------------------------------
-- 3. Tratamento do dinheiro já recebido
-- ------------------------------------------------------------
create table if not exists public.carteira_cliente_recebimento_estornos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  cliente_id uuid not null,

  recebimento_id uuid not null,
  alocacao_id uuid not null,
  venda_id uuid not null,
  titulo_id uuid not null,
  usuario_id uuid null,

  valor numeric(14,2) not null,

  destino text not null,
  status text not null,

  credito_id uuid null,
  motivo text not null,

  created_at timestamptz not null default now(),
  concluido_at timestamptz null,

  constraint carteira_receb_estornos_empresa_fkey
    foreign key (empresa_id)
    references public.empresas(id)
    on delete cascade,

  constraint carteira_receb_estornos_cliente_empresa_fkey
    foreign key (empresa_id, cliente_id)
    references public.clientes(empresa_id, id)
    on delete restrict,

  constraint carteira_receb_estornos_recebimento_empresa_fkey
    foreign key (empresa_id, recebimento_id)
    references public.carteira_cliente_recebimentos(empresa_id, id)
    on delete restrict,

  constraint carteira_receb_estornos_alocacao_fkey
    foreign key (alocacao_id)
    references public.carteira_cliente_recebimento_alocacoes(id)
    on delete restrict,

  constraint carteira_receb_estornos_venda_empresa_fkey
    foreign key (empresa_id, venda_id)
    references public.vendas(empresa_id, id)
    on delete restrict,

  constraint carteira_receb_estornos_titulo_empresa_fkey
    foreign key (empresa_id, titulo_id)
    references public.carteira_cliente_titulos(empresa_id, id)
    on delete restrict,

  constraint carteira_receb_estornos_usuario_fkey
    foreign key (usuario_id)
    references public.usuarios(id)
    on delete set null,

  constraint carteira_receb_estornos_credito_empresa_fkey
    foreign key (empresa_id, credito_id)
    references public.carteira_cliente_creditos(empresa_id, id)
    on delete restrict,

  constraint carteira_receb_estornos_empresa_alocacao_key
    unique (empresa_id, alocacao_id),

  constraint carteira_receb_estornos_valor_check
    check (valor > 0),

  constraint carteira_receb_estornos_destino_check
    check (destino in ('DEVOLUCAO', 'CREDITO')),

  constraint carteira_receb_estornos_status_check
    check (
      status in (
        'PENDENTE',
        'CONCLUIDO',
        'CONVERTIDO_CREDITO',
        'CANCELADO'
      )
    )
);

create index if not exists
  idx_carteira_receb_estornos_venda
on public.carteira_cliente_recebimento_estornos (
  empresa_id,
  venda_id,
  created_at
);

create index if not exists
  idx_carteira_receb_estornos_recebimento
on public.carteira_cliente_recebimento_estornos (
  empresa_id,
  recebimento_id,
  created_at
);

-- ------------------------------------------------------------
-- 4. RLS: leitura pelo tenant; escrita via RPC/service_role
-- ------------------------------------------------------------
alter table public.carteira_cliente_creditos
  enable row level security;

alter table public.carteira_cliente_credito_utilizacoes
  enable row level security;

alter table public.carteira_cliente_recebimento_estornos
  enable row level security;

drop policy if exists
  carteira_creditos_select_empresa
on public.carteira_cliente_creditos;

create policy
  carteira_creditos_select_empresa
on public.carteira_cliente_creditos
for select
to authenticated
using (
  public.tem_acesso_empresa(empresa_id)
);

drop policy if exists
  carteira_credito_usos_select_empresa
on public.carteira_cliente_credito_utilizacoes;

create policy
  carteira_credito_usos_select_empresa
on public.carteira_cliente_credito_utilizacoes
for select
to authenticated
using (
  public.tem_acesso_empresa(empresa_id)
);

drop policy if exists
  carteira_receb_estornos_select_empresa
on public.carteira_cliente_recebimento_estornos;

create policy
  carteira_receb_estornos_select_empresa
on public.carteira_cliente_recebimento_estornos
for select
to authenticated
using (
  public.tem_acesso_empresa(empresa_id)
);

-- ------------------------------------------------------------
-- 5. Crédito disponível do cliente
-- ------------------------------------------------------------
create or replace function public.carteira_credito_disponivel_cliente_interno(
  p_empresa_id uuid,
  p_cliente_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    sum(c.valor_disponivel),
    0
  )::numeric(14,2)
  from public.carteira_cliente_creditos c
  where c.empresa_id = p_empresa_id
    and c.cliente_id = p_cliente_id
    and c.status in ('DISPONIVEL', 'PARCIAL')
    and c.valor_disponivel > 0;
$function$;

-- ------------------------------------------------------------
-- 6. Substitui motor do cancelamento
-- ------------------------------------------------------------
drop function if exists public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text
);

drop function if exists public.rpc_cancelar_venda_comercial(
  uuid,
  uuid,
  uuid,
  text,
  text
);

create function public.rpc_cancelar_venda_comercial(
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

  -- Carteira
  v_titulo record;
  v_titulos_qtd integer := 0;
  v_valor_recebido_venda numeric(14,2) := 0;
  v_valor_aberto_cancelado numeric(14,2) := 0;
  v_credito_id uuid;
  v_credito_gerado numeric(14,2) := 0;
  v_devolucao_registrada numeric(14,2) := 0;
  v_saldo_cliente_anterior numeric(14,2) := 0;
  v_saldo_cliente_atual numeric(14,2) := 0;
  v_credito_cliente_atual numeric(14,2) := 0;
  v_aloc record;

  -- Comercial
  v_pagamentos_cancelados integer := 0;
begin
  -- ----------------------------------------------------------
  -- Validações
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

  if v_destino is not null
     and v_destino not in (
       'DEVOLUCAO',
       'CREDITO'
     ) then
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

  -- ----------------------------------------------------------
  -- Gate fiscal
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
  -- Idempotência / consistência do estoque
  -- ----------------------------------------------------------
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

  -- ----------------------------------------------------------
  -- Carteira: identifica título e quanto DESTA venda já foi pago
  -- ----------------------------------------------------------
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
    into v_valor_recebido_venda
    from public.carteira_cliente_recebimento_alocacoes a
    join public.carteira_cliente_itens ci
      on ci.empresa_id = a.empresa_id
     and ci.id = a.item_id
    where a.empresa_id = p_empresa_id
      and ci.titulo_id = v_titulo.id;

    if v_valor_recebido_venda > 0
       and v_destino is null then
      raise exception
        'A venda possui R$ % já recebidos. Escolha DEVOLUCAO ou CREDITO para o cliente.',
        to_char(
          v_valor_recebido_venda,
          'FM999999990D00'
        );
    end if;

    v_valor_aberto_cancelado :=
      coalesce(
        v_titulo.valor_aberto,
        0
      );
  end if;

  -- ----------------------------------------------------------
  -- Estoque: devolve somente o que efetivamente saiu na venda
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
      coalesce(
        v_estoque.quantidade,
        0
      );

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
  -- Carteira
  -- ----------------------------------------------------------
  if v_titulos_qtd = 1 then
    v_saldo_cliente_anterior :=
      public.carteira_recalcular_saldo_cliente_interno(
        p_empresa_id,
        v_titulo.cliente_id
      );

    -- Se existe dinheiro já alocado a esta venda, preserva o
    -- recebimento original e cria registros inversos por alocação.
    if v_valor_recebido_venda > 0 then

      if v_destino = 'CREDITO' then
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
            v_titulo.cliente_id,
            'CANCELAMENTO_VENDA',
            p_venda_id,
            null,
            v_valor_recebido_venda,
            v_valor_recebido_venda,
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
          v_valor_recebido_venda;

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
          'CREDITO',
          'CREDITO_CANCELAMENTO_VENDA',
          v_valor_recebido_venda,
          p_venda_id,
          v_titulo.id,
          concat(
            'Crédito ao cliente pelo cancelamento da venda nº ',
            coalesce(
              v_venda.numero::text,
              'sem número'
            )
          )
        );
      end if;

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
          concluido_at
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
          end
        )
        on conflict (
          empresa_id,
          alocacao_id
        )
        do nothing;
      end loop;

      if v_destino = 'DEVOLUCAO' then
        v_devolucao_registrada :=
          v_valor_recebido_venda;
      end if;
    end if;

    -- Remove somente a parte da dívida que ainda estava aberta.
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

    v_credito_cliente_atual :=
      public.carteira_credito_disponivel_cliente_interno(
        p_empresa_id,
        v_titulo.cliente_id
      );
  end if;

  -- ----------------------------------------------------------
  -- Pagamentos
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
  -- Venda
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

    'estoque_quantidade_estornada',
      v_qtd_estoque_estornada,
    'estoque_movimentos_estornados',
      v_qtd_movimentos,

    'fiado_saldo_aberto_cancelado',
      v_valor_aberto_cancelado,
    'valor_recebido_tratado',
      v_valor_recebido_venda,
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

-- Wrapper de compatibilidade para qualquer chamada antiga.
create function public.rpc_cancelar_venda_comercial(
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
