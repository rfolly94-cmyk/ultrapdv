import { normalizarUnidadeMedida } from "@/lib/produtos/unidades-medida";

export const UNIDADE_BALANCA = "KG";

export function produtoElegivelBalanca(
  unidade: string | null | undefined
) {
  return normalizarUnidadeMedida(unidade) === UNIDADE_BALANCA;
}
