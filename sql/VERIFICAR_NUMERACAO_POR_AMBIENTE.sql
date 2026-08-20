-- Verificação pós-migration

select
  empresa_id,
  modelo,
  ambiente,
  serie,
  proximo_numero,
  ativo,
  updated_at
from public.fiscal_numeracoes
order by empresa_id, modelo, ambiente, serie;

select
  empresa_id,
  modelo,
  ambiente,
  serie,
  numero,
  status,
  created_at
from public.fiscal_emissoes
order by created_at desc
limit 50;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rpc_reservar_emissao_fiscal';
