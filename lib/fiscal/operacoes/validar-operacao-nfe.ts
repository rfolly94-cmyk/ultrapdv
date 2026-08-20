import {
  ehCodigoTipoOperacaoInterno,
  MENSAGEM_CFOP_NAO_CONFIGURADO,
  MENSAGEM_OPERACAO_CONFIGURACAO_NECESSARIA,
  MENSAGEM_OPERACAO_EM_DESENVOLVIMENTO,
  MENSAGEM_OPERACAO_PROXIMA_ETAPA,
  ROTULOS_TIPO_OPERACAO,
  type CodigoTipoOperacaoInterno,
  type NaturezaOperacaoFiscal,
  type StatusOperacaoNfe,
} from "./catalogo";
import {
  naturezaEstaCompleta,
} from "./resolver-natureza";

export type DisponibilidadeOperacaoNfe = {
  codigo: CodigoTipoOperacaoInterno;
  rotulo: string;
  status: StatusOperacaoNfe;
  disponivelParaEmissao: boolean;
  podeChegarEmitir: boolean;
  motivo: string;
};

function statusBase(
  codigo: CodigoTipoOperacaoInterno
): StatusOperacaoNfe {
  if (codigo === "nota_credito" || codigo === "nota_debito") {
    return "em_desenvolvimento";
  }

  if (
    codigo === "complementar" ||
    codigo === "ajuste" ||
    codigo === "remessa" ||
    codigo === "retorno" ||
    codigo === "devolucao_venda"
  ) {
    return "proxima_etapa";
  }

  if (
    codigo === "venda" ||
    codigo === "devolucao_fornecedor" ||
    codigo === "bonificacao" ||
    codigo === "transferencia"
  ) {
    return "disponivel";
  }

  return "configuracao_necessaria";
}

export function classificarOperacaoNfe(params: {
  codigo: string;
  natureza?: NaturezaOperacaoFiscal | null;
  empresaIdAtiva?: string;
  possuiNaturezaCompativel?: boolean;
  possuiRegraCfop?: boolean;
}): DisponibilidadeOperacaoNfe {
  const codigo = ehCodigoTipoOperacaoInterno(params.codigo)
    ? params.codigo
    : "outra";
  const rotulo = ROTULOS_TIPO_OPERACAO[codigo];
  const statusInicial = statusBase(codigo);

  if (statusInicial === "em_desenvolvimento") {
    return {
      codigo,
      rotulo,
      status: "em_desenvolvimento",
      disponivelParaEmissao: false,
      podeChegarEmitir: false,
      motivo: MENSAGEM_OPERACAO_EM_DESENVOLVIMENTO,
    };
  }

  if (statusInicial === "proxima_etapa") {
    return {
      codigo,
      rotulo,
      status: "proxima_etapa",
      disponivelParaEmissao: false,
      podeChegarEmitir: false,
      motivo: MENSAGEM_OPERACAO_PROXIMA_ETAPA,
    };
  }

  if (codigo === "venda") {
    const ok = naturezaEstaCompleta(
      params.natureza,
      params.empresaIdAtiva
    );

    return {
      codigo,
      rotulo,
      status: ok ? "disponivel" : "configuracao_necessaria",
      disponivelParaEmissao: ok,
      podeChegarEmitir: ok,
      motivo: ok
        ? `${params.natureza?.descricao} · tpNF ${params.natureza?.tp_nf} · finNFe ${params.natureza?.fin_nfe}`
        : "Cadastre a natureza padrão de venda antes de emitir.",
    };
  }

  if (codigo === "bonificacao" || codigo === "transferencia") {
    const temNatureza = Boolean(params.possuiNaturezaCompativel);
    return {
      codigo,
      rotulo,
      status: temNatureza ? "disponivel" : "configuracao_necessaria",
      disponivelParaEmissao: temNatureza,
      podeChegarEmitir: true,
      motivo: temNatureza
        ? `Cadastre a matriz de CFOP desta natureza. Sem regra, a verificação bloqueia a emissão.`
        : "Cadastre a natureza em Configurações → Fiscal → Naturezas. A operação pode ser criada; a emissão só segue com CFOP configurado.",
    };
  }

  if (codigo === "outra" && !params.possuiNaturezaCompativel) {
    return {
      codigo,
      rotulo,
      status: "configuracao_necessaria",
      disponivelParaEmissao: false,
      podeChegarEmitir: false,
      motivo:
        "Outra operação só fica disponível quando houver natureza compatível configurada.",
    };
  }

  if (!params.possuiRegraCfop) {
    return {
      codigo,
      rotulo,
      status: "configuracao_necessaria",
      disponivelParaEmissao: false,
      podeChegarEmitir: false,
      motivo: params.possuiNaturezaCompativel
        ? MENSAGEM_CFOP_NAO_CONFIGURADO
        : MENSAGEM_OPERACAO_CONFIGURACAO_NECESSARIA,
    };
  }

  return {
    codigo,
    rotulo,
    status: "configuracao_necessaria",
    disponivelParaEmissao: false,
    podeChegarEmitir: false,
    motivo: MENSAGEM_OPERACAO_CONFIGURACAO_NECESSARIA,
  };
}

export function operacaoPodeChegarEmitir(
  codigo: string,
  contexto: {
    natureza?: NaturezaOperacaoFiscal | null;
    empresaIdAtiva?: string;
    possuiNaturezaCompativel?: boolean;
    possuiRegraCfop?: boolean;
  } = {}
) {
  return classificarOperacaoNfe({
    codigo,
    ...contexto,
  }).podeChegarEmitir;
}
