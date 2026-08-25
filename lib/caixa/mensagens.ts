export const MENSAGEM_CAIXA_FECHADO_PDV =
  "Caixa fechado. Abra o caixa para operar o PDV. Vendas em PIX, crédito ou débito também precisam de uma sessão de caixa para conferência.";

export const MENSAGEM_CAIXA_FECHADO_NFE_VENDA =
  "Abra o caixa antes de realizar esta venda.";

export const MENSAGEM_CAIXA_FECHADO_FINALIZAR =
  "O caixa foi fechado. Abra um caixa para continuar.";

export const MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO =
  "É necessário solicitar a abertura do caixa a um responsável.";

export const MENSAGEM_CONFERENCIA_DESATUALIZADA =
  "O caixa recebeu novas movimentações. Atualize a conferência antes de fechar.";

export const MENSAGEM_FECHAMENTO_EXIGE_CONFERENCIA =
  "O fechamento exige conferência por meio de pagamento.";

export const MENSAGEM_MOTIVO_REABERTURA =
  "Informe o motivo da reabertura com pelo menos 8 caracteres.";

export const MENSAGEM_REABRIR_ULTIMO_FECHADO =
  "Só é possível reabrir o último caixa fechado desta empresa.";

export const MENSAGEM_REABRIR_COM_ABERTO =
  "Já existe um caixa aberto para esta empresa.";

export const MENSAGEM_REABRIR_NAO_FECHADO =
  "Só é possível reabrir um caixa fechado.";

export function mensagemErroCaixaOperacao(erro: unknown) {
  const texto =
    erro instanceof Error
      ? erro.message
      : typeof erro === "string"
        ? erro
        : "";
  if (/O caixa foi fechado/i.test(texto)) {
    return MENSAGEM_CAIXA_FECHADO_FINALIZAR;
  }
  if (/novas movimentações/i.test(texto)) {
    return MENSAGEM_CONFERENCIA_DESATUALIZADA;
  }
  return String(texto ?? "").trim();
}
