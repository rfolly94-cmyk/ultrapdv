import { validarDataFiscal } from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import { hojeIso } from "@/lib/produtos/lotes";

export type CondicaoPagamentoNfe = "vista" | "prazo";

export type OrigemFaturaNfe = "manual" | "automatica" | "carteira";

export type DuplicataFaturaNfe = {
  numero: string;
  dataVencimento: string;
  valorCentavos: number;
  codigoPagamento?: string | null;
};

export type FaturaNfe = {
  numero: string;
  valorCentavos: number;
  descontoCentavos: number;
  valorLiquidoCentavos: number;
  duplicatas: DuplicataFaturaNfe[];
  origem: OrigemFaturaNfe;
  parcelasPersonalizadas: boolean;
};

export type TituloCarteiraParaFaturaNfe = {
  empresa_id?: string | null;
  venda_id?: string | null;
  numero_venda?: number | string | null;
  valor_original?: number | string | null;
  vencimento?: string | null;
  status?: string | null;
};

export type FaturaGeranetNfe = {
  numero: string;
  valor: number;
  desconto: number;
  valorLiquido: number;
  duplicatas: Array<{
    numero: string;
    dataVencimento: string;
    valor: number;
    codigoPagamento?: string;
  }>;
};

export const MENSAGEM_FATURA_SEM_DUPLICATA =
  "Informe ao menos uma parcela na fatura.";

export const MENSAGEM_FATURA_SOMA_DIVERGENTE =
  "A soma das parcelas deve ser igual ao valor líquido da fatura.";

export const MENSAGEM_FATURA_DESCONTO_DIVERGENTE =
  "Valor original menos desconto da fatura deve ser igual ao valor líquido.";

export const MENSAGEM_FATURA_PRAZO_DIVERGENTE =
  "O valor líquido da fatura deve ser igual ao total a prazo da NF-e.";

export const MENSAGEM_FATURA_TOTAL_ALTERADO =
  "O total da NF-e mudou. Revise as parcelas da fatura.";

export const MENSAGEM_MISTA_SEM_FATURA =
  "Há pagamento a prazo. Selecione a condição A prazo e informe as parcelas da fatura.";

function inteiroNaoNegativo(valor: unknown) {
  const n = Math.round(Number(valor ?? 0));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function inteiroPositivo(valor: unknown) {
  const n = inteiroNaoNegativo(valor);
  return n != null && n > 0 ? n : null;
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function reaisParaCentavos(valor: unknown) {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 100);
}

export function numeroParcelaNfe(indice: number) {
  if (!Number.isInteger(indice) || indice < 1 || indice > 999) {
    return "";
  }
  return String(indice).padStart(3, "0");
}

export function adicionarDiasIsoLocal(dataIso: string, dias: number) {
  if (!validarDataFiscal(dataIso) || !Number.isInteger(dias)) {
    return "";
  }
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia + dias);
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dataVencimentoIsoLocal(valor: unknown) {
  const bruto = texto(valor).slice(0, 10);
  return validarDataFiscal(bruto) ? bruto : "";
}

export function codigoPagamentoDuplicataNfe(valor: unknown) {
  const codigo = texto(valor);
  return /^\d{2}$/.test(codigo) ? codigo : null;
}

export function valorLiquidoFaturaCentavos(input: {
  valorCentavos: number;
  descontoCentavos: number;
}) {
  return Math.max(0, input.valorCentavos - input.descontoCentavos);
}

export function somaDuplicatasCentavos(duplicatas: DuplicataFaturaNfe[]) {
  return duplicatas.reduce((soma, item) => soma + item.valorCentavos, 0);
}

export function formaPagamentoEhAPrazo(forma: {
  permite_fiado?: boolean | null;
  permite_parcelamento?: boolean | null;
} | null | undefined) {
  return Boolean(forma?.permite_fiado);
}

export function totalAPrazoPagamentosCentavos(input: {
  pagamentos: Array<{ formaPagamentoId: string; valorCentavos: number }>;
  formas: Array<{
    id: string;
    permite_fiado?: boolean | null;
  }>;
}) {
  const formaPorId = new Map(input.formas.map((forma) => [String(forma.id), forma]));
  return input.pagamentos.reduce((soma, pagamento) => {
    const forma = formaPorId.get(pagamento.formaPagamentoId);
    if (!formaPagamentoEhAPrazo(forma) || pagamento.valorCentavos <= 0) {
      return soma;
    }
    return soma + pagamento.valorCentavos;
  }, 0);
}

export function totalAPrazoDePagamentosEmitidosCentavos(input: {
  pagamentos: Array<{
    id?: string | null;
    forma_pagamento_codigo?: string | null;
    codigo_fiscal?: string | null;
    valor?: number | string | null;
  }>;
  formas: Array<{
    id: string;
    codigo?: string | null;
    codigo_fiscal?: string | null;
    permite_fiado?: boolean | null;
  }>;
}) {
  return input.pagamentos.reduce((soma, pagamento) => {
    const forma = input.formas.find(
      (item) =>
        String(item.id) === String(pagamento.id ?? "") ||
        (texto(item.codigo) !== "" &&
          texto(item.codigo) === texto(pagamento.forma_pagamento_codigo)) ||
        (texto(item.codigo_fiscal) !== "" &&
          texto(item.codigo_fiscal) === texto(pagamento.codigo_fiscal))
    );
    if (!formaPagamentoEhAPrazo(forma)) {
      return soma;
    }
    const centavos = Math.round(Number(pagamento.valor ?? 0) * 100);
    return soma + (Number.isInteger(centavos) && centavos > 0 ? centavos : 0);
  }, 0);
}

/**
 * Total cobrado a prazo na fatura.
 * Fiado/Carteira: só o valor a prazo (venda mista = PIX à vista + fiado).
 * A prazo sem fiado: a NF-e inteira (boleto/duplicata montada na própria nota).
 */
export function totalAPrazoFaturaCentavos(input: {
  condicao: CondicaoPagamentoNfe;
  totalNfeCentavos: number;
  totalFiadoCentavos: number;
}) {
  if (input.condicao !== "prazo") {
    return 0;
  }
  if (input.totalFiadoCentavos > 0) {
    return input.totalFiadoCentavos;
  }
  return Math.max(0, input.totalNfeCentavos);
}

export function gerarParcelasFaturaNfe(input: {
  valorLiquidoCentavos: number;
  quantidade: number;
  primeiroVencimento: string;
  intervaloDias: number;
  codigoPagamento?: string | null;
}): DuplicataFaturaNfe[] {
  const quantidade = Math.round(input.quantidade);
  const liquido = inteiroPositivo(input.valorLiquidoCentavos);
  const intervalo = inteiroNaoNegativo(input.intervaloDias);
  if (
    liquido == null ||
    !Number.isInteger(quantidade) ||
    quantidade < 1 ||
    quantidade > 999 ||
    intervalo == null ||
    !validarDataFiscal(input.primeiroVencimento)
  ) {
    return [];
  }
  const base = Math.floor(liquido / quantidade);
  const codigo = codigoPagamentoDuplicataNfe(input.codigoPagamento);
  return Array.from({ length: quantidade }, (_, indice) => {
    const ultima = indice === quantidade - 1;
    const valorCentavos = ultima ? liquido - base * (quantidade - 1) : base;
    return {
      numero: numeroParcelaNfe(indice + 1),
      dataVencimento: adicionarDiasIsoLocal(
        input.primeiroVencimento,
        intervalo * indice
      ),
      valorCentavos,
      codigoPagamento: codigo,
    };
  });
}

export function faturaNfePadrao(input: {
  numero: string;
  valorCentavos: number;
  descontoCentavos?: number;
  origem?: OrigemFaturaNfe;
  primeiroVencimento?: string;
  codigoPagamento?: string | null;
}): FaturaNfe {
  const valor = inteiroPositivo(input.valorCentavos) ?? 0;
  const desconto = inteiroNaoNegativo(input.descontoCentavos) ?? 0;
  const liquido = valorLiquidoFaturaCentavos({
    valorCentavos: valor,
    descontoCentavos: desconto,
  });
  const vencimento =
    dataVencimentoIsoLocal(input.primeiroVencimento) ||
    adicionarDiasIsoLocal(hojeIso(), 30);
  return {
    numero: texto(input.numero) || "1",
    valorCentavos: valor,
    descontoCentavos: desconto,
    valorLiquidoCentavos: liquido,
    origem: input.origem ?? "automatica",
    parcelasPersonalizadas: false,
    duplicatas: gerarParcelasFaturaNfe({
      valorLiquidoCentavos: liquido,
      quantidade: 1,
      primeiroVencimento: vencimento,
      intervaloDias: 30,
      codigoPagamento: input.codigoPagamento,
    }),
  };
}

export function faturaDeTitulosCarteira(input: {
  titulos: TituloCarteiraParaFaturaNfe[];
  empresaId: string;
  vendaId: string;
  numeroFatura?: string | null;
  codigoPagamento?: string | null;
}): FaturaNfe | null {
  const titulos = input.titulos.filter((titulo) => {
    const status = texto(titulo.status).toUpperCase();
    return (
      String(titulo.empresa_id) === String(input.empresaId) &&
      String(titulo.venda_id) === String(input.vendaId) &&
      (status === "ABERTO" || status === "PARCIAL" || status === "")
    );
  });
  if (titulos.length === 0) {
    return null;
  }
  const duplicatas: DuplicataFaturaNfe[] = [];
  let valorCentavos = 0;
  for (const titulo of titulos) {
    const valor = reaisParaCentavos(titulo.valor_original);
    if (valor == null || valor <= 0) {
      continue;
    }
    valorCentavos += valor;
    duplicatas.push({
      numero: numeroParcelaNfe(duplicatas.length + 1),
      dataVencimento:
        dataVencimentoIsoLocal(titulo.vencimento) ||
        adicionarDiasIsoLocal(hojeIso(), 30),
      valorCentavos: valor,
      codigoPagamento: codigoPagamentoDuplicataNfe(input.codigoPagamento),
    });
  }
  if (duplicatas.length === 0) {
    return null;
  }
  const numeroVenda = titulos.find((item) => item.numero_venda != null)?.numero_venda;
  return {
    numero:
      texto(input.numeroFatura) ||
      (numeroVenda != null ? String(numeroVenda) : "1"),
    valorCentavos,
    descontoCentavos: 0,
    valorLiquidoCentavos: valorCentavos,
    duplicatas,
    origem: "carteira",
    parcelasPersonalizadas: false,
  };
}

export function faturaNfeDoSnapshot(snapshot: unknown): FaturaNfe | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const bruto = (snapshot as { fatura?: unknown }).fatura;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return null;
  }
  const linha = bruto as Record<string, unknown>;
  const valorCentavos = inteiroNaoNegativo(linha.valorCentavos);
  const descontoCentavos = inteiroNaoNegativo(linha.descontoCentavos);
  if (valorCentavos == null || descontoCentavos == null) {
    return null;
  }
  const duplicatasBrutas = Array.isArray(linha.duplicatas) ? linha.duplicatas : [];
  const duplicatas = duplicatasBrutas.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const dup = item as Record<string, unknown>;
    const valor = inteiroPositivo(dup.valorCentavos);
    const vencimento = dataVencimentoIsoLocal(dup.dataVencimento);
    const numero = texto(dup.numero);
    if (valor == null || !vencimento || !numero) {
      return [];
    }
    return [
      {
        numero,
        dataVencimento: vencimento,
        valorCentavos: valor,
        codigoPagamento: codigoPagamentoDuplicataNfe(dup.codigoPagamento),
      },
    ];
  });
  const origem =
    linha.origem === "carteira" || linha.origem === "manual" || linha.origem === "automatica"
      ? linha.origem
      : "manual";
  return {
    numero: texto(linha.numero) || "1",
    valorCentavos,
    descontoCentavos,
    valorLiquidoCentavos:
      inteiroNaoNegativo(linha.valorLiquidoCentavos) ??
      valorLiquidoFaturaCentavos({ valorCentavos, descontoCentavos }),
    duplicatas,
    origem,
    parcelasPersonalizadas: linha.parcelasPersonalizadas === true,
  };
}

export function condicaoPagamentoDoSnapshot(
  snapshot: unknown,
  fatura = faturaNfeDoSnapshot(snapshot)
): CondicaoPagamentoNfe {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return fatura ? "prazo" : "vista";
  }
  const bruto = (snapshot as { condicao_pagamento?: unknown }).condicao_pagamento;
  if (bruto === "prazo" || bruto === "vista") {
    return bruto;
  }
  return fatura ? "prazo" : "vista";
}

export function snapshotFaturaNfe(input: {
  condicao: CondicaoPagamentoNfe;
  fatura: FaturaNfe | null;
}) {
  if (input.condicao !== "prazo" || !input.fatura) {
    return {
      condicao_pagamento: "vista" as const,
      fatura: null,
    };
  }
  return {
    condicao_pagamento: "prazo" as const,
    fatura: {
      numero: input.fatura.numero,
      valorCentavos: input.fatura.valorCentavos,
      descontoCentavos: input.fatura.descontoCentavos,
      valorLiquidoCentavos: input.fatura.valorLiquidoCentavos,
      origem: input.fatura.origem,
      parcelasPersonalizadas: input.fatura.parcelasPersonalizadas,
      duplicatas: input.fatura.duplicatas.map((duplicata) => ({
        numero: duplicata.numero,
        dataVencimento: duplicata.dataVencimento,
        valorCentavos: duplicata.valorCentavos,
        codigoPagamento: duplicata.codigoPagamento ?? null,
      })),
    },
  };
}

export function faturaDivergenteDoTotal(input: {
  fatura: FaturaNfe | null;
  totalAPrazoCentavos: number;
}) {
  if (!input.fatura) {
    return input.totalAPrazoCentavos > 0;
  }
  return input.fatura.valorLiquidoCentavos !== input.totalAPrazoCentavos;
}

export function validarFaturaParaEmissaoNfe(input: {
  condicao: CondicaoPagamentoNfe;
  fatura: FaturaNfe | null;
  totalAPrazoCentavos: number;
  totalVistaCentavos: number;
}): string | null {
  if (input.condicao !== "prazo") {
    if (input.totalAPrazoCentavos > 0) {
      return MENSAGEM_MISTA_SEM_FATURA;
    }
    return null;
  }
  const fatura = input.fatura;
  if (!fatura) {
    return "Informe a fatura e as parcelas da cobrança a prazo.";
  }
  if (!texto(fatura.numero)) {
    return "Informe o número da fatura.";
  }
  if (inteiroPositivo(fatura.valorCentavos) == null) {
    return "O valor original da fatura deve ser maior que zero.";
  }
  if (inteiroNaoNegativo(fatura.descontoCentavos) == null) {
    return "O desconto da fatura é inválido.";
  }
  if (fatura.descontoCentavos >= fatura.valorCentavos) {
    return "O desconto da fatura não pode ser maior ou igual ao valor original.";
  }
  const liquido = valorLiquidoFaturaCentavos({
    valorCentavos: fatura.valorCentavos,
    descontoCentavos: fatura.descontoCentavos,
  });
  if (liquido !== fatura.valorLiquidoCentavos) {
    return MENSAGEM_FATURA_DESCONTO_DIVERGENTE;
  }
  if (fatura.duplicatas.length < 1) {
    return MENSAGEM_FATURA_SEM_DUPLICATA;
  }
  const numeros = new Set<string>();
  for (const duplicata of fatura.duplicatas) {
    if (!texto(duplicata.numero)) {
      return "Toda parcela precisa de número.";
    }
    if (numeros.has(duplicata.numero)) {
      return `Há parcelas com o mesmo número (${duplicata.numero}).`;
    }
    numeros.add(duplicata.numero);
    if (!validarDataFiscal(duplicata.dataVencimento)) {
      return `Vencimento inválido na parcela ${duplicata.numero}.`;
    }
    if (inteiroPositivo(duplicata.valorCentavos) == null) {
      return `Valor inválido na parcela ${duplicata.numero}.`;
    }
  }
  if (somaDuplicatasCentavos(fatura.duplicatas) !== liquido) {
    return MENSAGEM_FATURA_SOMA_DIVERGENTE;
  }
  if (liquido !== input.totalAPrazoCentavos) {
    return MENSAGEM_FATURA_PRAZO_DIVERGENTE;
  }
  return null;
}

export function faturaParaPayloadGeranet(
  fatura: FaturaNfe | null
): FaturaGeranetNfe | null {
  if (!fatura) {
    return null;
  }
  return {
    numero: fatura.numero,
    valor: fatura.valorCentavos / 100,
    desconto: fatura.descontoCentavos / 100,
    valorLiquido: fatura.valorLiquidoCentavos / 100,
    duplicatas: fatura.duplicatas.map((duplicata) => {
      const codigo = codigoPagamentoDuplicataNfe(duplicata.codigoPagamento);
      return {
        numero: duplicata.numero,
        dataVencimento: duplicata.dataVencimento,
        valor: duplicata.valorCentavos / 100,
        ...(codigo ? { codigoPagamento: codigo } : {}),
      };
    }),
  };
}

export function indicadorPagamentoDetalheNfe(input: {
  temFatura: boolean;
  vendaInteiraAPrazo: boolean;
  permiteFiado?: boolean | null;
  permiteParcelamento?: boolean | null;
  indicadorAtual?: string | null;
}) {
  if (input.permiteFiado) {
    return "1";
  }
  if (input.temFatura && input.vendaInteiraAPrazo) {
    return "1";
  }
  if (input.temFatura && input.permiteParcelamento) {
    return "1";
  }
  if (input.indicadorAtual === "0" || input.indicadorAtual === "1") {
    return input.indicadorAtual;
  }
  return "0";
}
