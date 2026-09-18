import { snapshotTributarioItemCompleto } from "@/lib/fiscal/snapshot-tributario-venda";
import { centavosDeTextoPagamento } from "@/lib/fiscal/nfe55/sincronizar-pagamentos";

export const ORIGEM_ITEM_PRODUTO = "produto";
export const ORIGEM_ITEM_AVULSO = "avulso";

export const MENSAGEM_ITEM_AVULSO_SEM_CONFIG_FISCAL =
  "Item avulso sem configuração fiscal. Configure o produto fiscal padrão para item avulso antes de emitir NF-e/NFC-e.";

export const MENSAGEM_ITEM_AVULSO_DESABILITADO =
  "A venda de item avulso não está permitida para esta empresa.";

export const MENSAGEM_ITEM_AVULSO_DESCRICAO =
  "Informe a descrição do item avulso.";

export const MENSAGEM_ITEM_AVULSO_QUANTIDADE =
  "A quantidade do item avulso deve ser maior que zero.";

export const MENSAGEM_ITEM_AVULSO_VALOR =
  "O valor unitário do item avulso deve ser maior que zero.";

export type OrigemItemPdv =
  | typeof ORIGEM_ITEM_PRODUTO
  | typeof ORIGEM_ITEM_AVULSO;

export function origemItemPdv(valor: unknown): OrigemItemPdv {
  const texto = String(valor ?? "")
    .trim()
    .toLowerCase();
  if (texto === ORIGEM_ITEM_AVULSO || texto === "item_avulso") {
    return ORIGEM_ITEM_AVULSO;
  }
  return ORIGEM_ITEM_PRODUTO;
}

export function itemVendaEhAvulso(item: {
  origem_item?: unknown;
  origem?: unknown;
  produto_id?: unknown;
  produtoId?: unknown;
}): boolean {
  const origem = origemItemPdv(item.origem_item ?? item.origem);
  if (origem === ORIGEM_ITEM_AVULSO) {
    return true;
  }
  if (String(item.origem_item ?? item.origem ?? "").trim()) {
    return false;
  }
  return !String(item.produto_id ?? item.produtoId ?? "").trim();
}

export function parseQuantidadeAvulso(texto: string): number | null {
  let bruto = String(texto ?? "").trim();
  if (!bruto) {
    return null;
  }
  if (bruto.includes(".") && bruto.includes(",")) {
    bruto = bruto.replace(/\./g, "").replace(",", ".");
  } else if (bruto.includes(",")) {
    bruto = bruto.replace(",", ".");
  }
  const numero = Number(bruto);
  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }
  return numero;
}

export function parseValorUnitarioAvulsoCentavos(texto: string): number | null {
  const centavos = centavosDeTextoPagamento(texto);
  if (centavos <= 0) {
    return null;
  }
  return centavos;
}

export function validarFormularioItemAvulso(input: {
  descricao: string;
  quantidadeTexto: string;
  valorUnitarioTexto: string;
}):
  | {
      ok: true;
      descricao: string;
      quantidade: number;
      valorUnitarioCentavos: number;
    }
  | { ok: false; erro: string } {
  const descricao = String(input.descricao ?? "").trim();
  if (!descricao) {
    return { ok: false, erro: MENSAGEM_ITEM_AVULSO_DESCRICAO };
  }

  const quantidade = parseQuantidadeAvulso(input.quantidadeTexto);
  if (quantidade == null) {
    return { ok: false, erro: MENSAGEM_ITEM_AVULSO_QUANTIDADE };
  }

  const valorUnitarioCentavos = parseValorUnitarioAvulsoCentavos(
    input.valorUnitarioTexto
  );
  if (valorUnitarioCentavos == null) {
    return { ok: false, erro: MENSAGEM_ITEM_AVULSO_VALOR };
  }

  return {
    ok: true,
    descricao,
    quantidade,
    valorUnitarioCentavos,
  };
}

export function mensagemEmissaoItemAvulsoSemFiscal(item: {
  origem_item?: unknown;
  origem?: unknown;
  produto_id?: unknown;
  produtoId?: unknown;
  snapshot_fiscal?: unknown;
}): string | null {
  if (!itemVendaEhAvulso(item)) {
    return null;
  }
  if (snapshotTributarioItemCompleto(item.snapshot_fiscal)) {
    return null;
  }
  return MENSAGEM_ITEM_AVULSO_SEM_CONFIG_FISCAL;
}

export function itensCatalogoParaEstoque<
  T extends { origem?: unknown; origem_item?: unknown; produtoId?: unknown },
>(itens: T[]): Array<T & { produtoId: string }> {
  return itens.filter((item): item is T & { produtoId: string } => {
    if (itemVendaEhAvulso(item)) {
      return false;
    }
    return Boolean(String(item.produtoId ?? "").trim());
  });
}

export function permitirItemAvulsoDoRegistro(valor: unknown) {
  return valor !== false;
}
