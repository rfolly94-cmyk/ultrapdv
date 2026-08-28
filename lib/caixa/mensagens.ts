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

export const MENSAGEM_CONTROLE_CAIXA_DESATIVADO =
  "Controle de Caixa desativado";

export const MENSAGEM_CONTROLE_CAIXA_DESATIVADO_DETALHE =
  "As vendas e recebimentos atuais não estão sendo vinculados a uma sessão de Caixa.";

export const MENSAGEM_CONTROLE_CAIXA_DESATIVADO_OPERACAO =
  "O controle de Caixa está desativado. Não é possível abrir ou movimentar uma sessão.";

export const MENSAGEM_CONTROLE_CAIXA_ATIVADO =
  "Controle de Caixa ativado. Abra um Caixa antes de realizar novas vendas.";

export const MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR =
  "Não é possível desativar o controle de Caixa enquanto houver um Caixa aberto. Feche a sessão atual primeiro.";

export const MENSAGEM_GAVETA_CAIXA_FECHADO =
  "Abra o Caixa para solicitar a abertura da gaveta.";

export const MENSAGEM_GAVETA_ABERTA =
  "Gaveta aberta com sucesso";

export const MENSAGEM_GAVETA_VENDA_SEM_ABRIR =
  "Venda concluída, mas não foi possível abrir a gaveta.";


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
