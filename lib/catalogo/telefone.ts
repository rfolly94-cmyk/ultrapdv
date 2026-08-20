export const ERRO_CELULAR_CATALOGO = "Informe um celular válido com DDD.";

export function somenteDigitosTelefone(valor: string) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function normalizarTelefoneBrasileiro(valor: string) {
  let digitos = somenteDigitosTelefone(valor);

  while (digitos.startsWith("55") && digitos.length > 11) {
    digitos = digitos.slice(2);
  }

  return digitos;
}

export function celularBrasileiroValido(valor: string) {
  const nacional = normalizarTelefoneBrasileiro(valor);

  if (nacional.length !== 11) {
    return false;
  }

  const ddd = nacional.slice(0, 2);

  if (ddd[0] === "0") {
    return false;
  }

  return true;
}

export function formatarTelefoneBrasileiro(valor: string) {
  const nacional = normalizarTelefoneBrasileiro(valor).slice(0, 11);

  if (!nacional) {
    return "";
  }

  if (nacional.length <= 2) {
    return `(${nacional}`;
  }

  const ddd = nacional.slice(0, 2);
  const numero = nacional.slice(2);

  if (numero.length <= 5) {
    return `(${ddd}) ${numero}`;
  }

  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}

export function montarTelefoneWhatsapp(valor: string) {
  const nacional = normalizarTelefoneBrasileiro(valor);

  if (!celularBrasileiroValido(nacional)) {
    return null;
  }

  return `55${nacional}`;
}
