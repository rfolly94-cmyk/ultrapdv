export const MENSAGEM_XML_INVALIDO =
  "O arquivo não é um XML de NF-e válido.";

export const MENSAGEM_NFE_JA_IMPORTADA =
  "Esta NF-e já foi importada para esta empresa.";

export const MENSAGEM_DESTINATARIO_DIVERGENTE =
  "A NF-e não é destinada ao CNPJ da empresa ativa.";

export const MENSAGEM_ENTRADA_JA_PROCESSADA =
  "Esta NF-e já teve a entrada de estoque processada.";

export const MENSAGEM_PRODUTO_OUTRA_EMPRESA =
  "O produto não pertence à empresa ativa.";

export const MENSAGEM_DOCUMENTO_OUTRA_EMPRESA =
  "O documento de entrada não pertence à empresa ativa.";

export const MENSAGEM_ITENS_SEM_VINCULO =
  "Vincule todos os itens com quantidade recebida a um produto da empresa ativa.";

export const MENSAGEM_VINCULO_FORNECEDOR_OUTRA_EMPRESA =
  "O vínculo fornecedor-produto não pertence à empresa ativa.";

export const MENSAGEM_VINCULO_CONFLITANTE =
  "Este código do fornecedor já está vinculado a outro produto. Confirme se deseja alterar o vínculo.";

export const MENSAGEM_FATOR_CONVERSAO_OBRIGATORIO =
  "A unidade da NF-e é diferente da unidade do produto. Configure o fator de conversão antes de confirmar a entrada.";

export const MENSAGEM_DFE_EM_DESENVOLVIMENTO =
  "Buscar documentos recebidos ainda está em desenvolvimento.";

export const MENSAGEM_DEVOLUCAO_ENTRADA_NAO_PROCESSADA =
  "Só é possível devolver itens de uma NF-e de entrada já processada.";

export const MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE =
  "A quantidade a devolver excede o saldo devolvível deste item.";

export const MENSAGEM_DEVOLUCAO_SAIDA_JA_PROCESSADA =
  "A saída desta devolução já foi processada.";

export const MENSAGEM_DEVOLUCAO_NFE_NAO_AUTORIZADA =
  "A saída só pode ser confirmada depois que a NF-e de devolução estiver autorizada.";
