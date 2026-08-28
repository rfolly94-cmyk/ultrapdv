import {
  CONFIGURACAO_NOTIFICACOES_PADRAO,
  TIPOS_NOTIFICACAO,
  type ConfiguracaoNotificacoes,
  type TipoNotificacao,
} from "./tipos";

function booleano(valor: unknown, padrao: boolean) {
  return typeof valor === "boolean" ? valor : padrao;
}

function inteiroNaoNegativo(valor: unknown, padrao: number, maximo: number) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0 || numero > maximo) {
    return padrao;
  }
  return Math.floor(numero);
}

export function normalizarConfiguracaoNotificacoes(
  valor: unknown
): ConfiguracaoNotificacoes {
  const bruto =
    valor && typeof valor === "object"
      ? (valor as Record<string, unknown>)
      : {};

  return {
    estoqueBaixo: booleano(
      bruto.estoqueBaixo,
      CONFIGURACAO_NOTIFICACOES_PADRAO.estoqueBaixo
    ),
    estoqueZerado: booleano(
      bruto.estoqueZerado,
      CONFIGURACAO_NOTIFICACOES_PADRAO.estoqueZerado
    ),
    estoqueNegativo: booleano(
      bruto.estoqueNegativo,
      CONFIGURACAO_NOTIFICACOES_PADRAO.estoqueNegativo
    ),
    estoqueMinimoPadrao: inteiroNaoNegativo(
      bruto.estoqueMinimoPadrao,
      CONFIGURACAO_NOTIFICACOES_PADRAO.estoqueMinimoPadrao,
      1_000_000
    ),
    loteVencendo: booleano(
      bruto.loteVencendo,
      CONFIGURACAO_NOTIFICACOES_PADRAO.loteVencendo
    ),
    loteVencido: booleano(
      bruto.loteVencido,
      CONFIGURACAO_NOTIFICACOES_PADRAO.loteVencido
    ),
    antecedenciaValidadeDias: inteiroNaoNegativo(
      bruto.antecedenciaValidadeDias,
      CONFIGURACAO_NOTIFICACOES_PADRAO.antecedenciaValidadeDias,
      365
    ),
    carteiraVencida: booleano(
      bruto.carteiraVencida,
      CONFIGURACAO_NOTIFICACOES_PADRAO.carteiraVencida
    ),
    fiscalRejeitada: booleano(
      bruto.fiscalRejeitada,
      CONFIGURACAO_NOTIFICACOES_PADRAO.fiscalRejeitada
    ),
    fiscalAguardandoReconciliacao: booleano(
      bruto.fiscalAguardandoReconciliacao,
      CONFIGURACAO_NOTIFICACOES_PADRAO.fiscalAguardandoReconciliacao
    ),
    fiscalCertificadoVencendo: booleano(
      bruto.fiscalCertificadoVencendo,
      CONFIGURACAO_NOTIFICACOES_PADRAO.fiscalCertificadoVencendo
    ),
    fiscalRevisaoBase: booleano(
      bruto.fiscalRevisaoBase,
      CONFIGURACAO_NOTIFICACOES_PADRAO.fiscalRevisaoBase
    ),
    antecedenciaCertificadoDias: inteiroNaoNegativo(
      bruto.antecedenciaCertificadoDias,
      CONFIGURACAO_NOTIFICACOES_PADRAO.antecedenciaCertificadoDias,
      365
    ),
    caixaAbertoAnterior: booleano(
      bruto.caixaAbertoAnterior,
      CONFIGURACAO_NOTIFICACOES_PADRAO.caixaAbertoAnterior
    ),
  };
}

export function tiposNotificacaoHabilitados(
  config: ConfiguracaoNotificacoes
): TipoNotificacao[] {
  const mapa: Record<TipoNotificacao, boolean> = {
    estoque_baixo: config.estoqueBaixo,
    estoque_zerado: config.estoqueZerado,
    estoque_negativo: config.estoqueNegativo,
    lote_vencendo: config.loteVencendo,
    lote_vencido: config.loteVencido,
    carteira_vencida: config.carteiraVencida,
    fiscal_rejeitada: config.fiscalRejeitada,
    fiscal_aguardando_reconciliacao: config.fiscalAguardandoReconciliacao,
    fiscal_certificado_vencendo: config.fiscalCertificadoVencendo,
    fiscal_revisao_base: config.fiscalRevisaoBase,
    caixa_aberto_anterior: config.caixaAbertoAnterior,
  };

  return TIPOS_NOTIFICACAO.filter((tipo) => mapa[tipo]);
}

export function minimoEstoqueEfetivo(params: {
  minimoProduto: number;
  minimoPadraoEmpresa: number;
}) {
  if (params.minimoProduto > 0) {
    return params.minimoProduto;
  }
  if (params.minimoPadraoEmpresa > 0) {
    return params.minimoPadraoEmpresa;
  }
  return 0;
}
