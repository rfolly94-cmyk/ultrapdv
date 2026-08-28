-- Camada de leitura do Assistente IA.
-- Views SECURITY INVOKER: RLS das tabelas-base vale para o usuário autenticado.
-- Não há RPC de SQL textual. empresa_id existe só para isolamento interno.

create or replace view public.ia_read_produtos
with (security_invoker = true) as
select
  id,
  empresa_id,
  codigo,
  codigo_barras,
  nome,
  ativo,
  preco_venda,
  preco_custo,
  categoria_id,
  marca_id
from public.produtos;

create or replace view public.ia_read_estoque
with (security_invoker = true) as
select
  empresa_id,
  produto_id,
  quantidade,
  estoque_minimo
from public.estoque_atual;

create or replace view public.ia_read_categorias
with (security_invoker = true) as
select
  id,
  empresa_id,
  nome
from public.categorias;

create or replace view public.ia_read_clientes
with (security_invoker = true) as
select
  id,
  empresa_id,
  nome,
  nome_fantasia,
  tipo_pessoa,
  telefone,
  municipio,
  uf,
  ativo,
  bloqueado,
  limite_credito,
  saldo_devedor
from public.clientes;

create or replace view public.ia_read_vendas
with (security_invoker = true) as
select
  id,
  empresa_id,
  numero,
  cliente_id,
  usuario_id as vendedor_id,
  status,
  valor_total as total,
  desconto,
  coalesce(finalizada_at, created_at) as data,
  finalizada_at,
  created_at
from public.vendas;

create or replace view public.ia_read_vendas_itens
with (security_invoker = true) as
select
  id,
  empresa_id,
  venda_id,
  produto_id,
  produto_codigo,
  produto_nome,
  quantidade,
  valor_unitario as preco_unitario,
  desconto,
  valor_total as total,
  created_at
from public.vendas_itens;

create or replace view public.ia_read_pagamentos
with (security_invoker = true) as
select
  empresa_id,
  venda_id,
  forma_pagamento_nome,
  forma_pagamento_codigo,
  valor,
  status
from public.vendas_pagamentos;

create or replace view public.ia_read_carteira
with (security_invoker = true) as
select
  empresa_id,
  cliente_id,
  venda_id,
  valor_original,
  valor_aberto,
  status,
  vencimento
from public.carteira_cliente_titulos;

create or replace view public.ia_read_recebimentos
with (security_invoker = true) as
select
  id,
  empresa_id,
  cliente_id,
  forma_pagamento_nome,
  valor,
  processado_at,
  created_at
from public.carteira_cliente_recebimentos;

create or replace view public.ia_read_creditos
with (security_invoker = true) as
select
  id,
  empresa_id,
  cliente_id,
  valor_disponivel,
  status
from public.carteira_cliente_creditos;

create or replace view public.ia_read_caixas
with (security_invoker = true) as
select
  id,
  empresa_id,
  numero,
  status,
  saldo_inicial,
  aberto_em,
  fechado_em,
  reaberto
from public.caixas;

create or replace view public.ia_read_caixa_movimentacoes
with (security_invoker = true) as
select
  id,
  empresa_id,
  caixa_id,
  tipo,
  forma_nome,
  entrada,
  saida,
  descricao,
  venda_numero,
  created_at
from public.caixa_movimentacoes;

create or replace view public.ia_read_documentos_fiscais
with (security_invoker = true) as
select
  id,
  empresa_id,
  modelo,
  numero,
  status,
  motivo,
  origem_tipo,
  origem_id,
  created_at
from public.fiscal_emissoes;

create or replace view public.ia_read_notificacoes
with (security_invoker = true) as
select
  id,
  empresa_id,
  tipo,
  categoria,
  nivel,
  titulo,
  mensagem,
  status,
  created_at
from public.notificacoes;

do $$
declare
  v_rel record;
begin
  for v_rel in
    select relname
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'v'
      and relname like 'ia_read_%'
  loop
    execute format('grant select on public.%I to authenticated', v_rel.relname);
    execute format('revoke all on public.%I from anon', v_rel.relname);
    execute format(
      'comment on view public.%I is %L',
      v_rel.relname,
      'Leitura do Assistente IA. SECURITY INVOKER. Sem secrets. empresa_id só para isolamento.'
    );
  end loop;
end
$$;
