BEGIN;

CREATE INDEX IF NOT EXISTS ix_vendas_empresa_status_finalizada
  ON public.vendas (empresa_id, status, finalizada_at DESC);

CREATE INDEX IF NOT EXISTS ix_vendas_empresa_created
  ON public.vendas (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_vendas_itens_empresa_venda
  ON public.vendas_itens (empresa_id, venda_id);

CREATE INDEX IF NOT EXISTS ix_vendas_pagamentos_empresa_venda_status
  ON public.vendas_pagamentos (empresa_id, venda_id, status);

CREATE INDEX IF NOT EXISTS ix_fiscal_emissoes_empresa_status_created
  ON public.fiscal_emissoes (empresa_id, status, created_at DESC);

NOTIFY pgrst, 'reload schema';

COMMIT;
