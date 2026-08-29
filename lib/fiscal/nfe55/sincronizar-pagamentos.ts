import {
  avaliarPagamentosPdv,
  formatarCentavosBr,
  type AvaliacaoPagamentosPdv,
} from "@/lib/pdv/pagamentos-teto";

export const MENSAGEM_PAGAMENTOS_NFE_INCOMPLETOS =
  "Pagamentos não conferem com o total da venda.";

export function centavosDeTextoPagamento(valor: string) {
  let texto = String(valor ?? "").trim();
  if (!texto) return 0;
  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) return 0;
  return Math.round(numero * 100);
}

export function textoPagamentoDeCentavos(centavos: number) {
  return (Math.max(0, Math.round(centavos)) / 100).toFixed(2).replace(".", ",");
}

export function mensagemPagamentoNfeIncompleto(restanteCentavos: number) {
  return `${MENSAGEM_PAGAMENTOS_NFE_INCOMPLETOS} Faltam ${formatarCentavosBr(restanteCentavos)}.`;
}

export type PagamentoSincronizavelNfe = {
  formaPagamentoId: string;
  valorCentavos: number;
};

export function sincronizarPagamentoUnicoComTotal(input: {
  totalVendaCentavos: number;
  pagamentos: PagamentoSincronizavelNfe[];
  permiteTrocoPorFormaId: Readonly<Record<string, boolean>>;
}): {
  pagamentos: PagamentoSincronizavelNfe[];
  sincronizou: boolean;
} {
  const totalVendaCentavos = Math.max(0, Math.round(input.totalVendaCentavos));
  const vigentes = input.pagamentos.filter(
    (pagamento) =>
      pagamento.formaPagamentoId &&
      Number.isInteger(pagamento.valorCentavos) &&
      pagamento.valorCentavos > 0
  );
  if (vigentes.length !== 1 || totalVendaCentavos <= 0) {
    return { pagamentos: input.pagamentos, sincronizou: false };
  }

  const unico = vigentes[0];
  const permiteTroco =
    input.permiteTrocoPorFormaId[unico.formaPagamentoId] === true;

  if (permiteTroco && unico.valorCentavos >= totalVendaCentavos) {
    return { pagamentos: input.pagamentos, sincronizou: false };
  }

  if (unico.valorCentavos === totalVendaCentavos) {
    return { pagamentos: input.pagamentos, sincronizou: false };
  }

  return {
    pagamentos: [{ ...unico, valorCentavos: totalVendaCentavos }],
    sincronizou: true,
  };
}

export function pagamentosNfeFechamTotal(avaliacao: AvaliacaoPagamentosPdv) {
  return (
    !avaliacao.bloqueado &&
    avaliacao.restanteCentavos === 0 &&
    (avaliacao.totalVendaCentavos <= 0 || avaliacao.totalInformadoCentavos > 0)
  );
}

export function compensarDiferencaSubtotalCatalogo(input: {
  subtotalCatalogoCentavos: number;
  subtotalAlvoCentavos: number;
  descontoCentavos: number;
  acrescimoCentavos: number;
}) {
  // Só para o motor comercial do PDV, que grava produtos.preco_venda.
  // Não é vOutro fiscal. A emissão da NF-e usa o preço editado na operação
  // e totais_nota.outro explícito — nunca esta diferença.
  const delta =
    Math.round(input.subtotalAlvoCentavos) - Math.round(input.subtotalCatalogoCentavos);
  if (delta > 0) {
    return {
      descontoCentavos: Math.max(0, Math.round(input.descontoCentavos)),
      acrescimoCentavos: Math.max(0, Math.round(input.acrescimoCentavos)) + delta,
    };
  }
  if (delta < 0) {
    return {
      descontoCentavos: Math.max(0, Math.round(input.descontoCentavos)) - delta,
      acrescimoCentavos: Math.max(0, Math.round(input.acrescimoCentavos)),
    };
  }
  return {
    descontoCentavos: Math.max(0, Math.round(input.descontoCentavos)),
    acrescimoCentavos: Math.max(0, Math.round(input.acrescimoCentavos)),
  };
}

export function avaliarPagamentosDigitadosNfe(input: {
  totalVendaCentavos: number;
  pagamentos: Array<{ formaPagamentoId: string; valorTexto: string }>;
  permiteTrocoPorFormaId: Readonly<Record<string, boolean>>;
}) {
  return avaliarPagamentosPdv({
    totalVendaCentavos: input.totalVendaCentavos,
    pagamentos: input.pagamentos.flatMap((pagamento) => {
      const valorCentavos = centavosDeTextoPagamento(pagamento.valorTexto);
      if (valorCentavos <= 0) {
        return [];
      }
      return [
        {
          valorCentavos,
          permiteTroco:
            input.permiteTrocoPorFormaId[pagamento.formaPagamentoId] === true,
        },
      ];
    }),
  });
}
