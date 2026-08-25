import {
  classificarFormaCaixa,
  efeitoFisicoMovimento,
  valorLiquidoMovimento,
} from "./formas";
import type {
  CaixaMovimento,
  CaixaTotais,
  TipoMovimentoCaixa,
} from "./tipos";

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function round2(valor: number) {
  return Math.round(valor * 100) / 100;
}

function acumularMeioNaoFisico(
  movimento: {
    afeta_caixa_fisico_snapshot?: boolean | null;
    forma_tipo?: string | null;
    forma_codigo?: string | null;
    forma_nome?: string | null;
  },
  liquido: number,
  acc: {
    pix: number;
    credito: number;
    debito: number;
    outros: number;
  }
) {
  if (movimento.afeta_caixa_fisico_snapshot === true) {
    return;
  }
  const classe = classificarFormaCaixa({
    tipo: movimento.forma_tipo,
    codigo: movimento.forma_codigo,
    nome: movimento.forma_nome,
  });
  if (classe === "pix") {
    acc.pix += liquido;
  } else if (classe === "credito") {
    acc.credito += liquido;
  } else if (classe === "debito") {
    acc.debito += liquido;
  } else if (classe !== "dinheiro") {
    acc.outros += liquido;
  }
}

export function totaisDoLivro(
  movimentos: Array<{
    tipo?: string | null;
    entrada?: number | string | null;
    saida?: number | string | null;
    permite_troco_snapshot?: boolean | null;
    afeta_caixa_fisico_snapshot?: boolean | null;
    forma_tipo?: string | null;
    forma_codigo?: string | null;
    forma_nome?: string | null;
  }>
): CaixaTotais {
  let saldoInicial = 0;
  let suprimentos = 0;
  let sangrias = 0;
  let outrasEntradas = 0;
  let outrasSaidas = 0;
  let entradas = 0;
  let saidas = 0;
  let saldoFisico = 0;
  let vendasTotal = 0;
  let vendasDinheiro = 0;
  let vendasPix = 0;
  let vendasCredito = 0;
  let vendasDebito = 0;
  let vendasOutros = 0;
  let recebimentosCarteira = 0;
  let estornos = 0;
  const meios = { pix: 0, credito: 0, debito: 0, outros: 0 };

  for (const movimento of movimentos) {
    const entrada = numero(movimento.entrada);
    const saida = numero(movimento.saida);
    const tipo = String(movimento.tipo ?? "") as TipoMovimentoCaixa;
    const liquido = valorLiquidoMovimento(movimento);
    entradas += entrada;
    saidas += saida;
    saldoFisico += efeitoFisicoMovimento(movimento);

    if (tipo === "abertura") {
      saldoInicial += entrada;
    } else if (tipo === "suprimento") {
      suprimentos += entrada;
    } else if (tipo === "sangria") {
      sangrias += saida;
    } else if (tipo === "venda") {
      vendasTotal += liquido;
      if (movimento.afeta_caixa_fisico_snapshot === true) {
        vendasDinheiro += liquido;
      } else {
        const classe = classificarFormaCaixa({
          tipo: movimento.forma_tipo,
          codigo: movimento.forma_codigo,
          nome: movimento.forma_nome,
        });
        if (classe === "pix") {
          vendasPix += liquido;
        } else if (classe === "credito") {
          vendasCredito += liquido;
        } else if (classe === "debito") {
          vendasDebito += liquido;
        } else {
          vendasOutros += liquido;
        }
      }
      acumularMeioNaoFisico(movimento, liquido, meios);
    } else if (tipo === "recebimento_carteira") {
      recebimentosCarteira += liquido;
      acumularMeioNaoFisico(movimento, liquido, meios);
    } else if (tipo === "estorno_recebimento") {
      estornos += round2(saida - entrada);
      acumularMeioNaoFisico(movimento, liquido, meios);
    } else {
      outrasEntradas += entrada;
      outrasSaidas += saida;
    }
  }

  return {
    saldoInicial: round2(saldoInicial),
    suprimentos: round2(suprimentos),
    sangrias: round2(sangrias),
    outrasEntradas: round2(outrasEntradas),
    outrasSaidas: round2(outrasSaidas),
    entradas: round2(entradas),
    saidas: round2(saidas),
    saldoAtual: round2(saldoFisico),
    vendasTotal: round2(vendasTotal),
    vendasDinheiro: round2(vendasDinheiro),
    vendasPix: round2(vendasPix),
    vendasCredito: round2(vendasCredito),
    vendasDebito: round2(vendasDebito),
    vendasOutros: round2(vendasOutros),
    recebimentosCarteira: round2(recebimentosCarteira),
    estornos: round2(estornos),
    meiosPix: round2(meios.pix),
    meiosCredito: round2(meios.credito),
    meiosDebito: round2(meios.debito),
    meiosOutros: round2(meios.outros),
  };
}

export function saldoAtualDoLivro(movimentos: CaixaMovimento[]) {
  return totaisDoLivro(movimentos).saldoAtual;
}
