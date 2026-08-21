import {
  CATALOGO_RECURSOS,
  CHAVES_LIMITE,
  chaveLimiteValida,
  type ChaveLimite,
} from "@/lib/plataforma/recursos/catalogo";

export type RecursoDoPlano = {
  chave: string;
  habilitado: boolean;
  ativo?: boolean;
};

export type LimiteDoPlano = {
  chave: string;
  valor: number | null;
};

export type AssinaturaParaEntitlement = {
  empresa_id: string;
  plano_id?: string | null;
  status?: string | null;
};

const MODO_INFORMATIVO = true;

export function empresaPossuiRecurso(input: {
  empresaId: string;
  chave: string;
  assinatura: AssinaturaParaEntitlement | null;
  recursosDoPlano?: RecursoDoPlano[] | null;
}) {
  if (String(input.empresaId ?? "").trim() === "") {
    return false;
  }

  if (
    input.assinatura &&
    String(input.assinatura.empresa_id) !== String(input.empresaId)
  ) {
    return false;
  }

  const recurso = CATALOGO_RECURSOS.find((item) => item.chave === input.chave);
  if (!recurso) {
    return MODO_INFORMATIVO;
  }

  const lista = input.recursosDoPlano ?? [];
  if (lista.length === 0) {
    return MODO_INFORMATIVO;
  }

  const encontrado = lista.find((item) => item.chave === input.chave);
  if (!encontrado) {
    return MODO_INFORMATIVO;
  }

  if (encontrado.ativo === false) {
    return MODO_INFORMATIVO;
  }

  return encontrado.habilitado;
}

export function obterLimite(input: {
  empresaId: string;
  chave: ChaveLimite | string;
  assinatura: AssinaturaParaEntitlement | null;
  limitesDoPlano?: LimiteDoPlano[] | null;
}): number | null {
  if (String(input.empresaId ?? "").trim() === "") {
    return null;
  }

  if (
    input.assinatura &&
    String(input.assinatura.empresa_id) !== String(input.empresaId)
  ) {
    return null;
  }

  if (!chaveLimiteValida(input.chave)) {
    return null;
  }

  const lista = input.limitesDoPlano ?? [];
  const encontrado = lista.find((item) => item.chave === input.chave);
  if (!encontrado) {
    return null;
  }

  if (encontrado.valor == null) {
    return null;
  }

  const numero = Number(encontrado.valor);
  if (!Number.isInteger(numero) || numero < 0) {
    return null;
  }

  return numero;
}

export function limiteEhIlimitado(valor: number | null | undefined) {
  return valor == null;
}

export function rotuloLimite(valor: number | null | undefined) {
  if (limiteEhIlimitado(valor)) {
    return "Ilimitado";
  }
  return String(valor);
}

export function recursosHabilitados(recursos: RecursoDoPlano[] | null | undefined) {
  return (recursos ?? []).filter((item) => item.habilitado && item.ativo !== false)
    .length;
}

export function chavesLimiteConhecidas() {
  return [...CHAVES_LIMITE];
}
