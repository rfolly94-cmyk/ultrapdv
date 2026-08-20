begin;

-- ============================================================
-- UltraPDV — Carta de Correção Eletrônica (CC-e) NF-e 55
-- Reaproveita public.fiscal_emissao_eventos.
-- ============================================================

alter table public.fiscal_emissao_eventos
  add column if not exists texto_correcao text null;

-- Cada sequência de CC-e é única dentro da mesma emissão.
create unique index if not exists
  fiscal_emissao_eventos_cce_sequencia_unica
on public.fiscal_emissao_eventos (
  emissao_id,
  tipo,
  sequencia
)
where tipo = 'carta_correcao';

-- Texto oficial da CC-e: 15 a 1000 caracteres.
-- NOT VALID evita bloquear a migration por eventual dado legado;
-- novas gravações já são validadas normalmente.
alter table public.fiscal_emissao_eventos
  drop constraint if exists
    fiscal_emissao_eventos_cce_texto_check;

alter table public.fiscal_emissao_eventos
  add constraint
    fiscal_emissao_eventos_cce_texto_check
  check (
    tipo <> 'carta_correcao'
    or (
      texto_correcao is not null
      and char_length(texto_correcao)
        between 15 and 1000
    )
  )
  not valid;

notify pgrst, 'reload schema';

commit;
