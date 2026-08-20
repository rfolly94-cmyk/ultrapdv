BEGIN;

-- UltraPDV — conversão Pedido Online → Venda
-- A venda continua nascendo só no PDV. Aqui só há rastreio e trava de concorrência.

ALTER TABLE public.catalogo_pedidos
  ADD COLUMN IF NOT EXISTS convertido_em timestamptz;

ALTER TABLE public.catalogo_pedidos
  ADD COLUMN IF NOT EXISTS convertido_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.catalogo_pedidos.venda_id IS
  'Venda criada no PDV. Preenchida somente após rpc_finalizar_venda concluir com sucesso.';

COMMENT ON COLUMN public.catalogo_pedidos.convertido_em IS
  'Momento em que o pedido foi vinculado à venda concluída.';

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_pedidos_venda_id_unique
  ON public.catalogo_pedidos (venda_id)
  WHERE venda_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
