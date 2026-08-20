import * as XLSX from "xlsx";

import type { RelatorioMontado } from "./tipos";

export function montarPlanilhaRelatorio(
  relatorio: RelatorioMontado,
  empresaNome: string,
  periodoRotulo: string
) {
  const linhas: Array<Array<string | number>> = [
    [empresaNome],
    [relatorio.titulo],
    [`Período: ${periodoRotulo}`],
    [],
    ["Indicadores"],
    ...relatorio.indicadores.map((item) => [item.label, item.valor]),
    [],
    relatorio.colunas,
    ...relatorio.linhas.map((linha) => linha.celulas),
  ];

  if (relatorio.extra) {
    linhas.push([], [relatorio.extra.titulo], relatorio.extra.colunas);
    for (const linha of relatorio.extra.linhas) {
      linhas.push(linha.celulas);
    }
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(linhas);
  XLSX.utils.book_append_sheet(workbook, sheet, relatorio.titulo.slice(0, 31));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function nomeArquivoRelatorio(aba: string, empresaId: string) {
  return `relatorio-${aba}-${empresaId.slice(0, 8)}.xlsx`;
}
