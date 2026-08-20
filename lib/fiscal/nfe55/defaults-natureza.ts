import { classificarOperacaoNfe } from "@/lib/fiscal/operacoes/validar-operacao-nfe";

export type TipoOperacaoEmitivelNfe = "venda" | "bonificacao" | "transferencia";

export type CatalogoTipoOperacaoNfe = {
  codigo: string;
  rotulo?: string | null;
  movimenta_estoque?: boolean | null;
  vincula_venda?: boolean | null;
  requer_documento_origem?: boolean | null;
  disponivel?: boolean | null;
};

export const MENSAGEM_AVISO_DEVOLUCAO_ENTRADA =
  "Devolução ao fornecedor parte da nota de entrada.";

export function tipoOperacaoEmitivelNestaTela(
  codigo: string
): codigo is TipoOperacaoEmitivelNfe {
  return codigo === "venda" || codigo === "bonificacao" || codigo === "transferencia";
}

export function destinatarioTipoPeloTipoOperacao(tipoOperacaoInterno: string) {
  return tipoOperacaoInterno === "transferencia" ? "estabelecimento" : "cliente";
}

export function naturezaExigeFinanceiro(tipo: CatalogoTipoOperacaoNfe | null | undefined) {
  return tipo?.vincula_venda === true;
}

export function naturezaMovimentaEstoque(tipo: CatalogoTipoOperacaoNfe | null | undefined) {
  return tipo?.movimenta_estoque === true;
}

export function mensagemNaturezaNaoEmitivelNestaTela(tipoOperacaoInterno: string) {
  if (tipoOperacaoInterno === "devolucao_fornecedor") {
    return MENSAGEM_AVISO_DEVOLUCAO_ENTRADA;
  }
  return classificarOperacaoNfe({ codigo: tipoOperacaoInterno }).motivo;
}

export function avisoNaturezaNestaTela(tipoOperacaoInterno: string): {
  tom: "info" | "alerta";
  texto: string;
} | null {
  if (!tipoOperacaoInterno || tipoOperacaoEmitivelNestaTela(tipoOperacaoInterno)) {
    return null;
  }
  const texto = mensagemNaturezaNaoEmitivelNestaTela(tipoOperacaoInterno);
  if (tipoOperacaoInterno === "devolucao_fornecedor") {
    return { tom: "info", texto };
  }
  return { tom: "alerta", texto };
}
