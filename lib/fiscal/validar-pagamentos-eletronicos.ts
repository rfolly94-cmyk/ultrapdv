export const TPAG_DINHEIRO = "01";
export const TPAG_CARTAO_CREDITO = "03";
export const TPAG_CARTAO_DEBITO = "04";
export const TPAG_PIX_DINAMICO = "17";
export const TPAG_PIX_ESTATICO = "20";

/**
 * PIX estático (tPag 20) ficou de fora de propósito.
 * O código 20 entrou depois na tabela nacional.
 * A política de vinculação da SEFAZ-MT/Geranet para 20
 * ainda não está confirmada. Não herdar a regra do 17.
 */
export const POLITICA_PIX_ESTATICO_TPAG_20 =
  "nao_exigir_vinculacao_ainda" as const;

export const TPAG_EXIGEM_VINCULACAO_ELETRONICA = [
  TPAG_CARTAO_CREDITO,
  TPAG_CARTAO_DEBITO,
  TPAG_PIX_DINAMICO,
] as const;

export type TPagComVinculacaoEletronica =
  (typeof TPAG_EXIGEM_VINCULACAO_ELETRONICA)[number];

export type PagamentoParaProntidaoEletronica = {
  forma_pagamento_nome?: string | null;
  forma_pagamento_codigo?: string | null;
  codigo_fiscal?: string | null;
  valor?: number | string | null;
  bandeira?: string | null;
  autorizacao?: string | null;
  tipo_integracao?: string | null;
  cnpj_credenciadora?: string | null;
  cnpj_receb?: string | null;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function numero(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatarReais(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function nomeDocumento(modelo: "55" | "65") {
  return modelo === "55" ? "NF-e" : "NFC-e";
}

function nomeForma(
  pagamento: PagamentoParaProntidaoEletronica,
  tPag: string
) {
  const nome = texto(pagamento.forma_pagamento_nome);

  if (nome) {
    return nome;
  }

  if (tPag === TPAG_CARTAO_CREDITO) {
    return "Cartão de Crédito";
  }

  if (tPag === TPAG_CARTAO_DEBITO) {
    return "Cartão de Débito";
  }

  if (tPag === TPAG_PIX_DINAMICO) {
    return "PIX Dinâmico";
  }

  return texto(pagamento.forma_pagamento_codigo) || `tPag ${tPag}`;
}

export function tPagExigeVinculacaoEletronica(
  codigoFiscal: string | null | undefined
): codigoFiscal is TPagComVinculacaoEletronica {
  const tPag = texto(codigoFiscal);
  return (
    tPag === TPAG_CARTAO_CREDITO ||
    tPag === TPAG_CARTAO_DEBITO ||
    tPag === TPAG_PIX_DINAMICO
  );
}

/**
 * Dados reais da transação eletrônica.
 * Não inventar. Sem TEF/POS hoje, estes campos não existem
 * ou estão vazios — a emissão deve ser bloqueada.
 */
export function pagamentoEletronicoTemDadosReais(
  pagamento: PagamentoParaProntidaoEletronica
) {
  return (
    texto(pagamento.tipo_integracao) === "1" &&
    somenteDigitos(pagamento.cnpj_credenciadora).length === 14 &&
    texto(pagamento.bandeira).length > 0 &&
    texto(pagamento.autorizacao).length > 0 &&
    somenteDigitos(pagamento.cnpj_receb).length === 14
  );
}

export function validarPagamentosEletronicosParaEmissao(input: {
  pagamentos: PagamentoParaProntidaoEletronica[];
  modelo: "55" | "65";
}) {
  for (const pagamento of input.pagamentos) {
    const tPag = texto(pagamento.codigo_fiscal);

    if (tPag === TPAG_PIX_ESTATICO) {
      continue;
    }

    if (!tPagExigeVinculacaoEletronica(tPag)) {
      continue;
    }

    if (pagamentoEletronicoTemDadosReais(pagamento)) {
      continue;
    }

    const nome = nomeForma(pagamento, tPag);
    const valor = formatarReais(numero(pagamento.valor));
    const documento = nomeDocumento(input.modelo);

    return [
      "Pagamento eletrônico sem integração fiscal.",
      `A venda possui ${nome}, mas os dados da transação necessários para a ${documento} não estão disponíveis.`,
      "Nenhum número fiscal foi reservado.",
      `${nome} — ${valor}`,
    ].join("\n");
  }

  return null;
}
