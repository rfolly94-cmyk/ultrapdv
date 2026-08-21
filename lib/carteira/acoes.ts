import { normalizarStatusTitulo, tituloTemSaldo } from "./titulos";

export type AcaoVendaCarteira =
  | "ver_venda"
  | "receber"
  | "ver_recebimentos"
  | "cancelar_recebimento"
  | "cancelar_venda"
  | "ver_historico";

export function acoesPorEstadoVendaCarteira(input: {
  statusTitulo: string;
  valorAberto?: number;
  possuiRecebimentoEstornavel?: boolean;
}): AcaoVendaCarteira[] {
  const status = normalizarStatusTitulo(input.statusTitulo);

  if (status === "CANCELADO") {
    return ["ver_venda", "ver_historico"];
  }

  if (status === "QUITADO") {
    const acoes: AcaoVendaCarteira[] = [
      "ver_venda",
      "ver_recebimentos",
    ];
    if (input.possuiRecebimentoEstornavel !== false) {
      acoes.push("cancelar_recebimento");
    }
    acoes.push("cancelar_venda");
    return acoes;
  }

  if (tituloTemSaldo(status, input.valorAberto)) {
    return ["ver_venda", "receber", "cancelar_venda"];
  }

  return ["ver_venda"];
}

export function rotuloAcaoVendaCarteira(acao: AcaoVendaCarteira) {
  switch (acao) {
    case "ver_venda":
      return "Ver venda";
    case "receber":
      return "Receber";
    case "ver_recebimentos":
      return "Ver recebimentos";
    case "cancelar_recebimento":
      return "Cancelar recebimento";
    case "cancelar_venda":
      return "Cancelar venda";
    case "ver_historico":
      return "Ver histórico";
  }
}

export function acaoVendaCarteiraPerigosa(acao: AcaoVendaCarteira) {
  return acao === "cancelar_recebimento" || acao === "cancelar_venda";
}
