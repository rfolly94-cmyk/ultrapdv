-- UltraPDV — conferência de contingência fiscal

select
  e.id,
  e.origem_id as venda_id,
  e.modelo,
  e.serie,
  e.numero,
  e.ambiente,
  e.status,
  e.tipo_emissao,
  e.contingencia_justificativa,
  e.contingencia_gerada_at,
  e.contingencia_transmitida_at,
  e.contingencia_tentativas,
  e.contingencia_erro,
  e.chave_acesso,
  e.protocolo,
  e.cstat,
  e.motivo
from public.fiscal_emissoes e
where e.tipo_emissao = 'contingencia_offline'
order by e.created_at desc
limit 50;

select
  ev.emissao_id,
  ev.tipo,
  ev.detalhes,
  ev.created_at
from public.fiscal_contingencia_eventos ev
order by ev.created_at desc
limit 100;
