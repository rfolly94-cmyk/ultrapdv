export const STATUS_DEVOLUCAO_FORNECEDOR = [
  "rascunho",
  "pronta_para_verificacao",
  "pronta_para_emissao",
  "enviando",
  "aguardando_reconciliacao",
  "autorizada",
  "aguardando_saida",
  "concluida",
  "rejeitada",
  "cancelada",
] as const;

export type StatusDevolucaoFornecedor =
  (typeof STATUS_DEVOLUCAO_FORNECEDOR)[number];

export const MENSAGEM_CANCELAMENTO_DEVOLUCAO_COM_SAIDA =
  "Não é possível cancelar esta NF-e de devolução porque a saída de estoque já foi processada. O cancelamento fiscal não estorna automaticamente o estoque.";

export function bloqueioCancelamentoDevolucaoFornecedor(
  saidaEstoqueProcessadaAt?: string | null
) {
  return saidaEstoqueProcessadaAt
    ? MENSAGEM_CANCELAMENTO_DEVOLUCAO_COM_SAIDA
    : null;
}

const ROTULOS: Record<StatusDevolucaoFornecedor, string> = {
  rascunho: "Rascunho",
  pronta_para_verificacao: "Pronta para verificação",
  pronta_para_emissao: "Pronta para emissão",
  enviando: "Enviando",
  aguardando_reconciliacao: "Aguardando reconciliação",
  autorizada: "Autorizada",
  aguardando_saida: "Aguardando saída",
  concluida: "Concluída",
  rejeitada: "Rejeitada",
  cancelada: "Cancelada",
};

export function rotuloStatusDevolucaoFornecedor(status: string) {
  return ROTULOS[status as StatusDevolucaoFornecedor] ?? status;
}

export function devolucaoReservaSaldo(status: string) {
  return status !== "cancelada" && status !== "rejeitada";
}

export function devolucaoContaComoDevolvida(status: string) {
  return (
    status === "autorizada" ||
    status === "aguardando_saida" ||
    status === "concluida"
  );
}

export function devolucaoPodeEditar(status: string) {
  return (
    status === "rascunho" ||
    status === "pronta_para_verificacao" ||
    status === "pronta_para_emissao" ||
    status === "rejeitada"
  );
}

export function devolucaoPodeEmitir(status: string) {
  return status === "pronta_para_emissao" || status === "rejeitada";
}

export function devolucaoPodeConfirmarSaida(status: string) {
  return status === "autorizada" || status === "aguardando_saida";
}

export function quantidadeJaDevolvida(params: {
  quantidadeEntradaEfetivada: number;
  reservas: Array<{ quantidade: number; status: string }>;
  modo?: "reservada" | "efetivada";
}) {
  const modo = params.modo ?? "reservada";
  return params.reservas.reduce((total, reserva) => {
    const conta =
      modo === "efetivada"
        ? devolucaoContaComoDevolvida(reserva.status)
        : devolucaoReservaSaldo(reserva.status);
    return conta ? total + Number(reserva.quantidade ?? 0) : total;
  }, 0);
}

export function saldoDevolvivelItem(params: {
  quantidadeEntradaEfetivada: number;
  reservas: Array<{ quantidade: number; status: string }>;
}) {
  const efetivada = Number(params.quantidadeEntradaEfetivada ?? 0);
  const reservada = quantidadeJaDevolvida({
    ...params,
    modo: "reservada",
  });
  const saldo = efetivada - reservada;
  return saldo > 0 ? saldo : 0;
}
