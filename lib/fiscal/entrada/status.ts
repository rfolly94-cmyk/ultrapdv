export const STATUS_ENTRADA = [
  "importada",
  "aguardando_vinculacao",
  "aguardando_conferencia",
  "pronta_para_entrada",
  "processando_entrada",
  "entrada_concluida",
  "cancelada",
] as const;

export type StatusDocumentoEntrada = (typeof STATUS_ENTRADA)[number];

const ROTULOS: Record<StatusDocumentoEntrada, string> = {
  importada: "Importada",
  aguardando_vinculacao: "Aguardando vinculação",
  aguardando_conferencia: "Aguardando conferência",
  pronta_para_entrada: "Pronta para entrada",
  processando_entrada: "Processando entrada",
  entrada_concluida: "Entrada concluída",
  cancelada: "Cancelada",
};

export function rotuloStatusEntrada(status: string) {
  return ROTULOS[status as StatusDocumentoEntrada] ?? status;
}

export function documentoEntradaPodeEditar(status: string) {
  return (
    status !== "entrada_concluida" &&
    status !== "processando_entrada" &&
    status !== "cancelada"
  );
}

export function entradaFoiEfetivada(params: {
  quantidadeEntradaEfetivada?: number | null;
}) {
  return Number(params.quantidadeEntradaEfetivada ?? 0) > 0;
}

export function statusEntradaExibido(params: {
  status: string;
  temMovimentoEstoque?: boolean;
  temQuantidadeEfetivada?: boolean;
}) {
  if (params.status === "cancelada") {
    return params.status;
  }
  if (params.temMovimentoEstoque || params.temQuantidadeEfetivada) {
    return "entrada_concluida";
  }
  return params.status;
}

export function documentoEntradaPodeConfirmar(status: string) {
  return (
    status === "aguardando_conferencia" ||
    status === "pronta_para_entrada" ||
    status === "aguardando_vinculacao"
  );
}

export type ItemParaStatus = {
  produto_id?: string | null;
  quantidade_xml: number;
  quantidade_recebida: number;
};

export function statusAposItens(itens: ItemParaStatus[]): StatusDocumentoEntrada {
  const movimentaveis = itens.filter((item) => item.quantidade_recebida > 0);

  if (movimentaveis.some((item) => !item.produto_id)) {
    return "aguardando_vinculacao";
  }

  if (movimentaveis.length === 0) {
    return "aguardando_vinculacao";
  }

  const divergente = itens.some(
    (item) => Number(item.quantidade_recebida) !== Number(item.quantidade_xml)
  );

  return divergente ? "aguardando_conferencia" : "pronta_para_entrada";
}

export function ncmDivergente(
  ncmNota?: string | null,
  ncmCadastro?: string | null
) {
  const nota = String(ncmNota ?? "").replace(/\D/g, "");
  const cadastro = String(ncmCadastro ?? "").replace(/\D/g, "");
  if (!nota || !cadastro) {
    return false;
  }
  return nota !== cadastro;
}

export function saldoDevolvivel(params: {
  quantidadeEntradaEfetivada?: number | null;
  quantidadeJaDevolvida?: number | null;
}) {
  const efetivada = Number(params.quantidadeEntradaEfetivada ?? 0);
  const devolvida = Number(params.quantidadeJaDevolvida ?? 0);
  const saldo = efetivada - devolvida;
  return saldo > 0 ? saldo : 0;
}
