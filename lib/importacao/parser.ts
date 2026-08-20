import * as XLSX from "xlsx";

import { textoCelula } from "@/lib/importacao/normalizadores";
import { LIMITES_IMPORTACAO, type LinhaPlanilha } from "@/lib/importacao/tipos";

export { LIMITES_IMPORTACAO };

const LIMITE_LINHAS = LIMITES_IMPORTACAO.maxLinhas;
const PREVIEW_LINHAS = LIMITES_IMPORTACAO.preview;

export type PlanilhaLida = {
  abas: string[];
  aba: string;
  matriz: string[][];
  totalLinhas: number;
};

function matrizDaAba(workbook: XLSX.WorkBook, aba: string) {
  const sheet = workbook.Sheets[aba];
  if (!sheet) {
    return [];
  }

  const matriz = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
    sheet,
    {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }
  );

  return matriz.map((linha) =>
    (Array.isArray(linha) ? linha : []).map((celula) => textoCelula(celula))
  );
}

export function lerWorkbook(buffer: ArrayBuffer | Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    raw: false,
  });
}

export function listarAbas(workbook: XLSX.WorkBook) {
  return workbook.SheetNames.filter(Boolean);
}

export function extrairPlanilha(
  workbook: XLSX.WorkBook,
  aba?: string | null
): PlanilhaLida {
  const abas = listarAbas(workbook);
  const escolhida = aba && abas.includes(aba) ? aba : abas[0] ?? "";
  const matriz = escolhida ? matrizDaAba(workbook, escolhida) : [];

  return {
    abas,
    aba: escolhida,
    matriz,
    totalLinhas: matriz.length,
  };
}

export function colunasDoCabecalho(
  matriz: string[][],
  linhaCabecalho: number
) {
  const indice = Math.max(1, linhaCabecalho) - 1;
  const linha = matriz[indice] ?? [];
  const usados = new Map<string, number>();

  return linha.map((bruto, posicao) => {
    const base = textoCelula(bruto) || `Coluna ${posicao + 1}`;
    const atual = usados.get(base) ?? 0;
    usados.set(base, atual + 1);
    return atual === 0 ? base : `${base} (${atual + 1})`;
  });
}

export function linhasAposCabecalho(
  matriz: string[][],
  linhaCabecalho: number,
  colunas: string[]
): LinhaPlanilha[] {
  const inicio = Math.max(1, linhaCabecalho);
  const saida: LinhaPlanilha[] = [];

  for (let i = inicio; i < matriz.length && saida.length < LIMITE_LINHAS; i += 1) {
    const linha = matriz[i] ?? [];
    const valores: Record<string, string> = {};
    let vazia = true;

    colunas.forEach((coluna, indice) => {
      const valor = textoCelula(linha[indice]);
      valores[coluna] = valor;
      if (valor) {
        vazia = false;
      }
    });

    if (vazia) {
      continue;
    }

    saida.push({
      numero: i + 1,
      valores,
    });
  }

  return saida;
}

export function previaMatriz(matriz: string[][], linhaCabecalho: number) {
  const inicio = Math.max(0, linhaCabecalho - 1);
  return matriz.slice(inicio, inicio + PREVIEW_LINHAS);
}
