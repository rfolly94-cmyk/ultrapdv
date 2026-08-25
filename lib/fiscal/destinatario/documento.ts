export type TipoDocumentoDestinatario = "cpf" | "cnpj";

export type OrigemDocumentoDestinatario = "cpf_na_nota" | "cliente";

export type DocumentoDestinatarioFiscal = {
  tipo: TipoDocumentoDestinatario;
  numero: string;
  origem: OrigemDocumentoDestinatario;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function somenteDigitosDocumento(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function todosDigitosIguais(digitos: string) {
  return /^([0-9])\1+$/.test(digitos);
}

function dvModulo11(base: string, pesos: number[]) {
  let soma = 0;
  for (let i = 0; i < base.length; i += 1) {
    soma += Number(base[i]) * pesos[i];
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(valor: unknown) {
  const digitos = somenteDigitosDocumento(valor);
  if (digitos.length !== 11 || todosDigitosIguais(digitos)) {
    return false;
  }

  const pesos1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = dvModulo11(digitos.slice(0, 9), pesos1);
  const dv2 = dvModulo11(digitos.slice(0, 10), pesos2);
  return dv1 === Number(digitos[9]) && dv2 === Number(digitos[10]);
}

export function cnpjValido(valor: unknown) {
  const digitos = somenteDigitosDocumento(valor);
  if (digitos.length !== 14 || todosDigitosIguais(digitos)) {
    return false;
  }

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = dvModulo11(digitos.slice(0, 12), pesos1);
  const dv2 = dvModulo11(digitos.slice(0, 13), pesos2);
  return dv1 === Number(digitos[12]) && dv2 === Number(digitos[13]);
}

export function mascararCpfDigitando(valor: string) {
  const digitos = somenteDigitosDocumento(valor).slice(0, 11);
  if (digitos.length <= 3) {
    return digitos;
  }
  if (digitos.length <= 6) {
    return `${digitos.slice(0, 3)}.${digitos.slice(3)}`;
  }
  if (digitos.length <= 9) {
    return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6)}`;
  }
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

export function formatarDocumentoDestinatario(valor: unknown) {
  const digitos = somenteDigitosDocumento(valor);
  if (digitos.length === 11) {
    return mascararCpfDigitando(digitos);
  }
  if (digitos.length === 14) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
  }
  return digitos;
}

export function documentoFiscalValido(
  valor: unknown
): { tipo: TipoDocumentoDestinatario; numero: string } | null {
  const digitos = somenteDigitosDocumento(valor);
  if (cpfValido(digitos)) {
    return { tipo: "cpf", numero: digitos };
  }
  if (cnpjValido(digitos)) {
    return { tipo: "cnpj", numero: digitos };
  }
  return null;
}

export const MENSAGEM_CPF_INVALIDO = "CPF inválido.";
export const MENSAGEM_CNPJ_CLIENTE_INVALIDO = "CNPJ do cliente inválido.";
export const MENSAGEM_CPF_CLIENTE_INVALIDO = "CPF do cliente inválido.";
export const MENSAGEM_CLIENTE_SEM_DOCUMENTO =
  "O cliente selecionado não possui CPF/CNPJ.";
export const MENSAGEM_CLIENTE_DOCUMENTO_EXIGE_CLIENTE =
  "Selecione um cliente para usar o CPF/CNPJ na nota.";

/**
 * Cliente comercial ≠ destinatário fiscal ≠ CPF só para a nota.
 * Esta função só classifica o documento a congelar no snapshot.
 */
export function resolverDocumentoDestinatarioPdv(input: {
  cpfNaNota?: string | null;
  usarDocumentoClienteNaNota?: boolean;
  documentoCliente?: string | null;
}):
  | { ok: true; documento: DocumentoDestinatarioFiscal | null }
  | { ok: false; erro: string } {
  if (input.usarDocumentoClienteNaNota) {
    const parsed = documentoFiscalValido(input.documentoCliente);
    if (parsed) {
      return {
        ok: true,
        documento: {
          tipo: parsed.tipo,
          numero: parsed.numero,
          origem: "cliente",
        },
      };
    }

    const digitos = somenteDigitosDocumento(input.documentoCliente);
    if (!digitos) {
      return { ok: false, erro: MENSAGEM_CLIENTE_SEM_DOCUMENTO };
    }
    if (digitos.length === 11) {
      return { ok: false, erro: MENSAGEM_CPF_CLIENTE_INVALIDO };
    }
    if (digitos.length === 14) {
      return { ok: false, erro: MENSAGEM_CNPJ_CLIENTE_INVALIDO };
    }
    return { ok: false, erro: "CPF/CNPJ do cliente inválido." };
  }

  const digitado = somenteDigitosDocumento(input.cpfNaNota);
  if (!digitado) {
    return { ok: true, documento: null };
  }
  if (!cpfValido(digitado)) {
    return { ok: false, erro: MENSAGEM_CPF_INVALIDO };
  }
  return {
    ok: true,
    documento: {
      tipo: "cpf",
      numero: digitado,
      origem: "cpf_na_nota",
    },
  };
}
