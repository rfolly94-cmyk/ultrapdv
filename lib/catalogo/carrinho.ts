import type { CatalogoCarrinhoItem } from "@/lib/catalogo/tipos";
import { CATALOGO_ITENS_MAX, CATALOGO_QTD_MAX } from "@/lib/catalogo/regras";

export const CARRINHO_VAZIO: CatalogoCarrinhoItem[] = [];

const cache = new Map<
  string,
  { bruto: string | null; itens: CatalogoCarrinhoItem[] }
>();

export function chaveCarrinho(slug: string) {
  return `ultrapdv.catalogo.carrinho.${slug}`;
}

function parseCarrinho(bruto: string | null): CatalogoCarrinhoItem[] {
  if (!bruto) {
    return CARRINHO_VAZIO;
  }

  try {
    const parsed = JSON.parse(bruto) as CatalogoCarrinhoItem[];

    if (!Array.isArray(parsed)) {
      return CARRINHO_VAZIO;
    }

    const itens = parsed.filter(
      (item) =>
        item &&
        typeof item.produtoId === "string" &&
        typeof item.quantidade === "number" &&
        item.quantidade > 0
    );

    return itens.length === 0 ? CARRINHO_VAZIO : itens;
  } catch {
    return CARRINHO_VAZIO;
  }
}

export function snapshotCarrinho(slug: string): CatalogoCarrinhoItem[] {
  if (typeof window === "undefined") {
    return CARRINHO_VAZIO;
  }

  const bruto = window.localStorage.getItem(chaveCarrinho(slug));
  const atual = cache.get(slug);

  if (atual && atual.bruto === bruto) {
    return atual.itens;
  }

  const itens = parseCarrinho(bruto);
  cache.set(slug, { bruto, itens });
  return itens;
}

export function lerCarrinho(slug: string): CatalogoCarrinhoItem[] {
  return snapshotCarrinho(slug);
}

export function gravarCarrinho(
  slug: string,
  itens: CatalogoCarrinhoItem[]
) {
  if (typeof window === "undefined") {
    return;
  }

  const bruto = JSON.stringify(itens);
  window.localStorage.setItem(chaveCarrinho(slug), bruto);
  cache.set(slug, {
    bruto,
    itens: itens.length === 0 ? CARRINHO_VAZIO : itens,
  });
}

export function adicionarAoCarrinho(
  itens: CatalogoCarrinhoItem[],
  novo: CatalogoCarrinhoItem
) {
  const existente = itens.find(
    (item) => item.produtoId === novo.produtoId
  );

  if (existente) {
    return itens.map((item) =>
      item.produtoId === novo.produtoId
        ? {
            ...item,
            quantidade: Math.min(
              CATALOGO_QTD_MAX,
              item.quantidade + novo.quantidade
            ),
          }
        : item
    );
  }

  if (itens.length >= CATALOGO_ITENS_MAX) {
    throw new Error("O carrinho atingiu o limite de itens.");
  }

  return [...itens, novo];
}

export function alterarQuantidadeCarrinho(
  itens: CatalogoCarrinhoItem[],
  produtoId: string,
  quantidade: number
) {
  if (quantidade <= 0) {
    return itens.filter((item) => item.produtoId !== produtoId);
  }

  return itens.map((item) =>
    item.produtoId === produtoId
      ? {
          ...item,
          quantidade: Math.min(CATALOGO_QTD_MAX, quantidade),
        }
      : item
  );
}

export function totalCarrinho(itens: CatalogoCarrinhoItem[]) {
  return itens.reduce((soma, item) => {
    if (!item.mostrarPreco || item.preco === null) {
      return soma;
    }

    return soma + item.preco * item.quantidade;
  }, 0);
}

export function carrinhoTemItemSemPreco(itens: CatalogoCarrinhoItem[]) {
  return itens.some((item) => !item.mostrarPreco || item.preco === null);
}
