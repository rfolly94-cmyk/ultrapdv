BEGIN;

-- ============================================================
-- UltraPDV — Controle de validade por lotes
-- Data: 2026-08-27
--
-- 1) produtos.controlar_validade (default false)
-- 2) estoque_lotes: validade por lote, isolado por empresa
--
-- Não grava uma única validade no produto.
-- Não altera baixa de estoque do PDV: o saldo operacional
-- continua em estoque_atual. A ordem FEFO (primeiro o lote
-- que vence antes) fica preparada pelo índice e pelos
-- helpers da aplicação para uso futuro.
-- ============================================================

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS controlar_validade boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.produtos.controlar_validade IS
  'Quando true, o produto usa lotes em estoque_lotes. Não armazena data de validade no próprio produto.';

CREATE TABLE IF NOT EXISTS public.estoque_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  codigo_lote text NOT NULL,
  data_fabricacao date,
  data_validade date NOT NULL,
  quantidade numeric(14,4) NOT NULL DEFAULT 0,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT estoque_lotes_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT estoque_lotes_empresa_produto_codigo_key
    UNIQUE (empresa_id, produto_id, codigo_lote),

  CONSTRAINT estoque_lotes_codigo_check
    CHECK (char_length(btrim(codigo_lote)) BETWEEN 1 AND 60),

  CONSTRAINT estoque_lotes_quantidade_check
    CHECK (quantidade >= 0),

  CONSTRAINT estoque_lotes_datas_check
    CHECK (
      data_fabricacao IS NULL
      OR data_fabricacao <= data_validade
    ),

  CONSTRAINT estoque_lotes_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT estoque_lotes_produto_empresa_fkey
    FOREIGN KEY (empresa_id, produto_id)
    REFERENCES public.produtos(empresa_id, id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.estoque_lotes IS
  'Lotes de validade do produto da empresa ativa. Quantidade cadastral; o PDV ainda baixa somente estoque_atual. FEFO futuro: ORDER BY data_validade, created_at.';

CREATE INDEX IF NOT EXISTS ix_estoque_lotes_empresa_produto
  ON public.estoque_lotes (empresa_id, produto_id);

-- Ordem FEFO: lote que vence primeiro, depois o mais antigo.
CREATE INDEX IF NOT EXISTS ix_estoque_lotes_fefo
  ON public.estoque_lotes (empresa_id, produto_id, data_validade, created_at);

CREATE OR REPLACE FUNCTION public.estoque_lotes_normalizar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.codigo_lote := btrim(NEW.codigo_lote);
  IF NEW.observacao IS NOT NULL THEN
    NEW.observacao := nullif(btrim(NEW.observacao), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estoque_lotes_normalizar
ON public.estoque_lotes;

CREATE TRIGGER trg_estoque_lotes_normalizar
BEFORE INSERT OR UPDATE OF codigo_lote, observacao
ON public.estoque_lotes
FOR EACH ROW
EXECUTE FUNCTION public.estoque_lotes_normalizar();

DROP TRIGGER IF EXISTS trg_estoque_lotes_updated_at
ON public.estoque_lotes;

CREATE TRIGGER trg_estoque_lotes_updated_at
BEFORE UPDATE ON public.estoque_lotes
FOR EACH ROW
EXECUTE FUNCTION public.ultrapdv_set_updated_at();

ALTER TABLE public.estoque_lotes
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estoque_lotes_select_empresa
  ON public.estoque_lotes;
CREATE POLICY estoque_lotes_select_empresa
ON public.estoque_lotes
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS estoque_lotes_insert_empresa
  ON public.estoque_lotes;
CREATE POLICY estoque_lotes_insert_empresa
ON public.estoque_lotes
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS estoque_lotes_update_empresa
  ON public.estoque_lotes;
CREATE POLICY estoque_lotes_update_empresa
ON public.estoque_lotes
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS estoque_lotes_delete_empresa
  ON public.estoque_lotes;
CREATE POLICY estoque_lotes_delete_empresa
ON public.estoque_lotes
FOR DELETE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS estoque_lotes_contador_sem_insert
  ON public.estoque_lotes;
CREATE POLICY estoque_lotes_contador_sem_insert
ON public.estoque_lotes
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

DROP POLICY IF EXISTS estoque_lotes_contador_sem_update
  ON public.estoque_lotes;
CREATE POLICY estoque_lotes_contador_sem_update
ON public.estoque_lotes
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (NOT public.eh_contador_da_empresa(empresa_id))
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

DROP POLICY IF EXISTS estoque_lotes_contador_sem_delete
  ON public.estoque_lotes;
CREATE POLICY estoque_lotes_contador_sem_delete
ON public.estoque_lotes
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (NOT public.eh_contador_da_empresa(empresa_id));

REVOKE ALL ON TABLE public.estoque_lotes FROM public, anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.estoque_lotes
  TO authenticated;

GRANT ALL
  ON TABLE public.estoque_lotes
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
