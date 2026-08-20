import type { StatusCobrancaPix } from "./types";

export function statusAposRespostaHttp({
  httpStatus,
  situacao,
  pago,
  cancelado,
  statusAtual,
  operacao,
}: {
  httpStatus: number;
  situacao?: string | null;
  pago: boolean;
  cancelado: boolean;
  statusAtual: StatusCobrancaPix;
  operacao: "emitir" | "consultar" | "cancelar";
}): StatusCobrancaPix {
  if (httpStatus >= 500) {
    return statusAtual === "paga" ? "paga" : statusAtual;
  }

  if (httpStatus >= 400) {
    if (operacao === "emitir" && statusAtual !== "paga") {
      return "erro";
    }

    return statusAtual === "paga" ? "paga" : statusAtual;
  }

  if (pago) {
    return "paga";
  }

  if (cancelado && statusAtual !== "paga") {
    return "cancelada";
  }

  if (operacao === "cancelar" && statusAtual === "paga") {
    return "paga";
  }

  if (operacao === "cancelar" && situacao === "sucesso") {
    return "cancelada";
  }

  if (operacao === "emitir" && situacao === "sucesso") {
    return "pendente";
  }

  return statusAtual;
}

export function podeCancelarLocalmente(status: StatusCobrancaPix) {
  return status === "pendente" || status === "erro";
}
