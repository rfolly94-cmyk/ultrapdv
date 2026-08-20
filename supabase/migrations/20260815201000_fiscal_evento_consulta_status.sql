begin;

-- UltraPDV — histórico de consulta/reconciliação fiscal.
-- Não altera fiscal_emissoes. Apenas amplia o tipo de evento.

alter table public.fiscal_emissao_eventos
  drop constraint if exists fiscal_emissao_eventos_tipo_check;

alter table public.fiscal_emissao_eventos
  add constraint fiscal_emissao_eventos_tipo_check
  check (
    tipo in (
      'cancelamento',
      'carta_correcao',
      'consulta_status'
    )
  );

commit;
