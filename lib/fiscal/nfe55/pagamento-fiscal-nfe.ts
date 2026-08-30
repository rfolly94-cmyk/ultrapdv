import type { FaturaGeranetNfe } from "@/lib/fiscal/nfe55/fatura-nfe";
import { conferenciaFinanceiraVenda, type PagamentoFinanceiro } from "@/lib/vendas/pagamentos-financeiros";

export const TPAG_PAGAMENTO_POSTERIOR = "91";
export const TPAG_DUPLICATA_MERCANTIL = "14";

export const MENSAGEM_TPAG_91_VPAG_DIFERENTE_ZERO =
  "Pagamento Posterior (tPag 91) deve ter vPag 0,00.";

export const MENSAGEM_TPAG_14_VPAG_ZERO =
  "Duplicata Mercantil (tPag 14) deve ter vPag maior que zero.";

export const MENSAGEM_TPAG_14_SEM_DUPLICATA =
  "Duplicata Mercantil (tPag 14) exige fatura e pelo menos uma duplicata.";

export const MENSAGEM_DUPLICATA_SEM_TPAG_14 =
  "Fatura/duplicatas só podem ser enviadas com tPag 14 (Duplicata Mercantil).";

export const MENSAGEM_91_COM_DUPLICATA =
  "Não misture Pagamento Posterior (tPag 91) com Duplicata Mercantil (tPag 14).";

export const MENSAGEM_PAGAMENTOS_FISCAIS_NAO_CONFEREM =
  "Pagamentos não conferem com o total da NF-e.";

export type FormaParaPagamentoFiscalNfe = {
  id?: string | null;
  codigo?: string | null;
  nome?: string | null;
  codigo_fiscal?: string | null;
  permite_fiado?: boolean | null;
};

export type PagamentoParaFiscalNfe = {
  id?: string | null;
  formaPagamentoId?: string | null;
  forma_pagamento_codigo?: string | null;
  forma_pagamento_nome?: string | null;
  codigo_fiscal?: string | null;
  valor?: number | string | null;
  valorCentavos?: number;
  indicador_pagamento?: string | null;
};

export type DetalhamentoFiscalNfe = {
  tipo: string;
  valor: number;
  indicadorPagamento: "0" | "1";
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function tPag(valor: unknown) {
  return texto(valor);
}

function reais(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function centavosDePagamento(pagamento: PagamentoParaFiscalNfe) {
  if (Number.isInteger(pagamento.valorCentavos) && (pagamento.valorCentavos ?? 0) > 0) {
    return pagamento.valorCentavos as number;
  }
  return Math.round(reais(pagamento.valor) * 100);
}

export function encontrarFormaPagamentoFiscal(
  pagamento: PagamentoParaFiscalNfe,
  formas: FormaParaPagamentoFiscalNfe[]
) {
  return formas.find(
    (forma) =>
      String(forma.id ?? "") === String(pagamento.id ?? "") ||
      String(forma.id ?? "") === String(pagamento.formaPagamentoId ?? "") ||
      (texto(forma.codigo) !== "" &&
        texto(forma.codigo) === texto(pagamento.forma_pagamento_codigo)) ||
      (texto(forma.codigo_fiscal) !== "" &&
        texto(forma.codigo_fiscal) === texto(pagamento.codigo_fiscal))
  );
}

export function formaEhPagamentoPosterior(forma: FormaParaPagamentoFiscalNfe | null | undefined) {
  return Boolean(forma?.permite_fiado) || tPag(forma?.codigo_fiscal) === TPAG_PAGAMENTO_POSTERIOR;
}

export function formaEhDuplicataMercantil(forma: FormaParaPagamentoFiscalNfe | null | undefined) {
  return (
    tPag(forma?.codigo_fiscal) === TPAG_DUPLICATA_MERCANTIL && !forma?.permite_fiado
  );
}

export function pagamentoEhPagamentoPosterior(
  pagamento: PagamentoParaFiscalNfe,
  formas: FormaParaPagamentoFiscalNfe[]
) {
  const forma = encontrarFormaPagamentoFiscal(pagamento, formas);
  return formaEhPagamentoPosterior(forma) || tPag(pagamento.codigo_fiscal) === TPAG_PAGAMENTO_POSTERIOR;
}

export function pagamentoEhDuplicataMercantil(
  pagamento: PagamentoParaFiscalNfe,
  formas: FormaParaPagamentoFiscalNfe[]
) {
  const forma = encontrarFormaPagamentoFiscal(pagamento, formas);
  return formaEhDuplicataMercantil(forma);
}

export function saldoDuplicataMercantilCentavos(input: {
  totalNfeCentavos: number;
  pagamentosImediatosCentavos: number;
}) {
  return Math.max(
    0,
    Math.round(input.totalNfeCentavos) - Math.max(0, Math.round(input.pagamentosImediatosCentavos))
  );
}

export function pagamentosImediatosNfeCentavos(input: {
  pagamentos: PagamentoParaFiscalNfe[];
  formas: FormaParaPagamentoFiscalNfe[];
}) {
  return input.pagamentos.reduce((soma, pagamento) => {
    const valor = centavosDePagamento(pagamento);
    if (valor <= 0) {
      return soma;
    }
    if (
      pagamentoEhPagamentoPosterior(pagamento, input.formas) ||
      pagamentoEhDuplicataMercantil(pagamento, input.formas)
    ) {
      return soma;
    }
    return soma + valor;
  }, 0);
}

export function mesclarPagamentoDuplicataMercantil<
  T extends { formaPagamentoId: string; valorCentavos: number },
>(input: {
  pagamentos: T[];
  formas: FormaParaPagamentoFiscalNfe[];
  coberturaDuplicataCentavos: number;
}): T[] {
  const cobertura = Math.max(0, Math.round(input.coberturaDuplicataCentavos));
  const forma = input.formas.find((item) => formaEhDuplicataMercantil(item));
  const formaId = String(forma?.id ?? "").trim();
  const semDuplicata = input.pagamentos.filter((pagamento) => {
    const encontrada = encontrarFormaPagamentoFiscal(
      { formaPagamentoId: pagamento.formaPagamentoId, id: pagamento.formaPagamentoId },
      input.formas
    );
    return !formaEhDuplicataMercantil(encontrada);
  });
  if (cobertura <= 0 || !formaId) {
    return semDuplicata;
  }
  const original = input.pagamentos.find((pagamento) => pagamento.formaPagamentoId === formaId);
  return [
    ...semDuplicata,
    {
      ...(original ?? ({ formaPagamentoId: formaId, valorCentavos: cobertura } as T)),
      formaPagamentoId: formaId,
      valorCentavos: cobertura,
    },
  ];
}

export function conferenciaComercialNfeComDuplicata(input: {
  valorTotal: number | string | null;
  pagamentos: PagamentoFinanceiro[];
  troco?: number | string | null;
  coberturaDuplicataCentavos?: number;
}) {
  const cobertura = Math.max(0, Math.round(input.coberturaDuplicataCentavos ?? 0));
  return conferenciaFinanceiraVenda({
    valorTotal: input.valorTotal,
    pagamentos:
      cobertura > 0
        ? [...input.pagamentos, { status: "confirmado", valor: cobertura / 100 }]
        : input.pagamentos,
    troco: input.troco,
  });
}

/**
 * Converte pagamentos comerciais (PDV/Carteira) no detalhamento fiscal da NF-e 55.
 * Fiado/Carteira → tPag 91 com vPag 0,00. Não copia o saldo a receber como vPag.
 * Duplicata Mercantil (tPag 14) entra com o vPag coberto pela fatura/duplicatas.
 */
export function mapearDetalhamentoFiscalNfe55(input: {
  pagamentos: PagamentoParaFiscalNfe[];
  formas: FormaParaPagamentoFiscalNfe[];
  duplicataMercantilCentavos?: number;
}): DetalhamentoFiscalNfe[] {
  const detalhamento: DetalhamentoFiscalNfe[] = [];
  let temPosterior = false;

  for (const pagamento of input.pagamentos) {
    const forma = encontrarFormaPagamentoFiscal(pagamento, input.formas);
    const codigo = tPag(forma?.codigo_fiscal ?? pagamento.codigo_fiscal);
    const valorCentavos = centavosDePagamento(pagamento);
    if (formaEhPagamentoPosterior(forma) || codigo === TPAG_PAGAMENTO_POSTERIOR) {
      if (valorCentavos > 0 || codigo === TPAG_PAGAMENTO_POSTERIOR || forma?.permite_fiado) {
        temPosterior = true;
      }
      continue;
    }
    if (valorCentavos <= 0 || !/^\d{2}$/.test(codigo)) {
      continue;
    }
    const duplicata = formaEhDuplicataMercantil(forma) || codigo === TPAG_DUPLICATA_MERCANTIL;
    detalhamento.push({
      tipo: codigo,
      valor: valorCentavos / 100,
      indicadorPagamento: duplicata ? "1" : "0",
    });
  }

  const jaTem14 = detalhamento.some((item) => item.tipo === TPAG_DUPLICATA_MERCANTIL);
  const duplicataCentavos = Math.max(0, Math.round(input.duplicataMercantilCentavos ?? 0));
  if (!temPosterior && !jaTem14 && duplicataCentavos > 0) {
    detalhamento.push({
      tipo: TPAG_DUPLICATA_MERCANTIL,
      valor: duplicataCentavos / 100,
      indicadorPagamento: "1",
    });
  }

  if (temPosterior) {
    detalhamento.push({
      tipo: TPAG_PAGAMENTO_POSTERIOR,
      valor: 0,
      indicadorPagamento: "1",
    });
  }

  return detalhamento;
}

function somaDuplicatasGeranet(fatura: FaturaGeranetNfe | null) {
  if (!fatura) {
    return 0;
  }
  return fatura.duplicatas.reduce((soma, item) => soma + reais(item.valor), 0);
}

export function validarPagamentoFiscalNfe55(input: {
  detalhamento: DetalhamentoFiscalNfe[];
  totalNfe: number;
  troco: number;
  fatura: FaturaGeranetNfe | null;
}): string | null {
  const detalhamento = input.detalhamento;
  if (detalhamento.length === 0) {
    return "Informe o pagamento da NF-e.";
  }

  const posteriores = detalhamento.filter((item) => item.tipo === TPAG_PAGAMENTO_POSTERIOR);
  const duplicatas = detalhamento.filter((item) => item.tipo === TPAG_DUPLICATA_MERCANTIL);
  const temFatura = Boolean(input.fatura && input.fatura.duplicatas.length > 0);

  if (posteriores.length > 1) {
    return "Informe Pagamento Posterior (tPag 91) uma única vez.";
  }

  for (const posterior of posteriores) {
    if (Math.round(reais(posterior.valor) * 100) !== 0) {
      return MENSAGEM_TPAG_91_VPAG_DIFERENTE_ZERO;
    }
  }

  if (posteriores.length > 0 && duplicatas.length > 0) {
    return MENSAGEM_91_COM_DUPLICATA;
  }

  for (const duplicata of duplicatas) {
    if (Math.round(reais(duplicata.valor) * 100) <= 0) {
      return MENSAGEM_TPAG_14_VPAG_ZERO;
    }
  }

  if (duplicatas.length > 0 && !temFatura) {
    return MENSAGEM_TPAG_14_SEM_DUPLICATA;
  }

  if (temFatura && duplicatas.length === 0) {
    return MENSAGEM_DUPLICATA_SEM_TPAG_14;
  }

  if (temFatura && input.fatura) {
    const somaDup = Math.round(somaDuplicatasGeranet(input.fatura) * 100);
    const liquido = Math.round(reais(input.fatura.valorLiquido) * 100);
    if (somaDup !== liquido) {
      return "A soma das duplicatas deve ser igual ao valor líquido da fatura.";
    }
    const somaTpag14 = Math.round(
      duplicatas.reduce((soma, item) => soma + reais(item.valor), 0) * 100
    );
    if (somaTpag14 !== liquido) {
      return "O valor de tPag 14 deve ser igual ao valor líquido da fatura.";
    }
  }

  const somaImediata = detalhamento
    .filter((item) => item.tipo !== TPAG_PAGAMENTO_POSTERIOR)
    .reduce((soma, item) => soma + reais(item.valor), 0);
  const liquidoPago = Math.round((somaImediata - reais(input.troco)) * 100);
  const totalNfe = Math.round(reais(input.totalNfe) * 100);

  if (posteriores.length > 0) {
    if (liquidoPago > totalNfe) {
      return MENSAGEM_PAGAMENTOS_FISCAIS_NAO_CONFEREM;
    }
    return null;
  }

  if (Math.abs(liquidoPago - totalNfe) > 1) {
    return MENSAGEM_PAGAMENTOS_FISCAIS_NAO_CONFEREM;
  }
  return null;
}

export function faturaPermitidaNoPayloadNfe(
  detalhamento: DetalhamentoFiscalNfe[],
  fatura: FaturaGeranetNfe | null
) {
  const tem14 = detalhamento.some((item) => item.tipo === TPAG_DUPLICATA_MERCANTIL);
  if (!tem14) {
    return null;
  }
  return fatura;
}
