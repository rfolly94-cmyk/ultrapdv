-- Dados fiscais lidos na sessão da venda TEF do motor C#.
-- Não guarda comprovante, PAN nem referências de confirmação.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_motor_fiscal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  venda_id uuid NOT NULL REFERENCES public.vendas (id),
  chave text NOT NULL,
  modalidade text NOT NULL,
  valor_centavos integer NOT NULL,
  autorizacao text,
  bandeira_nome text,
  rede text,
  instituicao text,
  cnpj_credenciadora text,
  cnpj_recebedor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_motor_fiscal_modalidade_check CHECK (modalidade IN ('debito', 'credito')),
  CONSTRAINT tef_motor_fiscal_valor_check CHECK (valor_centavos > 0),
  CONSTRAINT tef_motor_fiscal_cnpj_credenciadora_check
    CHECK (cnpj_credenciadora IS NULL OR cnpj_credenciadora ~ '^[0-9]{14}$'),
  CONSTRAINT tef_motor_fiscal_cnpj_recebedor_check
    CHECK (cnpj_recebedor IS NULL OR cnpj_recebedor ~ '^[0-9]{14}$'),
  CONSTRAINT tef_motor_fiscal_empresa_chave_key UNIQUE (empresa_id, chave)
);

COMMENT ON TABLE public.tef_motor_fiscal IS
  'Autorização, bandeira e CNPJs lidos de PW_iGetResult na mesma sessão da venda. Não é o comprovante TEF.';

CREATE INDEX IF NOT EXISTS tef_motor_fiscal_venda_idx
  ON public.tef_motor_fiscal (empresa_id, venda_id);

ALTER TABLE public.tef_motor_fiscal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_motor_fiscal_select ON public.tef_motor_fiscal;
CREATE POLICY tef_motor_fiscal_select
  ON public.tef_motor_fiscal
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_motor_fiscal FROM anon, authenticated;
GRANT SELECT ON public.tef_motor_fiscal TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tef_motor_fiscal TO service_role;

COMMIT;
