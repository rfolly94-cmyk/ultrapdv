export type AlertaCombinacaoPlano = {
  codigo: string;
  mensagem: string;
};

/**
 * Avisos comerciais. Não bloqueiam salvar e não alteram enforcement.
 */
export function alertasCombinacaoPlano(
  recursos: Record<string, boolean>
): AlertaCombinacaoPlano[] {
  const alertas: AlertaCombinacaoPlano[] = [];

  if (recursos.cce && !recursos.nfe) {
    alertas.push({
      codigo: "cce_sem_nfe",
      mensagem:
        "CC-e está ligada sem NF-e. A carta de correção costuma acompanhar a emissão de NF-e.",
    });
  }

  if (recursos.inutilizacao_fiscal && !recursos.nfe) {
    alertas.push({
      codigo: "inutilizacao_sem_nfe",
      mensagem:
        "Inutilização fiscal está ligada sem NF-e. Confira se essa combinação é intencional.",
    });
  }

  return alertas;
}
