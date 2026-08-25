export const MENSAGEM_TROCO_SEM_FORMA =
  "Foi informado troco, mas nenhuma forma selecionada permite troco.";

export const MENSAGEM_PAGAMENTOS_ULTRAPASSAM =
  "Valor dos pagamentos ultrapassa o total da venda.";

export const MENSAGEM_PIX_ULTRAPASSA_SALDO =
  "Valor do PIX ultrapassa o saldo restante da venda.";

export type PagamentoTeto = {
  valorCentavos: number;
  permiteTroco: boolean;
};

export type AvaliacaoPagamentosPdv = {
  totalVendaCentavos: number;
  totalInformadoCentavos: number;
  restanteCentavos: number;
  excedenteCentavos: number;
  trocoCentavos: number;
  somaNaoTrocoCentavos: number;
  bloqueado: boolean;
  mensagem: string | null;
};

function inteiroNaoNegativo(valor: number) {
  return Number.isInteger(valor) && valor >= 0;
}

export function formatarCentavosBr(centavos: number) {
  return (Math.round(centavos) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function montarMensagemExcedente(params: {
  totalVendaCentavos: number;
  totalInformadoCentavos: number;
  excedenteCentavos: number;
}) {
  return [
    MENSAGEM_PAGAMENTOS_ULTRAPASSAM,
    `Total da venda: ${formatarCentavosBr(params.totalVendaCentavos)}`,
    `Pagamentos informados: ${formatarCentavosBr(params.totalInformadoCentavos)}`,
    `Excedente: ${formatarCentavosBr(params.excedenteCentavos)}`,
  ].join("\n");
}

export function avaliarPagamentosPdv(params: {
  totalVendaCentavos: number;
  pagamentos: PagamentoTeto[];
}): AvaliacaoPagamentosPdv {
  const totalVendaCentavos = Math.round(params.totalVendaCentavos);
  let totalInformadoCentavos = 0;
  let somaNaoTrocoCentavos = 0;
  let somaTrocoCentavos = 0;

  for (const pagamento of params.pagamentos) {
    const valor = Math.round(pagamento.valorCentavos);
    if (!inteiroNaoNegativo(valor) || valor <= 0) {
      continue;
    }

    totalInformadoCentavos += valor;
    if (pagamento.permiteTroco) {
      somaTrocoCentavos += valor;
    } else {
      somaNaoTrocoCentavos += valor;
    }
  }

  const restanteCentavos = Math.max(0, totalVendaCentavos - totalInformadoCentavos);
  const excedenteCentavos = Math.max(0, totalInformadoCentavos - totalVendaCentavos);
  const naoTrocoEstoura = somaNaoTrocoCentavos > totalVendaCentavos;
  const trocoNaoCoberto = excedenteCentavos > somaTrocoCentavos;
  const bloqueado = naoTrocoEstoura || trocoNaoCoberto;
  const trocoCentavos = bloqueado ? 0 : excedenteCentavos;

  return {
    totalVendaCentavos,
    totalInformadoCentavos,
    restanteCentavos,
    excedenteCentavos,
    trocoCentavos,
    somaNaoTrocoCentavos,
    bloqueado,
    mensagem: bloqueado
      ? montarMensagemExcedente({
          totalVendaCentavos,
          totalInformadoCentavos,
          excedenteCentavos: Math.max(
            excedenteCentavos,
            somaNaoTrocoCentavos - totalVendaCentavos
          ),
        })
      : null,
  };
}

export function validarParcelaPixContraSaldo(params: {
  valorPixCentavos: number;
  saldoRestanteCentavos: number;
}) {
  const valor = Math.round(params.valorPixCentavos);
  const saldo = Math.round(params.saldoRestanteCentavos);

  if (!inteiroNaoNegativo(valor) || valor <= 0) {
    throw new Error("Informe um valor PIX maior que zero.");
  }

  if (!inteiroNaoNegativo(saldo) || valor > saldo) {
    throw new Error(MENSAGEM_PIX_ULTRAPASSA_SALDO);
  }
}

export function saldoRestanteParaParcela(params: {
  totalVendaCentavos: number;
  outrosPagamentosCentavos: number;
}) {
  return Math.max(
    0,
    Math.round(params.totalVendaCentavos) -
      Math.round(params.outrosPagamentosCentavos)
  );
}

export function recalcularTotalLiquidoVenda(params: {
  itens: Array<{
    quantidade: number;
    precoUnitarioCentavos: number;
  }>;
  descontoCentavos: number;
  freteCentavos?: number;
  acrescimoCentavos?: number;
}) {
  const subtotalCentavos = params.itens.reduce(
    (acumulado, item) =>
      acumulado +
      Math.round(item.quantidade) * Math.round(item.precoUnitarioCentavos),
    0
  );
  const descontoCentavos = Math.min(
    Math.max(0, Math.round(params.descontoCentavos)),
    subtotalCentavos
  );
  const extrasCentavos =
    Math.max(0, Math.round(params.freteCentavos ?? 0)) +
    Math.max(0, Math.round(params.acrescimoCentavos ?? 0));
  return Math.max(0, subtotalCentavos - descontoCentavos + extrasCentavos);
}
