begin;

-- ============================================================
-- UltraPDV — Eventos fiscais
-- Cancelamento seguro de NF-e/NFC-e
-- ============================================================

alter table public.fiscal_emissoes
  add column if not exists cancelada_at timestamptz null;

create table if not exists public.fiscal_emissao_eventos (
  id uuid primary key default gen_random_uuid(),

  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,

  emissao_id uuid not null
    references public.fiscal_emissoes(id)
    on delete cascade,

  tipo text not null,

  status text not null
    default 'processando',

  sequencia integer not null
    default 1,

  tentativas integer not null
    default 0,

  justificativa text null,

  cstat text null,
  protocolo text null,
  motivo text null,

  payload_resumo jsonb not null
    default '{}'::jsonb,

  resposta_resumo jsonb not null
    default '{}'::jsonb,

  xml_hex text null,
  pdf_hex text null,

  erro_comunicacao text null,

  enviado_at timestamptz null,
  respondido_at timestamptz null,
  concluido_at timestamptz null,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  constraint fiscal_emissao_eventos_tipo_check
    check (
      tipo in (
        'cancelamento',
        'carta_correcao'
      )
    ),

  constraint fiscal_emissao_eventos_status_check
    check (
      status in (
        'processando',
        'sucesso',
        'rejeitado',
        'aguardando_reconciliacao'
      )
    ),

  constraint fiscal_emissao_eventos_sequencia_check
    check (sequencia > 0),

  constraint fiscal_emissao_eventos_tentativas_check
    check (tentativas >= 0)
);

create unique index if not exists
  fiscal_emissao_eventos_cancelamento_unico
on public.fiscal_emissao_eventos (
  emissao_id,
  tipo
)
where tipo = 'cancelamento';

create index if not exists
  fiscal_emissao_eventos_empresa_emissao_idx
on public.fiscal_emissao_eventos (
  empresa_id,
  emissao_id,
  created_at desc
);

drop trigger if exists
  fiscal_emissao_eventos_set_updated_at
on public.fiscal_emissao_eventos;

create trigger
  fiscal_emissao_eventos_set_updated_at
before update on public.fiscal_emissao_eventos
for each row
execute function public.set_updated_at();

alter table public.fiscal_emissao_eventos
  enable row level security;

drop policy if exists
  usuario_visualiza_fiscal_emissao_eventos
on public.fiscal_emissao_eventos;

create policy
  usuario_visualiza_fiscal_emissao_eventos
on public.fiscal_emissao_eventos
for select
to authenticated
using (
  public.tem_acesso_empresa(empresa_id)
);

-- Escrita permanece somente no backend/service_role.
revoke insert, update, delete
on public.fiscal_emissao_eventos
from authenticated;

notify pgrst, 'reload schema';

commit;
