export const CONTROLE_CAIXA_ATIVO_PADRAO = true;

export function controleCaixaAtivoDoRegistro(valor: unknown): boolean {
  if (valor === false) {
    return false;
  }
  return CONTROLE_CAIXA_ATIVO_PADRAO;
}

/**
 * Decisão explícita: o fluxo pede Caixa E a empresa está com o controle ativo.
 * Nunca “tenta Caixa e ignora o erro”.
 */
export function deveUsarLivroCaixa(input: {
  controleAtivo: boolean;
  fluxoExigeCaixa: boolean;
}): boolean {
  return input.controleAtivo === true && input.fluxoExigeCaixa === true;
}

export function rpcReceberCarteiraPorControle(controleAtivo: boolean) {
  return controleAtivo
    ? "rpc_receber_carteira_com_caixa"
    : "rpc_receber_carteira_cliente";
}

export function rpcEstornarCarteiraPorControle(controleAtivo: boolean) {
  return controleAtivo
    ? "rpc_estornar_recebimento_carteira_com_caixa"
    : "rpc_estornar_recebimento_carteira";
}

export function sessaoCaixaLiberadaParaOperar(input: {
  controleAtivo: boolean;
  caixaAberto: boolean;
}): boolean {
  if (!input.controleAtivo) {
    return true;
  }
  return input.caixaAberto;
}
