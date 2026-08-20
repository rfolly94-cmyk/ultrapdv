/**
 * Anexo XIV — Código de Enquadramento Legal do IPI
 * Fonte: NT 2015/002 e atualizações do MOC NF-e.
 *
 * Os códigos são os oficiais, sem zero à esquerda inventado
 * na hora da emissão. Não completar automaticamente.
 */
export const CENQ_ANEXO_XIV = [
  "001",
  "002",
  "003",
  "004",
  "005",
  "006",
  "007",
  "101",
  "102",
  "103",
  "104",
  "105",
  "106",
  "107",
  "108",
  "109",
  "110",
  "111",
  "112",
  "113",
  "114",
  "115",
  "116",
  "117",
  "118",
  "119",
  "120",
  "121",
  "122",
  "123",
  "124",
  "125",
  "126",
  "127",
  "128",
  "129",
  "130",
  "131",
  "132",
  "133",
  "134",
  "135",
  "136",
  "137",
  "138",
  "139",
  "140",
  "141",
  "142",
  "143",
  "144",
  "145",
  "146",
  "147",
  "148",
  "149",
  "150",
  "151",
  "152",
  "153",
  "154",
  "155",
  "156",
  "157",
  "158",
  "159",
  "160",
  "161",
  "162",
  "301",
  "302",
  "303",
  "304",
  "305",
  "306",
  "307",
  "308",
  "309",
  "310",
  "311",
  "312",
  "313",
  "314",
  "315",
  "316",
  "317",
  "318",
  "319",
  "320",
  "321",
  "322",
  "323",
  "324",
  "325",
  "326",
  "327",
  "328",
  "329",
  "330",
  "331",
  "332",
  "333",
  "334",
  "335",
  "336",
  "337",
  "338",
  "339",
  "340",
  "341",
  "342",
  "343",
  "344",
  "345",
  "346",
  "347",
  "348",
  "349",
  "350",
  "351",
  "601",
  "602",
  "603",
  "604",
  "605",
  "606",
  "607",
  "608",
  "999",
] as const;

export type CenqAnexoXiv = (typeof CENQ_ANEXO_XIV)[number];

const CENQ_ANEXO_XIV_NUMEROS = new Set(
  CENQ_ANEXO_XIV.map((codigo) => Number(codigo))
);

/**
 * Compara o cEnq informado com o Anexo XIV só pelo valor numérico.
 * "1", "01" e "001" são o mesmo código oficial.
 * Não reescreve o texto informado pelo operador.
 */
function numeroCenqParaComparacao(
  codigo: string | null | undefined
) {
  const texto = String(codigo ?? "").trim();

  if (!/^[0-9]{1,3}$/.test(texto)) {
    return null;
  }

  return Number(texto);
}

export function cenqExisteNoAnexoXiv(
  codigo: string | null | undefined
) {
  const numero = numeroCenqParaComparacao(codigo);

  if (numero === null) {
    return false;
  }

  return CENQ_ANEXO_XIV_NUMEROS.has(numero);
}

/**
 * Faixas obrigatórias CST × cEnq (rejeição 388).
 *
 * 52 / 54 / 55 exigem faixa + existência no Anexo XIV.
 * 50 / 51 / 53 / 99 exigem somente existência no Anexo XIV.
 * 601–608 e 999 continuam no catálogo, mas não são impostos.
 */
export function faixaCenqPermitidaParaCst(
  cst: string | null | undefined
): { minimo: number; maximo: number }[] {
  switch (String(cst ?? "").trim()) {
    case "52":
      return [{ minimo: 301, maximo: 399 }];
    case "54":
      return [{ minimo: 1, maximo: 99 }];
    case "55":
      return [{ minimo: 101, maximo: 199 }];
    default:
      return [];
  }
}
