export type KindFiscalPosVenda =
  | "autorizada"
  | "aguardando_reconciliacao"
  | "rejeitada"
  | "nao_transmitida"
  | "nao_classificada"
  | "erro";

export type FiscalPosVenda = {
  emitindo: boolean;
  kind: KindFiscalPosVenda | null;
  status: string | null;
  mensagem: string;
  emissaoId: string | null;
  danfeDisponivel: boolean;
};

export type EntradaAcoesPosVenda = {
  emitirNfceAutomatico: boolean;
  vendaId: string;
  imprimirApos: boolean;
  fiscal: FiscalPosVenda | null;
};

export type AcoesPosVenda = {
  rotuloFiscal: string | null;
  detalheFiscal: string | null;
  mostrarStatusFiscal: boolean;
  mostrarImprimirNfce: boolean;
  mostrarImprimirReciboNormal: boolean;
  mostrarVerSituacaoFiscal: boolean;
  rotuloBotaoRecibo: string;
  hrefDanfe: string | null;
  hrefRecibo: string;
  hrefSituacaoFiscal: string;
  podeReenviarNfce: boolean;
  autoAbrir: "danfe" | "recibo" | null;
};

export function rotuloStatusNfcePosVenda(fiscal: FiscalPosVenda) {
  if (fiscal.emitindo) {
    return "NFC-e";
  }

  if (fiscal.kind === "autorizada") {
    return fiscal.danfeDisponivel
      ? "NFC-e autorizada"
      : "NFC-e autorizada — DANFE indisponível";
  }

  if (fiscal.kind === "aguardando_reconciliacao") {
    return "NFC-e aguardando reconciliação";
  }

  if (fiscal.kind === "rejeitada") {
    return "NFC-e rejeitada";
  }

  if (fiscal.status === "erro_comunicacao" || fiscal.kind === "erro") {
    return "NFC-e não emitida";
  }

  return "NFC-e não emitida";
}

function danfeImprimivel(fiscal: FiscalPosVenda | null) {
  return Boolean(
    fiscal &&
      !fiscal.emitindo &&
      fiscal.kind === "autorizada" &&
      fiscal.emissaoId &&
      fiscal.danfeDisponivel
  );
}

export function resolverAcoesPosVendaPdv(
  input: EntradaAcoesPosVenda
): AcoesPosVenda {
  const vendaId = String(input.vendaId ?? "").trim();
  const hrefRecibo = `/pdv/imprimir/recibo/${vendaId}?auto=1`;
  const hrefSituacaoFiscal = `/vendas/${vendaId}`;
  const fiscal = input.fiscal;

  if (!input.emitirNfceAutomatico) {
    return {
      rotuloFiscal: null,
      detalheFiscal: null,
      mostrarStatusFiscal: false,
      mostrarImprimirNfce: false,
      mostrarImprimirReciboNormal: true,
      mostrarVerSituacaoFiscal: false,
      rotuloBotaoRecibo: "Imprimir recibo",
      hrefDanfe: null,
      hrefRecibo,
      hrefSituacaoFiscal,
      podeReenviarNfce: false,
      autoAbrir: input.imprimirApos ? "recibo" : null,
    };
  }

  const hrefDanfe =
    fiscal?.emissaoId
      ? `/api/fiscal/emissoes/${fiscal.emissaoId}/arquivo?tipo=pdf`
      : null;
  const imprimirDanfe = danfeImprimivel(fiscal);

  return {
    rotuloFiscal: fiscal ? rotuloStatusNfcePosVenda(fiscal) : "NFC-e",
    detalheFiscal: fiscal?.mensagem ?? "Emitindo NFC-e...",
    mostrarStatusFiscal: true,
    mostrarImprimirNfce: imprimirDanfe,
    mostrarImprimirReciboNormal: !imprimirDanfe,
    mostrarVerSituacaoFiscal: Boolean(fiscal && !fiscal.emitindo && !imprimirDanfe),
    rotuloBotaoRecibo: "Imprimir recibo normal",
    hrefDanfe: imprimirDanfe ? hrefDanfe : null,
    hrefRecibo,
    hrefSituacaoFiscal,
    podeReenviarNfce: false,
    autoAbrir: !fiscal || fiscal.emitindo
      ? null
      : imprimirDanfe
        ? input.imprimirApos
          ? "danfe"
          : null
        : null,
  };
}
