export const UNIDADES_MEDIDA = [
  { value: "UN", label: "Unidade" },
  { value: "PC", label: "Peça" },
  { value: "PCT", label: "Pacote" },
  { value: "CX", label: "Caixa" },
  { value: "KIT", label: "Kit" },
  { value: "PAR", label: "Par" },
  { value: "DZ", label: "Dúzia" },
  { value: "KG", label: "Quilograma" },
  { value: "G", label: "Grama" },
  { value: "MG", label: "Miligrama" },
  { value: "L", label: "Litro" },
  { value: "ML", label: "Mililitro" },
  { value: "M", label: "Metro" },
  { value: "CM", label: "Centímetro" },
  { value: "MM", label: "Milímetro" },
  { value: "M2", label: "Metro quadrado" },
  { value: "M3", label: "Metro cúbico" },
  { value: "RL", label: "Rolo" },
  { value: "FD", label: "Fardo" },
  { value: "SC", label: "Saco" },
  { value: "BD", label: "Balde" },
  { value: "LT", label: "Lata" },
  { value: "FR", label: "Frasco" },
  { value: "TB", label: "Tubo" },
  { value: "JG", label: "Jogo" },
] as const;

export type UnidadeMedida =
  (typeof UNIDADES_MEDIDA)[number]["value"];

const UNIDADES_DECIMAIS = new Set<string>([
  "KG",
  "G",
  "MG",
  "L",
  "ML",
  "M",
  "CM",
  "MM",
  "M2",
  "M3",
]);

const UNIDADES_SET = new Set<string>(
  UNIDADES_MEDIDA.map((unidade) => unidade.value)
);

export const UNIDADE_MEDIDA_PADRAO: UnidadeMedida = "UN";

export function normalizarUnidadeMedida(
  valor: string | null | undefined
) {
  return String(valor ?? "")
    .trim()
    .toUpperCase();
}

export function unidadeMedidaValida(
  valor: string | null | undefined
) {
  return UNIDADES_SET.has(normalizarUnidadeMedida(valor));
}

export function unidadePermiteDecimal(
  valor: string | null | undefined
) {
  return UNIDADES_DECIMAIS.has(
    normalizarUnidadeMedida(valor)
  );
}

export function rotuloUnidadeMedida(
  valor: string | null | undefined
) {
  const codigo = normalizarUnidadeMedida(valor);

  const unidade = UNIDADES_MEDIDA.find(
    (item) => item.value === codigo
  );

  if (!unidade) {
    return codigo || "UN";
  }

  return `${unidade.value} — ${unidade.label}`;
}
