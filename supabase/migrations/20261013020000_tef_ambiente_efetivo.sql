-- Comprovação do ambiente efetivo de cada transação TEF.
-- Aplicar este arquivo cria colunas vazias e uma tabela de sinalização.
-- Não cancela NFC-e, não estorna, não altera vendas e não muda o status das operações já gravadas.

BEGIN;

ALTER TABLE public.tef_operacoes
  ADD COLUMN IF NOT EXISTS ambiente_efetivo text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ponto_efetivo text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS host_efetivo text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS comprovante_sha256 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS motivo_ambiente text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_operacoes_ambiente_efetivo_check'
  ) THEN
    ALTER TABLE public.tef_operacoes
      ADD CONSTRAINT tef_operacoes_ambiente_efetivo_check
      CHECK (ambiente_efetivo IN ('', 'producao', 'homologacao', 'desconhecido'));
  END IF;
END $$;

COMMENT ON COLUMN public.tef_operacoes.ambiente_efetivo IS
  'Ambiente comprovado pela transação. Vazio significa desconhecido e não autoriza NFC-e de produção.';

CREATE TABLE IF NOT EXISTS public.tef_ocorrencias_simuladas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  operacao_id uuid,
  emissao_id uuid,
  numero_nfce integer NOT NULL,
  serie integer NOT NULL,
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_ocorrencias_simuladas_emissao_key UNIQUE (emissao_id)
);

COMMENT ON TABLE public.tef_ocorrencias_simuladas IS
  'Sinaliza pagamento TEF simulado. Não substitui a NFC-e, a venda nem a operação.';

INSERT INTO public.tef_ocorrencias_simuladas (
  empresa_id,
  operacao_id,
  emissao_id,
  numero_nfce,
  serie,
  motivo
)
SELECT DISTINCT ON (e.id)
  e.empresa_id,
  o.id,
  e.id,
  e.numero,
  e.serie,
  'Pagamento TEF simulado em ambiente PayGo sandbox, sem valor financeiro. Este registro apenas sinaliza a ocorrência.'
FROM public.fiscal_emissoes e
LEFT JOIN public.tef_operacoes o
  ON o.empresa_id = e.empresa_id
 AND o.venda_id = e.origem_id
 AND o.id IN (
   '46d11804-d468-4765-b8cd-3c05fa1e788d',
   'ac349db1-9e33-4edf-86e5-b0b031b2e299',
   '3d03ef28-5a89-478f-bc71-c05ece203a0b'
 )
WHERE e.id IN (
  'da9bfd49-8033-4e7d-9d90-3f45302117d3',
  '094e24a7-84ac-4f4b-84c3-89a4de32ffe6',
  '13bd2a21-6549-4585-9028-cdf7ce72a1b4'
)
ORDER BY e.id
ON CONFLICT (emissao_id) DO NOTHING;

ALTER TABLE public.tef_ocorrencias_simuladas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_ocorrencias_simuladas_select_empresa ON public.tef_ocorrencias_simuladas;
CREATE POLICY tef_ocorrencias_simuladas_select_empresa
  ON public.tef_ocorrencias_simuladas
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_ocorrencias_simuladas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tef_ocorrencias_simuladas TO authenticated;
GRANT SELECT, INSERT ON public.tef_ocorrencias_simuladas TO service_role;

COMMIT;
