export const CODIGOS_TIPO_OPERACAO_INTERNO = [
  "venda",
  "devolucao_venda",
  "devolucao_fornecedor",
  "bonificacao",
  "transferencia",
  "remessa",
  "retorno",
  "complementar",
  "ajuste",
  "nota_credito",
  "nota_debito",
  "outra",
] as const;

export type CodigoTipoOperacaoInterno =
  (typeof CODIGOS_TIPO_OPERACAO_INTERNO)[number];

export type TpNf = "0" | "1";

export type FinNfeSuportada = "1" | "2" | "3" | "4";

export type StatusOperacaoNfe =
  | "disponivel"
  | "configuracao_necessaria"
  | "proxima_etapa"
  | "em_desenvolvimento";

export type NaturezaOperacaoFiscal = {
  id: string;
  empresa_id: string;
  tipo_operacao_interno: string;
  descricao: string;
  tp_nf: string;
  fin_nfe: string;
  padrao: boolean;
  ativo: boolean;
};

export const ROTULOS_TIPO_OPERACAO: Record<
  CodigoTipoOperacaoInterno,
  string
> = {
  venda: "Venda",
  devolucao_venda: "Devolução de venda",
  devolucao_fornecedor: "Devolução para fornecedor",
  bonificacao: "Bonificação",
  transferencia: "Transferência",
  remessa: "Remessa",
  retorno: "Retorno",
  complementar: "NF-e complementar",
  ajuste: "NF-e de ajuste",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  outra: "Outra operação",
};

export const ROTULOS_TP_NF: Record<TpNf, string> = {
  "0": "0 — Entrada",
  "1": "1 — Saída",
};

export const ROTULOS_FIN_NFE: Record<FinNfeSuportada, string> = {
  "1": "1 — Normal",
  "2": "2 — Complementar",
  "3": "3 — Ajuste",
  "4": "4 — Devolução",
};

export const MENSAGEM_CFOP_NAO_CONFIGURADO =
  "Esta operação ainda não possui regras de CFOP configuradas. Configure a natureza e as regras fiscais antes de emitir.";

export const MENSAGEM_CFOP_NATUREZA_GRUPO_NAO_CONFIGURADO =
  "Não existe regra de CFOP configurada para esta natureza de operação e grupo fiscal.";

export const MENSAGEM_NATUREZA_VENDA_AUSENTE =
  "Não há natureza de operação padrão de venda cadastrada. Cadastre em Configurações → Fiscal → Naturezas de operação.";

export const MENSAGEM_NATUREZA_VENDA_INVALIDA =
  "A natureza selecionada nesta venda não pertence à empresa ativa, não está ativa ou não é uma operação de venda.";

export const MENSAGEM_NATUREZA_INCOMPATIVEL_VENDA_PDV =
  "Esta NF-e veio de uma venda do PDV. A natureza precisa ser de venda da empresa ativa. Para alterar itens, preços, descontos ou pagamentos, use Editar venda.";

export const MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_AUSENTE =
  "Não há natureza de devolução ao fornecedor cadastrada nesta empresa. Cadastre em Configurações → Fiscal → Naturezas de operação, com tipo Devolução para fornecedor.";

export const MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA =
  "A natureza selecionada não pertence à empresa ativa, não está ativa ou não é uma operação de devolução ao fornecedor.";

export const MENSAGEM_NATUREZA_BONIFICACAO_AUSENTE =
  "Não há natureza de bonificação cadastrada nesta empresa. Cadastre em Configurações → Fiscal → Naturezas de operação, com tipo Bonificação. Não cadastre CFOP automaticamente.";

export const MENSAGEM_NATUREZA_BONIFICACAO_INVALIDA =
  "A natureza selecionada não pertence à empresa ativa, não está ativa ou não é uma operação de bonificação.";

export const MENSAGEM_NATUREZA_TRANSFERENCIA_AUSENTE =
  "Não há natureza de transferência cadastrada nesta empresa. Cadastre em Configurações → Fiscal → Naturezas de operação, com tipo Transferência. Não cadastre CFOP automaticamente.";

export const MENSAGEM_NATUREZA_TRANSFERENCIA_INVALIDA =
  "A natureza selecionada não pertence à empresa ativa, não está ativa ou não é uma operação de transferência.";

export const MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL =
  "Não foi possível confirmar que o estabelecimento de destino é elegível para transferência.";

export const MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE =
  "Transferência não aceita cliente comum como destino. Selecione um estabelecimento vinculado.";

export const MENSAGEM_IDENTIDADE_FISCAL_AUSENTE =
  "A emissão não possui natureza, tipo da NF-e (tpNF) ou finalidade (finNFe). A emissão foi bloqueada para não assumir venda automaticamente.";

export const MENSAGEM_OPERACAO_EM_DESENVOLVIMENTO =
  "Esta finalidade ainda está em desenvolvimento no UltraPDV e não pode ser transmitida.";

export const MENSAGEM_OPERACAO_PROXIMA_ETAPA =
  "Esta operação será habilitada na próxima etapa, depois que as regras fiscais estiverem configuradas.";

export const MENSAGEM_OPERACAO_CONFIGURACAO_NECESSARIA =
  "Esta operação está visível, mas ainda não possui natureza e regras de CFOP configuradas com segurança.";

export function ehCodigoTipoOperacaoInterno(
  valor: unknown
): valor is CodigoTipoOperacaoInterno {
  return CODIGOS_TIPO_OPERACAO_INTERNO.includes(
    String(valor ?? "") as CodigoTipoOperacaoInterno
  );
}

export function rotuloTipoOperacao(codigo: string) {
  if (ehCodigoTipoOperacaoInterno(codigo)) {
    return ROTULOS_TIPO_OPERACAO[codigo];
  }

  return codigo;
}

export function ehTpNf(valor: unknown): valor is TpNf {
  return valor === "0" || valor === "1";
}

export function ehFinNfeSuportada(
  valor: unknown
): valor is FinNfeSuportada {
  return (
    valor === "1" ||
    valor === "2" ||
    valor === "3" ||
    valor === "4"
  );
}

export function naturezaVendaFromTextoLegado(descricao: string) {
  return {
    tipo_operacao_interno: "venda" as const,
    descricao: descricao.trim(),
    tp_nf: "1" as const,
    fin_nfe: "1" as const,
    padrao: true,
    ativo: true,
  };
}
