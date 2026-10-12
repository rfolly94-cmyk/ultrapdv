const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TerminalRecuperacao = {
  id: string;
  empresaId: string;
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  ativo: boolean;
  revogada: boolean;
};

export type PedidoRecuperacaoAutorizacao = {
  administrador: boolean;
  permissaoEditar: boolean;
  perdaConfirmada: boolean;
  assinaturaValida: boolean;
  empresaSessaoId: string;
  dispositivoAssinado: string;
  chavePublicaComprovada: string;
  chaveIdInformada: string;
  fingerprintComprovada: string | null;
  dispositivoOutraEmpresa: boolean;
  pendenciaFinanceira: boolean;
  reconciliacao: boolean;
  chaveJaRevogada: boolean;
  chaveEmOutroTerminal: boolean;
  terminal: TerminalRecuperacao | null;
};

export type EfeitoRecuperacao = "autorizar" | "ja_autorizada" | "recusar";

export type DecisaoRecuperacao = {
  efeito: EfeitoRecuperacao;
  motivo: string;
  terminalId: string;
  codigo: string;
  dispositivoId: string;
  alteraCodigo: false;
  alteraTerminalId: false;
  alteraDispositivo: false;
  executaInstalacao: false;
  gerarChave: false;
};

function recusar(motivo: string): DecisaoRecuperacao {
  return {
    efeito: "recusar",
    motivo,
    terminalId: "",
    codigo: "",
    dispositivoId: "",
    alteraCodigo: false,
    alteraTerminalId: false,
    alteraDispositivo: false,
    executaInstalacao: false,
    gerarChave: false,
  };
}

function autorizada(
  terminal: TerminalRecuperacao,
  efeito: "autorizar" | "ja_autorizada"
): DecisaoRecuperacao {
  return {
    efeito,
    motivo: "",
    terminalId: terminal.id.trim().toLowerCase(),
    codigo: terminal.codigo.trim(),
    dispositivoId: terminal.dispositivoId.trim().toLowerCase(),
    alteraCodigo: false,
    alteraTerminalId: false,
    alteraDispositivo: false,
    executaInstalacao: false,
    gerarChave: false,
  };
}

export function decidirRecuperacaoAutorizacao(
  input: PedidoRecuperacaoAutorizacao
): DecisaoRecuperacao {
  if (!input.administrador || !input.permissaoEditar) {
    return recusar("Somente um administrador com permissão de edição do financeiro pode recuperar a autorização.");
  }
  if (!input.assinaturaValida || !input.fingerprintComprovada) {
    return recusar("O Connector não comprovou a posse da chave atual.");
  }
  if (!UUID.test(input.empresaSessaoId.trim()) || !UUID.test(input.dispositivoAssinado.trim())) {
    return recusar("A identidade assinada do computador é inválida.");
  }
  if (input.chaveIdInformada.trim() && !UUID.test(input.chaveIdInformada.trim())) {
    return recusar("A identificação da chave atual é inválida.");
  }
  if (input.dispositivoOutraEmpresa) {
    return recusar("Este computador está vinculado a outra empresa.");
  }
  const terminal = input.terminal;
  if (
    !terminal ||
    !terminal.ativo ||
    terminal.revogada ||
    terminal.empresaId.trim().toLowerCase() !== input.empresaSessaoId.trim().toLowerCase() ||
    terminal.dispositivoId.trim().toLowerCase() !== input.dispositivoAssinado.trim().toLowerCase()
  ) {
    return recusar("A chave comprovada não pertence ao terminal desta empresa.");
  }
  if (input.pendenciaFinanceira || input.reconciliacao) {
    return recusar("Há transação ou reconciliação pendente. A recuperação fica bloqueada até a resolução financeira.");
  }
  if (input.chaveJaRevogada) {
    return recusar("A chave atual do Connector já foi revogada. A recuperação não gera outra chave.");
  }
  if (input.chaveEmOutroTerminal) {
    return recusar("A chave atual já autoriza outro terminal.");
  }
  const atual = input.chavePublicaComprovada.trim();
  const autorizadaAgora = terminal.chavePublica.trim();
  if (!autorizadaAgora || !atual) {
    return recusar("O terminal não tem uma chave pública autorizada para substituir.");
  }
  if (atual === autorizadaAgora) {
    return autorizada(terminal, "ja_autorizada");
  }
  if (!input.perdaConfirmada) {
    return recusar("Confirme explicitamente que a chave privada anterior foi perdida.");
  }
  return autorizada(terminal, "autorizar");
}

export type EstadoChaveTerminal = {
  chavePublica: string;
  pendente: boolean;
};

export function transicaoRecuperacao(
  estado: EstadoChaveTerminal,
  chaveComprovada: string,
  bloqueio: { chaveRevogada: boolean; chaveEmOutroTerminal: boolean; chaveAnterior: string }
) {
  if (estado.pendente) {
    return { efeito: "recusar" as const, motivo: "pendente", estado };
  }
  if (bloqueio.chaveRevogada) {
    return { efeito: "recusar" as const, motivo: "chave_revogada", estado };
  }
  if (bloqueio.chaveEmOutroTerminal) {
    return { efeito: "recusar" as const, motivo: "chave_outro_terminal", estado };
  }
  if (estado.chavePublica === chaveComprovada) {
    return { efeito: "ja_autorizada" as const, motivo: "", estado };
  }
  if (estado.chavePublica !== bloqueio.chaveAnterior) {
    return { efeito: "recusar" as const, motivo: "substituida", estado };
  }
  return {
    efeito: "autorizada" as const,
    motivo: "",
    estado: { ...estado, chavePublica: chaveComprovada },
  };
}

export function resultadoAposAutorizacao(input: {
  bancoAutorizado: boolean;
  gravacaoLocalOk: boolean;
  statusConfere: boolean;
}) {
  if (!input.bancoAutorizado) {
    return {
      efeito: "nao_autorizada" as const,
      podeRepetirSincronizacao: false,
      gerarChave: false as const,
    };
  }
  if (input.gravacaoLocalOk && input.statusConfere) {
    return {
      efeito: "concluida" as const,
      podeRepetirSincronizacao: false,
      gerarChave: false as const,
    };
  }
  return {
    efeito: "autorizada_sem_vinculo" as const,
    podeRepetirSincronizacao: true,
    gerarChave: false as const,
  };
}
