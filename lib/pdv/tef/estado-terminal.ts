export type TerminalTefAtivo = {
  id: string;
  codigo: string;
  dispositivoId: string;
  estabelecimento: string;
  pontoCaptura: string;
  temPendencia: boolean;
};

export type SituacaoTerminalComputador = "vinculado" | "outra_empresa" | "parear";

export function decidirSituacaoTerminalComputador(input: {
  dispositivoId: string;
  empresaSessaoId: string;
  vinculoLocalEmpresaId: string | null;
  terminalDestaEmpresa: TerminalTefAtivo | null;
  dispositivoDeOutraEmpresa: boolean;
}): SituacaoTerminalComputador {
  const vinculoDeOutraEmpresa =
    Boolean(input.vinculoLocalEmpresaId) &&
    input.vinculoLocalEmpresaId !== input.empresaSessaoId;
  if (vinculoDeOutraEmpresa || input.dispositivoDeOutraEmpresa) {
    return "outra_empresa";
  }
  if (
    input.terminalDestaEmpresa &&
    input.terminalDestaEmpresa.dispositivoId === input.dispositivoId
  ) {
    return "vinculado";
  }
  return "parear";
}
