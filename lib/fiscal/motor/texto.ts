const ACENTOS: Record<string, string> = {
  á: "a",
  à: "a",
  ã: "a",
  â: "a",
  ä: "a",
  é: "e",
  ê: "e",
  è: "e",
  ë: "e",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  ó: "o",
  ò: "o",
  õ: "o",
  ô: "o",
  ö: "o",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
  ç: "c",
};

export function normalizarTextoFiscal(valor: unknown) {
  return String(valor ?? "")
    .toLowerCase()
    .replace(/[áàãâäéêèëíìîïóòõôöúùûüç]/g, (letra) => ACENTOS[letra] ?? letra)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokensBuscaFiscal(valor: unknown) {
  return normalizarTextoFiscal(valor)
    .split(" ")
    .filter((token) => token.length >= 2)
    .slice(0, 12);
}

export function pontuarCandidatoPorTokens(
  descricao: string,
  tokens: string[]
) {
  if (tokens.length === 0) {
    return 0;
  }
  const alvo = ` ${normalizarTextoFiscal(descricao)} `;
  let acertos = 0;
  for (const token of tokens) {
    if (alvo.includes(` ${token}`)) {
      acertos += 1;
    }
  }
  return acertos / tokens.length;
}

const MARCAS_NAO_ORIGEM = ["apple", "samsung", "xiaomi", "motorola", "lg"];

export function marcaNaoDeterminaOrigem(marca: string | null | undefined) {
  const normalizada = normalizarTextoFiscal(marca);
  return MARCAS_NAO_ORIGEM.some((item) => normalizada.includes(item));
}

export function informacoesFaltantesClassificacao(params: {
  descricao: string;
  material?: string | null;
  finalidade?: string | null;
  composicao?: string | null;
  caracteristicasTecnicas?: string | null;
}) {
  const texto = [
    params.descricao,
    params.material,
    params.finalidade,
    params.composicao,
    params.caracteristicasTecnicas,
  ]
    .filter(Boolean)
    .join(" ");
  const tokens = tokensBuscaFiscal(texto);
  const perguntas: string[] = [];

  if (tokens.length < 3 || String(params.descricao ?? "").trim().length < 12) {
    perguntas.push("A descrição está genérica. Pode detalhar o que é o produto?");
  }
  if (!String(params.material ?? "").trim()) {
    perguntas.push("Qual o material (plástico, metal, silicone, tecido, eletrônico)?");
  }
  if (!String(params.finalidade ?? "").trim()) {
    perguntas.push("Qual a finalidade (proteção, vestuário, alimento, peça, cabo de dados)?");
  }
  const cabo = normalizarTextoFiscal(params.descricao).includes("cabo");
  if (cabo && !/dados|energia|carreg/i.test(texto)) {
    perguntas.push("O cabo transmite dados ou somente energia?");
    perguntas.push("Possui componente eletrônico?");
  }
  if (!String(params.composicao ?? "").trim() && tokens.length < 5) {
    perguntas.push("Qual a composição, se conhecida?");
  }
  return perguntas;
}
