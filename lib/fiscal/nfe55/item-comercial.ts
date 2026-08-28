import { unidadePermiteDecimal } from "@/lib/produtos/unidades-medida";

export const MENSAGEM_QUANTIDADE_ITEM_NFE =
  "Informe uma quantidade maior que zero.";
export const MENSAGEM_QUANTIDADE_INTEIRA_ITEM_NFE =
  "Esta unidade não permite quantidade decimal.";
export const MENSAGEM_PRECO_NEGATIVO_ITEM_NFE =
  "O preço unitário não pode ser negativo.";

export function parseNumeroComercialNfe(texto: string) {
  let valor = String(texto ?? "").trim();
  if (!valor) {
    return null;
  }
  if (valor.includes(".") && valor.includes(",")) {
    valor = valor.replace(/\./g, "").replace(",", ".");
  } else if (valor.includes(",")) {
    valor = valor.replace(",", ".");
  }
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    return null;
  }
  return numero;
}

export function arredondarQuantidadeItemNfe(quantidade: number) {
  return Math.round(quantidade * 10000) / 10000;
}

export function arredondarPrecoItemNfe(valor: number) {
  return Math.round(valor * 100) / 100;
}

export function totalItemNfe(quantidade: number, valorUnitario: number) {
  return arredondarPrecoItemNfe(
    arredondarQuantidadeItemNfe(quantidade) * arredondarPrecoItemNfe(valorUnitario)
  );
}

export function formatarQuantidadeItemNfe(
  quantidade: number,
  unidade?: string | null
) {
  const casas = unidadePermiteDecimal(unidade) ? 4 : 0;
  const valor = arredondarQuantidadeItemNfe(quantidade);
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
    useGrouping: false,
  });
}

export function formatarPrecoItemNfe(valor: number) {
  return arredondarPrecoItemNfe(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

export function validarQuantidadeItemNfe(input: {
  quantidade: number | null;
  unidade?: string | null;
}): { ok: true; quantidade: number } | { ok: false; erro: string } {
  const quantidade = Number(input.quantidade);
  if (!Number.isFinite(quantidade) || !(quantidade > 0)) {
    return { ok: false, erro: MENSAGEM_QUANTIDADE_ITEM_NFE };
  }
  const arredondada = arredondarQuantidadeItemNfe(quantidade);
  if (
    !unidadePermiteDecimal(input.unidade) &&
    Math.abs(arredondada - Math.round(arredondada)) > 0.00005
  ) {
    return { ok: false, erro: MENSAGEM_QUANTIDADE_INTEIRA_ITEM_NFE };
  }
  return { ok: true, quantidade: arredondada };
}

export function validarValorUnitarioItemNfe(
  valor: number | null
): { ok: true; valorUnitario: number } | { ok: false; erro: string } {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    return { ok: false, erro: MENSAGEM_PRECO_NEGATIVO_ITEM_NFE };
  }
  return { ok: true, valorUnitario: arredondarPrecoItemNfe(numero) };
}

/** Estoque é informação. Nunca impede incluir ou alterar item da NF-e. */
export function estoqueImpedeItemNfe(
  _estoqueDisponivel: number,
  _quantidade: number
) {
  return false;
}

export function produtoVisivelNaBuscaNfe(input: {
  ativo?: boolean | null;
  estoque?: number | null;
}) {
  void input.estoque;
  return input.ativo !== false;
}

export function mesclarSnapshotItemComercial(
  atual: unknown,
  extra: {
    quantidade: number;
    valor_unitario: number;
    valor_total: number;
  }
): Record<string, unknown> {
  const base =
    atual && typeof atual === "object" && !Array.isArray(atual)
      ? { ...(atual as Record<string, unknown>) }
      : {};
  return {
    ...base,
    quantidade: extra.quantidade,
    valor_unitario: extra.valor_unitario,
    valor_total: extra.valor_total,
  };
}
