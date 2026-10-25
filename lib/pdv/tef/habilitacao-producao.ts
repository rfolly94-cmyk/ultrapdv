const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RegistroPinpadProducao = {
  empresaId: string;
  terminalId: string;
  dispositivoId: string;
  journalInstalacao: string;
  codigoNativo: number;
  aprovado: boolean;
};

export function pinpadAprovadoNaCobranca(input: {
  empresaId: string;
  terminalId: string;
  dispositivoId: string;
  journalInstalacao: string;
  registro: RegistroPinpadProducao | null;
}) {
  const registro = input.registro;
  if (!registro?.aprovado || registro.codigoNativo !== 0) return false;
  if (!input.journalInstalacao || !registro.journalInstalacao) return false;
  return registro.empresaId === input.empresaId
    && registro.terminalId === input.terminalId
    && registro.dispositivoId === input.dispositivoId
    && registro.journalInstalacao === input.journalInstalacao
    && UUID.test(input.empresaId)
    && UUID.test(input.terminalId)
    && UUID.test(input.dispositivoId);
}

export function avaliarAutorizacaoProducao(input: {
  administrador: boolean;
  credenciamentoComprovado: boolean;
  servidorValidado: boolean;
  pontoInstalado: boolean;
  pinpadAprovado: boolean;
  pendenciaFinanceira: boolean;
  empresaSessao: string;
  terminalId: string;
  dispositivoId: string;
}) {
  const pendencias: string[] = [];
  if (!input.administrador) pendencias.push("Somente o administrador da empresa pode autorizar a produção.");
  if (!input.credenciamentoComprovado) pendencias.push("O credenciamento comercial não está comprovado.");
  if (!input.servidorValidado) pendencias.push("O servidor comercial de produção não foi confirmado pela biblioteca.");
  if (!input.pontoInstalado) pendencias.push("O ponto de produção não está instalado.");
  if (!input.pinpadAprovado) pendencias.push("A comunicação do PinPad de produção não está aprovada.");
  if (input.pendenciaFinanceira) pendencias.push("Há pendência financeira impeditiva neste terminal.");
  if (!UUID.test(input.empresaSessao)) pendencias.push("A empresa da sessão não foi resolvida.");
  if (!UUID.test(input.terminalId)) pendencias.push("O terminal local desta empresa não foi resolvido pelo Connector.");
  if (!UUID.test(input.dispositivoId)) pendencias.push("O dispositivo local não foi resolvido pelo Connector.");
  return { pode: pendencias.length === 0, pendencias };
}

export function decidirAmbienteCobranca(input: {
  ambienteEmpresa: "homologacao" | "producao";
  liberada: boolean;
  comando: string;
}): { ok: true; ambiente: 0 | 1; finalidade?: "venda_producao" } | { ok: false; erro: string } {
  if (input.ambienteEmpresa === "producao" && input.comando === "cancelar") {
    return { ok: false, erro: "O cancelamento de produção não foi iniciado." };
  }
  if (input.ambienteEmpresa === "producao" && (input.comando === "vender" || input.comando === "confirmar")) {
    if (!input.liberada) {
      return { ok: false, erro: "A produção TEF não está habilitada. Nenhuma cobrança foi iniciada." };
    }
    return { ok: true, ambiente: 0, finalidade: "venda_producao" };
  }
  return { ok: true, ambiente: 1 };
}
