export const MENSAGEM_TEF_HOMOLOGACAO_NFCE_PRODUCAO =
  "O TEF está em homologação e não pode financiar uma NFC-e de produção.";

export const MENSAGEM_TEF_AMBIENTE_INCONCLUSIVO =
  "Não foi possível confirmar o ambiente do TEF. A NFC-e de produção não foi emitida.";

export function bloqueioTefHomologacaoNfceProducao(input: {
  ambienteFiscal: unknown;
  ambienteTef: string | null | undefined;
  possuiTransacaoTef: boolean;
  consultaInconclusiva?: boolean;
}) {
  if (Number(input.ambienteFiscal) !== 1) {
    return null;
  }
  if (input.consultaInconclusiva) {
    return MENSAGEM_TEF_AMBIENTE_INCONCLUSIVO;
  }
  if (!input.possuiTransacaoTef) {
    return null;
  }
  if (String(input.ambienteTef ?? "").trim().toLowerCase() === "producao") {
    return null;
  }
  return MENSAGEM_TEF_HOMOLOGACAO_NFCE_PRODUCAO;
}

export function normalizarConsultaAmbienteTef(input: {
  erro: boolean;
  quantidade: number;
  ambienteTef: string | null;
}) {
  if (input.erro) {
    return {
      quantidade: 0,
      ambienteTef: null as string | null,
      consultaInconclusiva: true,
    };
  }
  return {
    quantidade: input.quantidade,
    ambienteTef: input.ambienteTef,
    consultaInconclusiva: false,
  };
}
