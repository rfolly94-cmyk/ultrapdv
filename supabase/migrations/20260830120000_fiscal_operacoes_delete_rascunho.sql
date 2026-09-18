BEGIN;

-- Permite excluir rascunho de NF-e (fiscal_operacoes) da empresa do usuário.
-- Itens já tinham DELETE; a operação não. Isolamento: tem_acesso_empresa.
-- Só status de rascunho, sem saída/recebimento de estoque já processados.

DROP POLICY IF EXISTS fiscal_operacoes_delete_empresa ON public.fiscal_operacoes;

CREATE POLICY fiscal_operacoes_delete_empresa
  ON public.fiscal_operacoes
  FOR DELETE
  USING (
    public.tem_acesso_empresa(empresa_id)
    AND status IN (
      'rascunho',
      'pronta_para_verificacao',
      'pronta_para_emissao'
    )
    AND saida_estoque_processada_at IS NULL
    AND recebimento_processado_at IS NULL
  );

COMMIT;
