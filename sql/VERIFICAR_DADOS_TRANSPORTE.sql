select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'vendas'
  and column_name = 'dados_transporte';

-- Substitua o UUID após salvar dados em uma venda:
-- select id, numero, dados_transporte
-- from public.vendas
-- where id = '<VENDA_ID>';
