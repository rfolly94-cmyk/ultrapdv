import { normalizarStatusTitulo } from "./titulos";

export type ItemCarteiraParaCancelar = {
  id: string;
  titulo_id: string;
  venda_id?: string | null;
  venda_item_id?: string | null;
  produto_nome: string;
  quantidade: number | string;
  valor_original: number | string;
  valor_aberto: number | string;
  status: string;
};

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function arred(valor: number) {
  return Math.round(valor * 100) / 100;
}

export function itemCarteiraCancelavel(status: string) {
  return normalizarStatusTitulo(status) !== "CANCELADO";
}

export function pagoAlocadoDoItem(input: {
  valorOriginal: number | string;
  valorAberto: number | string;
  alocadoAtivo: number | string;
}):
  | { ok: true; pago: number }
  | { ok: false; erro: string } {
  const original = arred(numero(input.valorOriginal));
  const aberto = arred(numero(input.valorAberto));
  const alocado = arred(numero(input.alocadoAtivo));

  if (Math.abs(alocado + aberto - original) > 0.009) {
    return {
      ok: false,
      erro:
        "Não há vínculo seguro entre o recebimento e o item selecionado. O cancelamento foi bloqueado para não inventar um rateio.",
    };
  }

  return { ok: true, pago: alocado };
}

export function conferirItensMesmaVenda(itens: Array<{ venda_id?: string | null }>) {
  const ids = Array.from(
    new Set(itens.map((item) => String(item.venda_id ?? "")).filter(Boolean))
  );
  if (ids.length === 0) {
    return { ok: false as const, erro: "Itens sem venda vinculada." };
  }
  if (ids.length > 1) {
    return {
      ok: false as const,
      erro: "Selecione itens de uma única venda para cancelar.",
    };
  }
  return { ok: true as const, vendaId: ids[0] };
}

export function todosItensAtivosSelecionados(input: {
  itensDaVenda: ItemCarteiraParaCancelar[];
  selecionadosIds: string[];
}) {
  const ativos = input.itensDaVenda.filter((item) =>
    itemCarteiraCancelavel(item.status)
  );
  if (!ativos.length) {
    return false;
  }
  const selecionados = new Set(input.selecionadosIds);
  return ativos.every((item) => selecionados.has(item.id));
}

export function vendaJaTeveCancelamentoParcial(
  itensDaVenda: Array<{ status: string }>
) {
  return itensDaVenda.some(
    (item) => normalizarStatusTitulo(item.status) === "CANCELADO"
  );
}

export function resumoValoresCancelamentoItens(input: {
  valorOriginalVenda: number | string;
  valorAbertoVenda: number | string;
  selecionados: Array<{
    valor_original: number | string;
    valor_aberto: number | string;
  }>;
}) {
  const abertoSelecionado = arred(
    input.selecionados.reduce((total, item) => total + numero(item.valor_aberto), 0)
  );
  const originalSelecionado = arred(
    input.selecionados.reduce(
      (total, item) => total + numero(item.valor_original),
      0
    )
  );
  const abertoVenda = arred(numero(input.valorAbertoVenda));
  return {
    valorOriginalVenda: arred(numero(input.valorOriginalVenda)),
    valorSelecionadoOriginal: originalSelecionado,
    valorSelecionadoAberto: abertoSelecionado,
    valorPermaneceraAberto: arred(Math.max(0, abertoVenda - abertoSelecionado)),
  };
}

export function itensEmAbertoParaImpressao<
  T extends { status: string; valor_aberto: number | string },
>(itens: T[]) {
  return itens.filter(
    (item) =>
      itemCarteiraCancelavel(item.status) && numero(item.valor_aberto) > 0.009
  );
}
