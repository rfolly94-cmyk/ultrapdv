BEGIN;

-- ============================================================
-- UltraPDV — Módulo de balanças
-- Data: 2026-08-27
--
-- Tabelas novas (não altera produtos, estoque_lotes nem PDV):
--   balancas_configuracoes              — uma ou mais balanças por empresa
--   produtos_balancas                   — dados gerais do produto (PLU, etiqueta)
--   balancas_configuracoes_produtos     — vínculo produto x configuração
--
-- Isolamento: empresa_id da sessão, RLS via tem_acesso_empresa.
-- PLU único por empresa (o mesmo PLU pode existir em outra empresa).
-- validade_etiqueta_dias NÃO altera lote/validade de estoque.
-- O mesmo produto pode estar vinculado a uma config e não a outra.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.balancas_configuracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  nome text NOT NULL,
  fabricante text NOT NULL,
  modelo text,
  layout text,
  tipo_integracao text NOT NULL,
  configuracao jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT balancas_configuracoes_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT balancas_configuracoes_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT balancas_configuracoes_nome_check
    CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),

  CONSTRAINT balancas_configuracoes_fabricante_check
    CHECK (fabricante IN ('toledo', 'urano', 'filizola', 'outro')),

  CONSTRAINT balancas_configuracoes_tipo_check
    CHECK (tipo_integracao IN ('arquivo', 'pendrive', 'rede')),

  CONSTRAINT balancas_configuracoes_configuracao_check
    CHECK (jsonb_typeof(configuracao) = 'object')
);

COMMENT ON TABLE public.balancas_configuracoes IS
  'Configuração de balança da empresa ativa. Isolado por empresa_id. Layout de fabricante só gera carga quando implementado.';

COMMENT ON COLUMN public.balancas_configuracoes.configuracao IS
  'JSON da etiqueta futura (prefixo, PLU, peso/preço, dígitos, casas, DV). Não altera a busca do PDV nesta fase.';

CREATE INDEX IF NOT EXISTS ix_balancas_configuracoes_empresa
  ON public.balancas_configuracoes (empresa_id);

CREATE TABLE IF NOT EXISTS public.produtos_balancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  plu text,
  descricao_balanca text,
  validade_etiqueta_dias integer,
  tara_padrao numeric(14,4),
  departamento text,
  mensagem text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT produtos_balancas_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT produtos_balancas_empresa_produto_key
    UNIQUE (empresa_id, produto_id),

  CONSTRAINT produtos_balancas_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT produtos_balancas_produto_empresa_fkey
    FOREIGN KEY (empresa_id, produto_id)
    REFERENCES public.produtos(empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT produtos_balancas_plu_check
    CHECK (
      plu IS NULL
      OR char_length(btrim(plu)) BETWEEN 1 AND 8
    ),

  CONSTRAINT produtos_balancas_descricao_check
    CHECK (
      descricao_balanca IS NULL
      OR char_length(btrim(descricao_balanca)) BETWEEN 1 AND 50
    ),

  CONSTRAINT produtos_balancas_validade_check
    CHECK (
      validade_etiqueta_dias IS NULL
      OR validade_etiqueta_dias >= 0
    ),

  CONSTRAINT produtos_balancas_tara_check
    CHECK (
      tara_padrao IS NULL
      OR tara_padrao >= 0
    ),

  CONSTRAINT produtos_balancas_departamento_check
    CHECK (
      departamento IS NULL
      OR char_length(btrim(departamento)) BETWEEN 1 AND 40
    ),

  CONSTRAINT produtos_balancas_mensagem_check
    CHECK (
      mensagem IS NULL
      OR char_length(btrim(mensagem)) BETWEEN 1 AND 80
    )
);

COMMENT ON TABLE public.produtos_balancas IS
  'Dados gerais de balança do produto da empresa ativa, independentes da configuração. Preço permanece em produtos.preco_venda. O vínculo com cada balança fica em balancas_configuracoes_produtos.';

COMMENT ON COLUMN public.produtos_balancas.validade_etiqueta_dias IS
  'Validade impressa na etiqueta da balança, em dias. Não altera estoque_lotes nem controlar_validade.';

COMMENT ON COLUMN public.produtos_balancas.plu IS
  'Código PLU da balança, único dentro da empresa. O mesmo PLU pode existir em outra empresa.';

CREATE INDEX IF NOT EXISTS ix_produtos_balancas_empresa_produto
  ON public.produtos_balancas (empresa_id, produto_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_produtos_balancas_empresa_plu
  ON public.produtos_balancas (empresa_id, plu)
  WHERE plu IS NOT NULL AND btrim(plu) <> '';

CREATE TABLE IF NOT EXISTS public.balancas_configuracoes_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  balanca_configuracao_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  enviar_balanca boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT balancas_configuracoes_produtos_empresa_id_key
    UNIQUE (empresa_id, id),

  CONSTRAINT balancas_configuracoes_produtos_config_produto_key
    UNIQUE (balanca_configuracao_id, produto_id),

  CONSTRAINT balancas_configuracoes_produtos_empresa_fkey
    FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT balancas_configuracoes_produtos_config_empresa_fkey
    FOREIGN KEY (empresa_id, balanca_configuracao_id)
    REFERENCES public.balancas_configuracoes(empresa_id, id)
    ON DELETE CASCADE,

  CONSTRAINT balancas_configuracoes_produtos_produto_empresa_fkey
    FOREIGN KEY (empresa_id, produto_id)
    REFERENCES public.produtos(empresa_id, id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.balancas_configuracoes_produtos IS
  'Vínculo do produto com uma configuração de balança da mesma empresa. Não duplica PLU, descrição, preço nem validade.';

CREATE INDEX IF NOT EXISTS ix_balancas_configuracoes_produtos_empresa_config
  ON public.balancas_configuracoes_produtos (empresa_id, balanca_configuracao_id);

CREATE INDEX IF NOT EXISTS ix_balancas_configuracoes_produtos_empresa_produto
  ON public.balancas_configuracoes_produtos (empresa_id, produto_id);

CREATE OR REPLACE FUNCTION public.balancas_normalizar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'balancas_configuracoes' THEN
    NEW.nome := btrim(NEW.nome);
    NEW.modelo := nullif(btrim(COALESCE(NEW.modelo, '')), '');
    NEW.layout := nullif(btrim(COALESCE(NEW.layout, '')), '');
    IF NEW.configuracao IS NULL OR jsonb_typeof(NEW.configuracao) <> 'object' THEN
      NEW.configuracao := '{}'::jsonb;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'produtos_balancas' THEN
    NEW.plu := nullif(btrim(COALESCE(NEW.plu, '')), '');
    NEW.descricao_balanca := nullif(btrim(COALESCE(NEW.descricao_balanca, '')), '');
    NEW.departamento := nullif(btrim(COALESCE(NEW.departamento, '')), '');
    NEW.mensagem := nullif(btrim(COALESCE(NEW.mensagem, '')), '');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_balancas_configuracoes_normalizar
  ON public.balancas_configuracoes;
CREATE TRIGGER trg_balancas_configuracoes_normalizar
BEFORE INSERT OR UPDATE ON public.balancas_configuracoes
FOR EACH ROW
EXECUTE FUNCTION public.balancas_normalizar();

DROP TRIGGER IF EXISTS trg_produtos_balancas_normalizar
  ON public.produtos_balancas;
CREATE TRIGGER trg_produtos_balancas_normalizar
BEFORE INSERT OR UPDATE ON public.produtos_balancas
FOR EACH ROW
EXECUTE FUNCTION public.balancas_normalizar();

DROP TRIGGER IF EXISTS trg_balancas_configuracoes_updated_at
  ON public.balancas_configuracoes;
CREATE TRIGGER trg_balancas_configuracoes_updated_at
BEFORE UPDATE ON public.balancas_configuracoes
FOR EACH ROW
EXECUTE FUNCTION public.ultrapdv_set_updated_at();

DROP TRIGGER IF EXISTS trg_produtos_balancas_updated_at
  ON public.produtos_balancas;
CREATE TRIGGER trg_produtos_balancas_updated_at
BEFORE UPDATE ON public.produtos_balancas
FOR EACH ROW
EXECUTE FUNCTION public.ultrapdv_set_updated_at();

DROP TRIGGER IF EXISTS trg_balancas_configuracoes_produtos_updated_at
  ON public.balancas_configuracoes_produtos;
CREATE TRIGGER trg_balancas_configuracoes_produtos_updated_at
BEFORE UPDATE ON public.balancas_configuracoes_produtos
FOR EACH ROW
EXECUTE FUNCTION public.ultrapdv_set_updated_at();

ALTER TABLE public.balancas_configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos_balancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balancas_configuracoes_produtos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS balancas_configuracoes_select_empresa
  ON public.balancas_configuracoes;
CREATE POLICY balancas_configuracoes_select_empresa
ON public.balancas_configuracoes
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS balancas_configuracoes_insert_empresa
  ON public.balancas_configuracoes;
CREATE POLICY balancas_configuracoes_insert_empresa
ON public.balancas_configuracoes
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS balancas_configuracoes_update_empresa
  ON public.balancas_configuracoes;
CREATE POLICY balancas_configuracoes_update_empresa
ON public.balancas_configuracoes
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS balancas_configuracoes_delete_empresa
  ON public.balancas_configuracoes;
CREATE POLICY balancas_configuracoes_delete_empresa
ON public.balancas_configuracoes
FOR DELETE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS produtos_balancas_select_empresa
  ON public.produtos_balancas;
CREATE POLICY produtos_balancas_select_empresa
ON public.produtos_balancas
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS produtos_balancas_insert_empresa
  ON public.produtos_balancas;
CREATE POLICY produtos_balancas_insert_empresa
ON public.produtos_balancas
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS produtos_balancas_update_empresa
  ON public.produtos_balancas;
CREATE POLICY produtos_balancas_update_empresa
ON public.produtos_balancas
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS produtos_balancas_delete_empresa
  ON public.produtos_balancas;
CREATE POLICY produtos_balancas_delete_empresa
ON public.produtos_balancas
FOR DELETE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS balancas_configuracoes_produtos_select_empresa
  ON public.balancas_configuracoes_produtos;
CREATE POLICY balancas_configuracoes_produtos_select_empresa
ON public.balancas_configuracoes_produtos
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS balancas_configuracoes_produtos_insert_empresa
  ON public.balancas_configuracoes_produtos;
CREATE POLICY balancas_configuracoes_produtos_insert_empresa
ON public.balancas_configuracoes_produtos
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS balancas_configuracoes_produtos_update_empresa
  ON public.balancas_configuracoes_produtos;
CREATE POLICY balancas_configuracoes_produtos_update_empresa
ON public.balancas_configuracoes_produtos
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS balancas_configuracoes_produtos_delete_empresa
  ON public.balancas_configuracoes_produtos;
CREATE POLICY balancas_configuracoes_produtos_delete_empresa
ON public.balancas_configuracoes_produtos
FOR DELETE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.balancas_configuracoes FROM public, anon;
REVOKE ALL ON TABLE public.produtos_balancas FROM public, anon;
REVOKE ALL ON TABLE public.balancas_configuracoes_produtos FROM public, anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.balancas_configuracoes
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.produtos_balancas
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.balancas_configuracoes_produtos
  TO authenticated;

GRANT ALL ON TABLE public.balancas_configuracoes TO service_role;
GRANT ALL ON TABLE public.produtos_balancas TO service_role;
GRANT ALL ON TABLE public.balancas_configuracoes_produtos TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
