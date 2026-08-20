export type AutorizadoXmlNfe = {
  cnpj: string;
  cpf: string;
};

export type AutorizadoXmlGeranet =
  | { cnpj: string }
  | { cpf: string };

export const LIMITE_AUTORIZADOS_XML_NFE = 10;

export const MENSAGEM_AUTORIZADO_XML_CPF_INVALIDO =
  "CPF do autorizado a acessar o XML inválido.";
export const MENSAGEM_AUTORIZADO_XML_CNPJ_INVALIDO =
  "CNPJ do autorizado a acessar o XML inválido.";
export const MENSAGEM_AUTORIZADO_XML_CPF_E_CNPJ =
  "Informe CPF ou CNPJ em cada autorizado a acessar o XML, não os dois.";
export const MENSAGEM_AUTORIZADO_XML_LIMITE =
  "A NF-e aceita no máximo 10 autorizados a acessar o XML.";
export const MENSAGEM_AUTORIZADO_XML_DUPLICADO =
  "Há CPF ou CNPJ repetido entre os autorizados a acessar o XML.";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function autorizadoXmlVazio(): AutorizadoXmlNfe {
  return { cnpj: "", cpf: "" };
}

export function normalizarAutorizadoXml(valor: unknown): AutorizadoXmlNfe {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return autorizadoXmlVazio();
  }
  const bruto = valor as Record<string, unknown>;
  return {
    cnpj: somenteDigitos(bruto.cnpj),
    cpf: somenteDigitos(bruto.cpf),
  };
}

export function autorizadoXmlPreenchido(item: AutorizadoXmlNfe) {
  return Boolean(item.cpf || item.cnpj);
}

export function normalizarAutorizadosXml(valor: unknown): AutorizadoXmlNfe[] {
  if (!Array.isArray(valor)) {
    return [];
  }
  return valor.map(normalizarAutorizadoXml).filter(autorizadoXmlPreenchido);
}

export function lerAutorizadosXmlDoSnapshot(snapshot: unknown): AutorizadoXmlNfe[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [];
  }
  const bruto = snapshot as Record<string, unknown>;
  return normalizarAutorizadosXml(bruto.autorizadosXml);
}

export function snapshotParaPersistirAutorizadosXml(input: unknown): {
  autorizadosXml: AutorizadoXmlNfe[];
} {
  return { autorizadosXml: normalizarAutorizadosXml(input) };
}

export function validarAutorizadosXml(valor: unknown): string | null {
  const lista = Array.isArray(valor)
    ? valor.map(normalizarAutorizadoXml)
    : lerAutorizadosXmlDoSnapshot(valor);
  const preenchidos = lista.filter(autorizadoXmlPreenchido);
  if (preenchidos.length > LIMITE_AUTORIZADOS_XML_NFE) {
    return MENSAGEM_AUTORIZADO_XML_LIMITE;
  }
  const vistos = new Set<string>();
  for (const item of preenchidos) {
    if (item.cpf && item.cnpj) {
      return MENSAGEM_AUTORIZADO_XML_CPF_E_CNPJ;
    }
    if (item.cpf && item.cpf.length !== 11) {
      return MENSAGEM_AUTORIZADO_XML_CPF_INVALIDO;
    }
    if (item.cnpj && item.cnpj.length !== 14) {
      return MENSAGEM_AUTORIZADO_XML_CNPJ_INVALIDO;
    }
    const chave = item.cnpj || item.cpf;
    if (vistos.has(chave)) {
      return MENSAGEM_AUTORIZADO_XML_DUPLICADO;
    }
    vistos.add(chave);
  }
  return null;
}

export function autorizadosXmlDoSnapshotParaGeranet(
  snapshot: unknown
): AutorizadoXmlGeranet[] | null {
  const erro = validarAutorizadosXml(snapshot);
  if (erro) {
    return null;
  }
  const lista = lerAutorizadosXmlDoSnapshot(snapshot);
  if (lista.length === 0) {
    return null;
  }
  return lista.map((item) =>
    item.cnpj ? { cnpj: item.cnpj } : { cpf: item.cpf }
  );
}
