import type {
  CaixaMovimento,
  CaixaTotais,
  TipoMovimentoCaixa,
} from "./tipos";

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function totaisDoLivro(
  movimentos: Array<{
    tipo?: string | null;
    entrada?: number | string | null;
    saida?: number | string | null;
  }>
): CaixaTotais {
  let saldoInicial = 0;
  let suprimentos = 0;
  let sangrias = 0;
  let outrasEntradas = 0;
  let outrasSaidas = 0;
  let entradas = 0;
  let saidas = 0;

  for (const movimento of movimentos) {
    const entrada = numero(movimento.entrada);
    const saida = numero(movimento.saida);
    const tipo = String(movimento.tipo ?? "") as TipoMovimentoCaixa;
    entradas += entrada;
    saidas += saida;

    if (tipo === "abertura") {
      saldoInicial += entrada;
    } else if (tipo === "suprimento") {
      suprimentos += entrada;
    } else if (tipo === "sangria") {
      sangrias += saida;
    } else {
      outrasEntradas += entrada;
      outrasSaidas += saida;
    }
  }

  return {
    saldoInicial: Math.round(saldoInicial * 100) / 100,
    suprimentos: Math.round(suprimentos * 100) / 100,
    sangrias: Math.round(sangrias * 100) / 100,
    outrasEntradas: Math.round(outrasEntradas * 100) / 100,
    outrasSaidas: Math.round(outrasSaidas * 100) / 100,
    entradas: Math.round(entradas * 100) / 100,
    saidas: Math.round(saidas * 100) / 100,
    saldoAtual: Math.round((entradas - saidas) * 100) / 100,
  };
}

export function saldoAtualDoLivro(movimentos: CaixaMovimento[]) {
  return totaisDoLivro(movimentos).saldoAtual;
}
