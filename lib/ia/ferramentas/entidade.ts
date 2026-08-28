import type { AcaoAssistente } from "../tipos";

export type ResolucaoEntidade<T> =
  | { tipo: "nenhum" }
  | { tipo: "unico"; item: T }
  | { tipo: "ambiguidade"; itens: T[] };

export function resolverEntidadesIa<T>(
  itens: T[],
  limiteAmbiguidade = 8
): ResolucaoEntidade<T> {
  if (itens.length === 0) {
    return { tipo: "nenhum" };
  }
  if (itens.length === 1) {
    return { tipo: "unico", item: itens[0] };
  }
  return { tipo: "ambiguidade", itens: itens.slice(0, limiteAmbiguidade) };
}

export function acoesSelecaoEntidadeIa(params: {
  itens: Array<{ id: string; nome: string; href: string }>;
  rotulo: string;
}): AcaoAssistente[] {
  return params.itens.map((item) => ({
    type: "select_entity",
    label: `${params.rotulo}: ${item.nome}`,
    href: item.href,
    entityId: item.id,
    entityTipo: params.rotulo,
  }));
}

export function mensagemAmbiguidadeIa(rotulo: string, nomes: string[]) {
  const lista = nomes.slice(0, 8).join(", ");
  return `Encontrei mais de um ${rotulo}: ${lista}. Qual deles você quer consultar?`;
}
