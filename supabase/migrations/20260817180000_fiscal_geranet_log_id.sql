begin;

-- UltraPDV — rastreio do log Geranet da transmissão original
--
-- Não cria transmissao_iniciada_em / transmissao_finalizada_em /
-- motivo_aguardando_reconciliacao: equivalentes já existem:
--   enviada_at      → início da transmissão (rpc_iniciar_tentativa_emissao_fiscal)
--   respondida_at   → resultado conhecido ou falha ambígua
--   motivo          → motivo de aguardando_reconciliacao
--   erro_comunicacao
--
-- geranet_log_id não existia como coluna; o id só aparecia em
-- resposta_resumo.consulta.log_id. Coluna própria permite reconciliar
-- GET /api/v1/logs/{id} sem varrer a lista inteira.

alter table public.fiscal_emissoes
  add column if not exists geranet_log_id bigint null;

comment on column public.fiscal_emissoes.geranet_log_id is
  'Número do log Geranet (GET /api/v1/logs/{id}) da transmissão original de NF-e/NFC-e. Usado na reconciliação; nunca dispara novo POST /nfe/emitir.';

commit;
