-- UltraPDV — verificação da frente de estoque na venda
-- Somente leitura. Rodar no SQL Editor após a migration
-- 20260815010000_estoque_venda_edicao_cancelamento.sql

select
  conname,
  pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.estoque_movimentacoes'::regclass
  and conname = 'estoque_movimentacoes_tipo_check';

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  position(
    'estoque_baixar_composicao_venda_interno'
    in pg_get_functiondef(p.oid)
  ) > 0 as baixa_apos_v1,
  position(
    'finalizar_venda_comercial_interno_v1'
    in pg_get_functiondef(p.oid)
  ) > 0 as ainda_chama_v1
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finalizar_venda_comercial_interno';

select
  p.proname,
  position(
    'ESTORNO_EDICAO'
    in pg_get_functiondef(p.oid)
  ) > 0 as usa_estorno_edicao,
  position(
    'AJUSTE_POSITIVO'
    in pg_get_functiondef(p.oid)
  ) = 0 as nao_usa_ajuste_positivo,
  position(
    'estoque_baixar_composicao_venda_interno'
    in pg_get_functiondef(p.oid)
  ) > 0 as baixa_nova_composicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_editar_venda_pdv';

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  position(
    'estoque_estornar_composicao_venda_interno'
    in pg_get_functiondef(p.oid)
  ) > 0 as estorna_por_vendas_itens,
  position(
    'em.tipo = ''VENDA'''
    in pg_get_functiondef(p.oid)
  ) = 0 as nao_soma_historico_venda
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_cancelar_venda_comercial';

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'estoque_baixar_composicao_venda_interno',
    'estoque_estornar_composicao_venda_interno',
    'rpc_finalizar_venda',
    'finalizar_venda_comercial_interno_v1'
  )
order by p.proname, args;
