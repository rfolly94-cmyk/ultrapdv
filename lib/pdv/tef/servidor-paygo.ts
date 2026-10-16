export type AmbienteServidorPayGo = "homologacao" | "producao";

export type EfeitoServidorPayGo = "gravar" | "preservar" | "recusar";

export type ConfiguracaoServidorPayGo = {
  servidorHomologacao: string;
  servidorProducao: string;
};

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

export function validarServidorPayGo(valor: unknown):
  | { ok: true; servidor: string }
  | { ok: false; motivo: string } {
  const texto = String(valor ?? "").trim();
  if (!texto) {
    return { ok: false, motivo: "Informe o servidor PayGoWeb no formato host:porta." };
  }
  if (texto.length > 200 || /\s|\/\//.test(texto)) {
    return { ok: false, motivo: "O servidor PayGoWeb precisa estar no formato host:porta." };
  }
  const separador = texto.lastIndexOf(":");
  if (separador < 1 || separador !== texto.indexOf(":") || separador === texto.length - 1) {
    return { ok: false, motivo: "O servidor PayGoWeb precisa estar no formato host:porta." };
  }
  const host = texto.slice(0, separador);
  const porta = Number(texto.slice(separador + 1));
  if (
    !HOST.test(host) ||
    host.includes("..") ||
    !/^[0-9]{1,5}$/.test(texto.slice(separador + 1)) ||
    !Number.isInteger(porta) ||
    porta < 1 ||
    porta > 65535
  ) {
    return { ok: false, motivo: "A porta do servidor PayGoWeb é inválida." };
  }
  return { ok: true, servidor: texto };
}

export function servidorDoAmbiente(
  config: ConfiguracaoServidorPayGo,
  ambiente: AmbienteServidorPayGo | ""
) {
  const bruto =
    ambiente === "homologacao"
      ? config.servidorHomologacao
      : ambiente === "producao"
        ? config.servidorProducao
        : "";
  const validado = validarServidorPayGo(bruto);
  return validado.ok ? validado.servidor : "";
}

export function conferirServidorAutorizado(input: {
  servidorInformado: string;
  servidorAutorizado: string;
  ambienteInformado: AmbienteServidorPayGo | "";
  ambienteAutorizado: AmbienteServidorPayGo | "";
}) {
  const informado = validarServidorPayGo(input.servidorInformado);
  const autorizado = validarServidorPayGo(input.servidorAutorizado);
  if (!input.ambienteAutorizado || !autorizado.ok) {
    return { ok: false as const, motivo: "A empresa não possui servidor PayGoWeb autorizado para este ambiente." };
  }
  if (input.ambienteInformado !== input.ambienteAutorizado) {
    return { ok: false as const, motivo: "O ambiente informado diverge do ambiente autorizado." };
  }
  if (!informado.ok || informado.servidor !== autorizado.servidor) {
    return { ok: false as const, motivo: "O servidor informado não é o servidor autorizado desta empresa." };
  }
  return { ok: true as const, servidor: autorizado.servidor };
}

export function confirmarServidorPersistido(input: {
  ambiente: AmbienteServidorPayGo;
  informado: string;
  gravadoHomologacao: string;
  gravadoProducao: string;
}): { ok: true; servidor: string } | { ok: false; motivo: string } {
  const esperado = validarServidorPayGo(input.informado);
  if (!esperado.ok) {
    return { ok: false, motivo: esperado.motivo };
  }
  const gravado =
    input.ambiente === "producao" ? input.gravadoProducao : input.gravadoHomologacao;
  if (String(gravado ?? "").trim() !== esperado.servidor) {
    return {
      ok: false,
      motivo: "O servidor não foi gravado. A etapa não foi concluída.",
    };
  }
  return { ok: true, servidor: esperado.servidor };
}

export function decidirGravacaoServidor(input: {
  perfil: string;
  confirmacaoExplicita: boolean;
  empresaJaHabilitada: boolean;
  pendenciaFinanceira: boolean;
  terminalPareado: boolean;
  servidorAtual: string;
  servidorNovo: string;
  ambienteAtual: AmbienteServidorPayGo | "";
  ambienteNovo: AmbienteServidorPayGo | "";
}): { efeito: EfeitoServidorPayGo; motivo: string } {
  if (String(input.perfil ?? "").trim().toLowerCase() !== "administrador") {
    return {
      efeito: "recusar",
      motivo: "Somente um administrador pode confirmar o servidor PayGoWeb.",
    };
  }
  if (input.confirmacaoExplicita !== true) {
    return {
      efeito: "recusar",
      motivo: "Confirme o servidor PayGoWeb atribuído a este estabelecimento.",
    };
  }
  if (input.empresaJaHabilitada) {
    const oficial = validarServidorPayGo(input.servidorNovo);
    if (!oficial.ok) {
      return { efeito: "recusar", motivo: oficial.motivo };
    }
    const gravado = String(input.servidorAtual ?? "").trim();
    if (input.pendenciaFinanceira && gravado && gravado !== oficial.servidor) {
      return {
        efeito: "recusar",
        motivo: "Há transação TEF pendente. O servidor não pode ser alterado.",
      };
    }
    if (
      input.terminalPareado &&
      input.ambienteAtual &&
      input.ambienteAtual !== input.ambienteNovo
    ) {
      return {
        efeito: "recusar",
        motivo: "O ambiente do terminal pareado diverge do ambiente informado.",
      };
    }
    if (!gravado) {
      return { efeito: "gravar", motivo: "" };
    }
    if (gravado === oficial.servidor) {
      return { efeito: "preservar", motivo: "" };
    }
    return {
      efeito: "recusar",
      motivo:
        "O servidor oficial já gravado é outro. Esta confirmação não troca o servidor de uma empresa com TEF habilitado.",
    };
  }
  if (input.pendenciaFinanceira) {
    return {
      efeito: "recusar",
      motivo: "Há transação TEF pendente. O servidor não pode ser alterado.",
    };
  }
  const novo = validarServidorPayGo(input.servidorNovo);
  if (!input.ambienteNovo || !novo.ok) {
    return { efeito: "recusar", motivo: novo.ok ? "Informe o ambiente autorizado." : novo.motivo };
  }
  if (
    input.terminalPareado &&
    input.ambienteAtual &&
    input.ambienteAtual !== input.ambienteNovo
  ) {
    return {
      efeito: "recusar",
      motivo: "O ambiente do terminal pareado diverge do ambiente informado.",
    };
  }
  const atual = String(input.servidorAtual ?? "").trim();
  if (input.terminalPareado && atual && atual !== novo.servidor) {
    return {
      efeito: "recusar",
      motivo: "O servidor deste terminal já foi pareado e não pode ser trocado.",
    };
  }
  return { efeito: "gravar", motivo: "" };
}
