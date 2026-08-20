export type EnderecoEntregaNfe = {
  nome: string;
  telefone: string;
  cnpj: string;
  cpf: string;
  inscricaoEstadual: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  codigoMunicipio: string;
  municipio: string;
  codigoPais: string;
  nomePais: string;
  uf: string;
  cep: string;
  email: string;
};

export type EnderecoEntregaSnapshot = {
  diferente: boolean;
  entrega: EnderecoEntregaNfe;
};

export const CODIGO_PAIS_BRASIL = "1058";
export const NOME_PAIS_BRASIL = "Brasil";

export const MENSAGEM_ENTREGA_CPF_INVALIDO =
  "CPF do endereço de entrega inválido.";
export const MENSAGEM_ENTREGA_CNPJ_INVALIDO =
  "CNPJ do endereço de entrega inválido.";
export const MENSAGEM_ENTREGA_CPF_E_CNPJ =
  "Informe CPF ou CNPJ no endereço de entrega, não os dois.";
export const MENSAGEM_ENTREGA_INCOMPLETO =
  "Preencha o endereço de entrega ou desmarque a opção.";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function enderecoEntregaVazio(): EnderecoEntregaNfe {
  return {
    nome: "",
    telefone: "",
    cnpj: "",
    cpf: "",
    inscricaoEstadual: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    codigoMunicipio: "",
    municipio: "",
    codigoPais: CODIGO_PAIS_BRASIL,
    nomePais: NOME_PAIS_BRASIL,
    uf: "",
    cep: "",
    email: "",
  };
}

export function normalizarEnderecoEntrega(valor: unknown): EnderecoEntregaNfe {
  const base = enderecoEntregaVazio();
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return base;
  }
  const bruto = valor as Record<string, unknown>;
  const codigoPais = somenteDigitos(bruto.codigoPais) || CODIGO_PAIS_BRASIL;
  const nomePais = texto(bruto.nomePais) || NOME_PAIS_BRASIL;
  return {
    nome: texto(bruto.nome),
    telefone: somenteDigitos(bruto.telefone),
    cnpj: somenteDigitos(bruto.cnpj),
    cpf: somenteDigitos(bruto.cpf),
    inscricaoEstadual: texto(bruto.inscricaoEstadual),
    logradouro: texto(bruto.logradouro),
    numero: texto(bruto.numero),
    complemento: texto(bruto.complemento),
    bairro: texto(bruto.bairro),
    codigoMunicipio: somenteDigitos(
      bruto.codigoMunicipio ?? bruto.codigoMunicipioIbge
    ),
    municipio: texto(bruto.municipio),
    codigoPais,
    nomePais,
    uf: texto(bruto.uf).toUpperCase(),
    cep: somenteDigitos(bruto.cep),
    email: texto(bruto.email),
  };
}

export function lerEnderecoEntregaDoSnapshot(
  snapshot: unknown
): EnderecoEntregaSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { diferente: false, entrega: enderecoEntregaVazio() };
  }
  const bruto = snapshot as Record<string, unknown>;
  return {
    diferente: bruto.entrega_diferente === true,
    entrega: normalizarEnderecoEntrega(bruto.entrega),
  };
}

export function snapshotParaPersistirEnderecoEntrega(input: {
  diferente: boolean;
  entrega?: unknown;
}): { entrega_diferente: boolean; entrega: EnderecoEntregaNfe } {
  return {
    entrega_diferente: Boolean(input.diferente),
    entrega: normalizarEnderecoEntrega(input.entrega),
  };
}

export function validarEnderecoEntrega(input: {
  diferente: boolean;
  entrega?: unknown;
}): string | null {
  if (!input.diferente) {
    return null;
  }
  const entrega = normalizarEnderecoEntrega(input.entrega);
  if (entrega.cpf && entrega.cnpj) {
    return MENSAGEM_ENTREGA_CPF_E_CNPJ;
  }
  if (entrega.cpf && entrega.cpf.length !== 11) {
    return MENSAGEM_ENTREGA_CPF_INVALIDO;
  }
  if (entrega.cnpj && entrega.cnpj.length !== 14) {
    return MENSAGEM_ENTREGA_CNPJ_INVALIDO;
  }
  if (entrega.uf && !/^[A-Z]{2}$/.test(entrega.uf)) {
    return "UF do endereço de entrega inválida.";
  }
  if (entrega.cep && entrega.cep.length !== 8) {
    return "CEP do endereço de entrega inválido.";
  }
  if (entrega.codigoMunicipio && entrega.codigoMunicipio.length !== 7) {
    return "Código IBGE do município de entrega deve ter 7 dígitos.";
  }
  if (
    !entrega.logradouro ||
    !entrega.municipio ||
    !entrega.uf ||
    !entrega.cep ||
    !entrega.codigoMunicipio
  ) {
    return MENSAGEM_ENTREGA_INCOMPLETO;
  }
  return null;
}

export function enderecoEntregaDoSnapshotParaGeranet(
  snapshot: unknown
): EnderecoEntregaNfe | null {
  const lido = lerEnderecoEntregaDoSnapshot(snapshot);
  if (!lido.diferente) {
    return null;
  }
  return lido.entrega;
}
