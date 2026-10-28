export type FaseCapturaPagamento = "menu" | "digitado" | "pinpad" | "qrcode" | "exibicao";

export type NavegacaoPagamentoTef =
  | { acao: "voltar" }
  | { acao: "cancelar-interacao" }
  | { acao: "aguardar"; mensagem: string }
  | { acao: "bloquear-confirmada"; mensagem: string };

const MENSAGEM_AUTORIZADA =
  "O pagamento já foi autorizado. Voltar não cancela a venda. Nenhuma nova cobrança foi iniciada.";

const MENSAGEM_DESCONHECIDA =
  "O resultado desta operação ainda é desconhecido. Aguarde a recuperação. Nenhuma nova cobrança foi iniciada.";

const MENSAGEM_ANDAMENTO =
  "Há uma operação TEF em andamento. Aguarde o resultado. Nenhuma nova cobrança foi iniciada.";

export function decidirNavegacaoPagamentoTef(input: {
  fase: FaseCapturaPagamento | null;
  pagamentoConfirmado: boolean;
  estado: string;
}): NavegacaoPagamentoTef {
  if (input.pagamentoConfirmado || input.estado === "aguardando_confirmacao" || input.estado === "confirmada") {
    return { acao: "bloquear-confirmada", mensagem: MENSAGEM_AUTORIZADA };
  }
  if (input.estado === "resultado_desconhecido") {
    return { acao: "aguardar", mensagem: MENSAGEM_DESCONHECIDA };
  }
  if (input.fase === "pinpad" || input.fase === "menu" || input.fase === "digitado" || input.fase === "qrcode" || input.fase === "exibicao") {
    return { acao: "cancelar-interacao" };
  }
  if (input.estado === "executando" || input.estado === "autorizada_para_execucao") {
    return { acao: "aguardar", mensagem: MENSAGEM_ANDAMENTO };
  }
  return { acao: "voltar" };
}
