export type FormaDistribuicaoPdv = {
  id: string;
  codigo?: string | null;
  nome?: string | null;
  tipo?: string | null;
  permite_troco?: boolean | null;
  permite_fiado?: boolean | null;
};

export type PagamentoDigitadoPdv = {
  formaPagamentoId: string;
  valorTexto: string;
};

export type AberturaPagamentoPdv = {
  pagamentos: PagamentoDigitadoPdv[];
  dinheiroAutomatico: boolean;
  formaSelecionadaId: string | null;
};

function chaveForma(forma: FormaDistribuicaoPdv) {
  return `${forma.codigo ?? ""} ${forma.nome ?? ""} ${forma.tipo ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function ehFormaDinheiroPdv(forma: FormaDistribuicaoPdv) {
  if (forma.permite_fiado === true) {
    return false;
  }

  const chave = chaveForma(forma);
  if (
    chave.includes("pix") ||
    chave.includes("cartao") ||
    chave.includes("debito") ||
    chave.includes("credito") ||
    chave.includes("fiado")
  ) {
    return false;
  }

  return chave.includes("dinheiro") || forma.permite_troco === true;
}

export function escolherFormaDinheiroPdv<T extends FormaDistribuicaoPdv>(
  formas: T[]
) {
  const candidatas = formas.filter((forma) => ehFormaDinheiroPdv(forma));
  return (
    candidatas.find((forma) => chaveForma(forma).includes("dinheiro")) ??
    candidatas[0] ??
    null
  );
}

export function textoParaCentavosPdv(valor: string) {
  let texto = String(valor ?? "").trim();
  if (!texto) {
    return 0;
  }

  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) {
    return 0;
  }

  return Math.round(numero * 100);
}

export function centavosParaInputPdv(centavos: number) {
  return (Math.max(0, Math.round(centavos)) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

export function saldoDinheiroAutomaticoPdv(
  totalCentavos: number,
  outrosCentavos: number
) {
  return Math.max(0, Math.round(totalCentavos) - Math.round(outrosCentavos));
}

function formasCheckout(formas: FormaDistribuicaoPdv[]) {
  return formas.filter((forma) => forma.permite_fiado !== true);
}

export function pagamentosAberturaPdv(params: {
  formas: FormaDistribuicaoPdv[];
  totalCentavos: number;
}): AberturaPagamentoPdv {
  const visiveis = formasCheckout(params.formas);
  const dinheiro = escolherFormaDinheiroPdv(visiveis);
  const total = Math.max(0, Math.round(params.totalCentavos));

  return {
    dinheiroAutomatico: true,
    formaSelecionadaId: dinheiro?.id ?? visiveis[0]?.id ?? null,
    pagamentos: visiveis.map((forma) => ({
      formaPagamentoId: forma.id,
      valorTexto: centavosParaInputPdv(forma.id === dinheiro?.id ? total : 0),
    })),
  };
}

export function somaOutrasFormasPdv(params: {
  pagamentos: PagamentoDigitadoPdv[];
  dinheiroId: string | null;
}) {
  return params.pagamentos.reduce((acumulado, pagamento) => {
    if (pagamento.formaPagamentoId === params.dinheiroId) {
      return acumulado;
    }
    return acumulado + textoParaCentavosPdv(pagamento.valorTexto);
  }, 0);
}

export function sincronizarDinheiroResidualPdv(params: {
  formas: FormaDistribuicaoPdv[];
  pagamentos: PagamentoDigitadoPdv[];
  totalCentavos: number;
}) {
  const dinheiro = escolherFormaDinheiroPdv(formasCheckout(params.formas));
  if (!dinheiro) {
    return params.pagamentos;
  }

  const texto = centavosParaInputPdv(
    saldoDinheiroAutomaticoPdv(
      params.totalCentavos,
      somaOutrasFormasPdv({
        pagamentos: params.pagamentos,
        dinheiroId: dinheiro.id,
      })
    )
  );
  const atual = params.pagamentos.find(
    (pagamento) => pagamento.formaPagamentoId === dinheiro.id
  );
  if (atual?.valorTexto === texto) {
    return params.pagamentos;
  }

  const demais = params.pagamentos.filter(
    (pagamento) => pagamento.formaPagamentoId !== dinheiro.id
  );
  return [
    ...demais,
    { formaPagamentoId: dinheiro.id, valorTexto: texto },
  ];
}

export function aplicarValorFormaPdv(params: {
  formas: FormaDistribuicaoPdv[];
  pagamentos: PagamentoDigitadoPdv[];
  totalCentavos: number;
  dinheiroAutomatico: boolean;
  formaPagamentoId: string;
  valorTexto: string;
  ajustarDinheiro?: boolean;
}) {
  const dinheiro = escolherFormaDinheiroPdv(formasCheckout(params.formas));
  const editouDinheiro = dinheiro?.id === params.formaPagamentoId;
  const dinheiroAutomatico = editouDinheiro
    ? false
    : params.dinheiroAutomatico;
  const mapa = new Map(
    params.pagamentos.map((pagamento) => [
      pagamento.formaPagamentoId,
      pagamento.valorTexto,
    ])
  );
  mapa.set(params.formaPagamentoId, params.valorTexto);

  let pagamentos = [...mapa.entries()].map(([formaPagamentoId, valorTexto]) => ({
    formaPagamentoId,
    valorTexto,
  }));

  if (
    params.ajustarDinheiro !== false &&
    dinheiro &&
    dinheiroAutomatico &&
    !editouDinheiro
  ) {
    pagamentos = sincronizarDinheiroResidualPdv({
      formas: params.formas,
      pagamentos,
      totalCentavos: params.totalCentavos,
    });
  }

  return { pagamentos, dinheiroAutomatico };
}

export function formaAposNavegacaoPdv(
  ids: string[],
  atualId: string | null,
  direcao: "proxima" | "anterior"
) {
  if (ids.length === 0) {
    return null;
  }

  const indiceAtual = atualId ? ids.indexOf(atualId) : -1;
  const base = indiceAtual >= 0 ? indiceAtual : 0;
  const delta = direcao === "proxima" ? 1 : -1;
  const proximo = (base + delta + ids.length) % ids.length;
  return ids[proximo] ?? null;
}

export function aplicarDigitoMonetarioPdv(
  textoAtual: string,
  digito: string,
  substituir: boolean
) {
  if (!/^[\d,.]$/.test(digito)) {
    return { texto: textoAtual, substituir };
  }

  if (substituir) {
    if (digito === "," || digito === ".") {
      return { texto: "0,", substituir: false };
    }
    return { texto: digito, substituir: false };
  }

  if ((digito === "," || digito === ".") && textoAtual.includes(",")) {
    return { texto: textoAtual, substituir: false };
  }

  return {
    texto: `${textoAtual}${digito === "." ? "," : digito}`,
    substituir: false,
  };
}
