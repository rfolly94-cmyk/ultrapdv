const MAX_NOME = 25;
const MAX_CIDADE = 15;

export function removerAcentos(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizarTextoEmv(valor: string, maximo: number) {
  return removerAcentos(valor)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximo);
}

export function normalizarNomeRecebedor(nome: string) {
  return normalizarTextoEmv(nome, MAX_NOME);
}

export function normalizarCidadeRecebedor(cidade: string) {
  return normalizarTextoEmv(cidade, MAX_CIDADE);
}

export function normalizarValorPix(valor: number) {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error("Informe um valor PIX maior que zero.");
  }

  return valor.toFixed(2);
}

export function normalizarChavePix(chave: string) {
  const limpa = chave.trim();
  if (!limpa) {
    throw new Error("Informe a Chave PIX.");
  }
  return limpa;
}

export type TipoChavePix =
  | "cpf"
  | "cnpj"
  | "email"
  | "telefone"
  | "evp"
  | "outra";

export function inferirTipoChavePix(chave: string): TipoChavePix {
  const valor = chave.trim();
  const soDigitos = valor.replace(/\D/g, "");

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
    return "email";
  }
  if (valor.startsWith("+") && soDigitos.length >= 12) {
    return "telefone";
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)) {
    return "evp";
  }
  if (/^\d{11}$/.test(soDigitos) && valor.replace(/\D/g, "").length === 11) {
    return "cpf";
  }
  if (/^\d{14}$/.test(soDigitos) && valor.replace(/\D/g, "").length === 14) {
    return "cnpj";
  }
  return "outra";
}
