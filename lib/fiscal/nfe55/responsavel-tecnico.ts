export type ResponsavelTecnicoNfeGeranet = {
  cnpj: string;
  contato: string;
  email: string;
  fone: string;
  idCSRT?: string;
  CSRT?: string;
};

export const MENSAGEM_RESPONSAVEL_TECNICO_CNPJ_INVALIDO =
  "CNPJ do responsável técnico deve ter 14 dígitos.";
export const MENSAGEM_RESPONSAVEL_TECNICO_EMAIL_INVALIDO =
  "E-mail do responsável técnico inválido.";
export const MENSAGEM_RESPONSAVEL_TECNICO_FONE_INVALIDO =
  "Telefone do responsável técnico inválido.";
export const MENSAGEM_RESPONSAVEL_TECNICO_ID_CSRT_INVALIDO =
  "idCSRT do responsável técnico deve ter 2 dígitos.";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function lerResponsavelTecnicoPublico(fiscal: unknown): {
  cnpj: string;
  contato: string;
  email: string;
  fone: string;
  idCSRT: string;
  csrtConfigurado: boolean;
} {
  if (!fiscal || typeof fiscal !== "object" || Array.isArray(fiscal)) {
    return {
      cnpj: "",
      contato: "",
      email: "",
      fone: "",
      idCSRT: "",
      csrtConfigurado: false,
    };
  }
  const bruto = fiscal as Record<string, unknown>;
  return {
    cnpj: somenteDigitos(bruto.responsavel_tecnico_cnpj),
    contato: texto(bruto.responsavel_tecnico_contato),
    email: texto(bruto.responsavel_tecnico_email),
    fone: somenteDigitos(bruto.responsavel_tecnico_fone),
    idCSRT: somenteDigitos(bruto.responsavel_tecnico_id_csrt),
    csrtConfigurado: bruto.responsavel_tecnico_csrt_configurado === true,
  };
}

export function validarResponsavelTecnicoCadastro(input: {
  cnpj?: unknown;
  contato?: unknown;
  email?: unknown;
  fone?: unknown;
  idCSRT?: unknown;
}): string | null {
  const cnpj = somenteDigitos(input.cnpj);
  const contato = texto(input.contato);
  const email = texto(input.email);
  const fone = somenteDigitos(input.fone);
  const idCSRT = somenteDigitos(input.idCSRT);

  if (!cnpj && !contato && !email && !fone && !idCSRT) {
    return null;
  }
  if (cnpj && cnpj.length !== 14) {
    return MENSAGEM_RESPONSAVEL_TECNICO_CNPJ_INVALIDO;
  }
  if (email && !email.includes("@")) {
    return MENSAGEM_RESPONSAVEL_TECNICO_EMAIL_INVALIDO;
  }
  if (fone && (fone.length < 6 || fone.length > 14)) {
    return MENSAGEM_RESPONSAVEL_TECNICO_FONE_INVALIDO;
  }
  if (idCSRT && idCSRT.length !== 2) {
    return MENSAGEM_RESPONSAVEL_TECNICO_ID_CSRT_INVALIDO;
  }
  return null;
}

export function mapearResponsavelTecnicoGeranet(input: {
  cnpj?: unknown;
  contato?: unknown;
  email?: unknown;
  fone?: unknown;
  idCSRT?: unknown;
  CSRT?: unknown;
}): ResponsavelTecnicoNfeGeranet | null {
  const cnpj = somenteDigitos(input.cnpj);
  const contato = texto(input.contato);
  const email = texto(input.email);
  const fone = somenteDigitos(input.fone);
  const idCSRT = somenteDigitos(input.idCSRT);
  const CSRT = texto(input.CSRT);

  if (
    cnpj.length !== 14 ||
    contato.length < 2 ||
    !email.includes("@") ||
    fone.length < 6 ||
    fone.length > 14
  ) {
    return null;
  }

  const geranet: ResponsavelTecnicoNfeGeranet = {
    cnpj,
    contato,
    email,
    fone,
  };

  if (idCSRT.length === 2 && CSRT) {
    geranet.idCSRT = idCSRT;
    geranet.CSRT = CSRT;
  }

  return geranet;
}

export function responsavelTecnicoDoCadastroFiscal(input: {
  fiscal: unknown;
  csrt?: string | null;
}): ResponsavelTecnicoNfeGeranet | null {
  const publico = lerResponsavelTecnicoPublico(input.fiscal);
  return mapearResponsavelTecnicoGeranet({
    cnpj: publico.cnpj,
    contato: publico.contato,
    email: publico.email,
    fone: publico.fone,
    idCSRT: publico.idCSRT,
    CSRT: input.csrt,
  });
}
