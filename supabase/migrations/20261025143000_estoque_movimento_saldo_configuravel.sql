-- A baixa já consulta pdv_configuracoes.permitir_venda_sem_estoque.
-- A restrição da tabela impedia gravar saldo negativo mesmo com a opção ligada.

BEGIN;

ALTER TABLE public.estoque_movimentacoes
  DROP CONSTRAINT IF EXISTS estoque_movimentacoes_saldos_check;

COMMENT ON TABLE public.estoque_movimentacoes IS
  'Histórico de estoque. Saldo anterior e posterior podem ficar negativos quando a empresa permite venda sem estoque. A baixa da venda continua bloqueando saldo insuficiente quando a opção está desligada.';

COMMIT;
