import type { RelatorioMontado } from "@/lib/relatorios/tipos";

export function linhasRelatorioPdf(input: {
  empresaNome: string;
  periodo: string;
  relatorio: RelatorioMontado;
}) {
  const linhas = [
    input.empresaNome || "Empresa",
    input.relatorio.titulo,
    input.periodo,
    "",
  ];

  for (const indicador of input.relatorio.indicadores) {
    linhas.push(`${indicador.label}: ${indicador.valor}`);
  }
  if (input.relatorio.indicadores.length) {
    linhas.push("");
  }

  linhas.push(input.relatorio.colunas.join(" | "));
  if (!input.relatorio.linhas.length) {
    linhas.push(input.relatorio.vazio || "Sem registros.");
  } else {
    for (const linha of input.relatorio.linhas) {
      linhas.push(linha.celulas.map((celula) => String(celula)).join(" | "));
    }
  }

  if (input.relatorio.extra) {
    linhas.push("", input.relatorio.extra.titulo);
    linhas.push(input.relatorio.extra.colunas.join(" | "));
    for (const linha of input.relatorio.extra.linhas) {
      linhas.push(linha.celulas.map((celula) => String(celula)).join(" | "));
    }
  }

  linhas.push("", "UltraPDV");
  return linhas;
}
