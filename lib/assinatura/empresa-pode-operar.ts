import type { AssinaturaEmpresa, StatusAssinatura } from "./tipos";
import { STATUS_ASSINATURA } from "./tipos";

export function statusAssinaturaValido(
  valor: unknown
): valor is StatusAssinatura {
  return STATUS_ASSINATURA.includes(String(valor ?? "") as StatusAssinatura);
}

export function dataAssinatura(valor: string | Date | null | undefined) {
  if (!valor) {
    return null;
  }
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }
  const texto = String(valor);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(texto)
    ? new Date(`${texto}T23:59:59.999-03:00`)
    : new Date(texto);
  if (Number.isNaN(data.getTime())) {
    return null;
  }
  return data;
}

export function liberacaoTemporariaValida(
  liberadoAte: string | Date | null | undefined,
  agora = new Date()
) {
  const data = dataAssinatura(liberadoAte);
  return Boolean(data && data.getTime() > agora.getTime());
}

export function carenciaValida(
  status: string | null | undefined,
  carenciaAte: string | Date | null | undefined,
  agora = new Date()
) {
  if (status !== "carencia") {
    return false;
  }
  const data = dataAssinatura(carenciaAte);
  if (!data) {
    return false;
  }
  return data.getTime() >= agora.getTime();
}

export function erroSchemaAssinaturaAusente(mensagem: string | null | undefined) {
  const texto = String(mensagem ?? "");
  return (
    /assinaturas_empresas/i.test(texto) &&
    /does not exist|schema cache|could not find/i.test(texto)
  );
}

export function empresaPodeOperar(
  assinatura: Pick<
    AssinaturaEmpresa,
    "status" | "carencia_ate" | "liberado_ate"
  > | null,
  agora = new Date()
) {
  if (!assinatura) {
    return false;
  }

  const status = String(assinatura.status ?? "");

  if (status === "cancelada") {
    return false;
  }

  if (status === "trial" || status === "ativa") {
    return true;
  }

  if (carenciaValida(status, assinatura.carencia_ate, agora)) {
    return true;
  }

  if (
    status === "suspensa" &&
    liberacaoTemporariaValida(assinatura.liberado_ate, agora)
  ) {
    return true;
  }

  return false;
}

export function assinaturaBloqueiaOperacao(
  assinatura: Pick<
    AssinaturaEmpresa,
    "status" | "carencia_ate" | "liberado_ate"
  > | null,
  error: { message?: string } | null | undefined,
  agora = new Date()
) {
  if (erroSchemaAssinaturaAusente(error?.message)) {
    return false;
  }
  if (error) {
    return true;
  }
  return !empresaPodeOperar(assinatura, agora);
}

export function rotuloStatusAssinatura(
  assinatura: Pick<
    AssinaturaEmpresa,
    "status" | "liberado_ate" | "carencia_ate"
  > | null,
  agora = new Date()
) {
  if (!assinatura) {
    return "Sem assinatura";
  }

  const status = String(assinatura.status ?? "ativa");
  const temporaria = liberacaoTemporariaValida(assinatura.liberado_ate, agora);

  if (status === "suspensa" && temporaria) {
    return "Suspensa — liberação temporária";
  }

  if (status === "carencia") {
    return carenciaValida(status, assinatura.carencia_ate, agora)
      ? "Carência"
      : "Carência expirada";
  }

  const mapa: Record<string, string> = {
    trial: "Trial",
    ativa: "Ativa",
    suspensa: "Suspensa",
    cancelada: "Cancelada",
  };

  return mapa[status] ?? status;
}
