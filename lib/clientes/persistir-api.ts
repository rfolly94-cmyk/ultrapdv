import { createClient } from "@/lib/supabase/server";

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

export type ResultadoPersistenciaCliente =
  | { ok: true; mensagem: string; id?: string }
  | { ok: false; erro: string };

export type DadosClienteApi = {
  nome?: string | null;
  nomeFantasia?: string | null;
  tipoPessoa?: string | null;
  cpfCnpj?: string | null;
  inscricaoEstadual?: string | null;
  indicadorIeDestinatario?: string | null;
  consumidorFinal?: boolean;
  telefone?: string | null;
  email?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  codigoMunicipioIbge?: string | null;
  uf?: string | null;
  limiteCredito?: number | string | null;
  bloqueado?: boolean;
  diaVencimento?: number | string | null;
  observacao?: string | null;
  ativo?: boolean;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "");
}

function parseNumero(valor: unknown) {
  if (valor == null || valor === "") {
    return 0;
  }
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }
  let bruto = String(valor).trim();
  if (bruto.includes(".") && bruto.includes(",")) {
    bruto = bruto.replace(/\./g, "").replace(",", ".");
  } else if (bruto.includes(",")) {
    bruto = bruto.replace(",", ".");
  }
  const numero = Number(bruto);
  return Number.isFinite(numero) ? numero : 0;
}

function parseInteiroOuNull(valor: unknown) {
  if (valor == null || valor === "") {
    return null;
  }
  const numero = typeof valor === "number" ? valor : Number(String(valor).trim());
  if (!Number.isInteger(numero)) {
    return null;
  }
  return numero;
}

function documentoValido(tipoPessoa: string, documento: string) {
  if (!documento) {
    return true;
  }
  if (tipoPessoa === "F") {
    return documento.length === 11;
  }
  if (tipoPessoa === "J") {
    return documento.length === 14;
  }
  return false;
}

export function normalizarDadosClienteApi(dados: DadosClienteApi) {
  const tipoPessoa = texto(dados.tipoPessoa).toUpperCase() || "F";
  const documento = somenteDigitos(dados.cpfCnpj);
  const indicadorInformado = texto(dados.indicadorIeDestinatario);
  const indicadorIeDestinatario =
    indicadorInformado === "1" ||
    indicadorInformado === "2" ||
    indicadorInformado === "9"
      ? indicadorInformado
      : "9";

  return {
    nome: texto(dados.nome),
    nome_fantasia: texto(dados.nomeFantasia) || null,
    tipo_pessoa: tipoPessoa,
    cpf_cnpj: documento || null,
    inscricao_estadual: texto(dados.inscricaoEstadual) || null,
    indicador_ie_destinatario: indicadorIeDestinatario,
    contribuinte_icms: indicadorIeDestinatario === "1",
    consumidor_final: dados.consumidorFinal === true,
    telefone: somenteDigitos(dados.telefone) || null,
    email: texto(dados.email).toLowerCase() || null,
    cep: somenteDigitos(dados.cep) || null,
    logradouro: texto(dados.logradouro) || null,
    numero: texto(dados.numero) || null,
    complemento: texto(dados.complemento) || null,
    bairro: texto(dados.bairro) || null,
    municipio: texto(dados.municipio) || null,
    codigo_municipio_ibge: somenteDigitos(dados.codigoMunicipioIbge) || null,
    uf: texto(dados.uf).toUpperCase() || null,
    limite_credito: parseNumero(dados.limiteCredito),
    bloqueado: dados.bloqueado === true,
    dia_vencimento: parseInteiroOuNull(dados.diaVencimento),
    observacao: texto(dados.observacao) || null,
    ativo: dados.ativo !== false,
  };
}

export function erroValidacaoCliente(
  dados: ReturnType<typeof normalizarDadosClienteApi>
) {
  if (dados.nome.length < 2) {
    return "Informe o nome do cliente.";
  }
  if (dados.tipo_pessoa !== "F" && dados.tipo_pessoa !== "J") {
    return "Tipo de pessoa inválido.";
  }
  if (!documentoValido(dados.tipo_pessoa, dados.cpf_cnpj ?? "")) {
    return dados.tipo_pessoa === "F"
      ? "CPF deve conter 11 dígitos."
      : "CNPJ deve conter 14 dígitos.";
  }
  if (dados.indicador_ie_destinatario === "1" && !dados.inscricao_estadual) {
    return "Contribuinte ICMS precisa de Inscrição Estadual.";
  }
  if (dados.email && !dados.email.includes("@")) {
    return "Informe um e-mail válido.";
  }
  if (dados.uf && !/^[A-Z]{2}$/.test(dados.uf)) {
    return "UF deve conter 2 letras.";
  }
  if (dados.cep && dados.cep.length !== 8) {
    return "CEP deve conter 8 dígitos.";
  }
  if (
    dados.codigo_municipio_ibge &&
    dados.codigo_municipio_ibge.length !== 7
  ) {
    return "Código IBGE do município deve conter 7 dígitos.";
  }
  if (dados.limite_credito < 0) {
    return "Limite de crédito não pode ser negativo.";
  }
  if (
    dados.dia_vencimento !== null &&
    (dados.dia_vencimento < 1 || dados.dia_vencimento > 31)
  ) {
    return "Dia de vencimento deve ficar entre 1 e 31.";
  }
  return null;
}

export async function cadastrarClienteApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  dados: DadosClienteApi;
}): Promise<ResultadoPersistenciaCliente> {
  const dados = normalizarDadosClienteApi(input.dados);
  const erro = erroValidacaoCliente(dados);
  if (erro) {
    return { ok: false, erro };
  }

  const { data, error } = await input.supabase
    .from("clientes")
    .insert({
      empresa_id: input.empresaId,
      ...dados,
      saldo_devedor: 0,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, erro: "Já existe um cliente com esse CPF/CNPJ." };
    }
    return { ok: false, erro: error.message };
  }

  return {
    ok: true,
    mensagem: "Cliente cadastrado com sucesso.",
    id: data?.id ? String(data.id) : undefined,
  };
}

export async function persistirClienteApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  clienteId: string;
  dados: DadosClienteApi;
}): Promise<ResultadoPersistenciaCliente> {
  const dados = normalizarDadosClienteApi(input.dados);
  const erro = erroValidacaoCliente(dados);
  if (erro) {
    return { ok: false, erro };
  }

  const { data: atual, error: erroAtual } = await input.supabase
    .from("clientes")
    .select("id")
    .eq("empresa_id", input.empresaId)
    .eq("id", input.clienteId)
    .maybeSingle();

  if (erroAtual || !atual) {
    return { ok: false, erro: "Cliente não encontrado nesta empresa." };
  }

  const { error } = await input.supabase
    .from("clientes")
    .update(dados)
    .eq("id", input.clienteId)
    .eq("empresa_id", input.empresaId);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, erro: "Já existe outro cliente com esse CPF/CNPJ." };
    }
    return { ok: false, erro: error.message };
  }

  return { ok: true, mensagem: "Cliente alterado com sucesso." };
}

export async function carregarClienteApi(input: {
  supabase: ClienteSupabase;
  empresaId: string;
  clienteId: string;
}) {
  const { data, error } = await input.supabase
    .from("clientes")
    .select(
      `
      id,
      nome,
      nome_fantasia,
      tipo_pessoa,
      cpf_cnpj,
      inscricao_estadual,
      indicador_ie_destinatario,
      contribuinte_icms,
      consumidor_final,
      telefone,
      email,
      cep,
      logradouro,
      numero,
      complemento,
      bairro,
      municipio,
      codigo_municipio_ibge,
      uf,
      limite_credito,
      bloqueado,
      dia_vencimento,
      observacao,
      ativo,
      saldo_devedor
    `
    )
    .eq("empresa_id", input.empresaId)
    .eq("id", input.clienteId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  return {
    id: String(data.id),
    nome: String(data.nome ?? ""),
    nomeFantasia: data.nome_fantasia ? String(data.nome_fantasia) : "",
    tipoPessoa: data.tipo_pessoa === "J" ? "J" : "F",
    cpfCnpj: data.cpf_cnpj ? String(data.cpf_cnpj) : "",
    inscricaoEstadual: data.inscricao_estadual
      ? String(data.inscricao_estadual)
      : "",
    indicadorIeDestinatario:
      data.indicador_ie_destinatario === "1" ||
      data.indicador_ie_destinatario === "2" ||
      data.indicador_ie_destinatario === "9"
        ? String(data.indicador_ie_destinatario)
        : "9",
    consumidorFinal: Boolean(data.consumidor_final),
    telefone: data.telefone ? String(data.telefone) : "",
    email: data.email ? String(data.email) : "",
    cep: data.cep ? String(data.cep) : "",
    logradouro: data.logradouro ? String(data.logradouro) : "",
    numero: data.numero ? String(data.numero) : "",
    complemento: data.complemento ? String(data.complemento) : "",
    bairro: data.bairro ? String(data.bairro) : "",
    municipio: data.municipio ? String(data.municipio) : "",
    codigoMunicipioIbge: data.codigo_municipio_ibge
      ? String(data.codigo_municipio_ibge)
      : "",
    uf: data.uf ? String(data.uf) : "",
    limiteCredito: Number(data.limite_credito ?? 0),
    bloqueado: Boolean(data.bloqueado),
    diaVencimento: data.dia_vencimento == null ? null : Number(data.dia_vencimento),
    observacao: data.observacao ? String(data.observacao) : "",
    ativo: data.ativo !== false,
    saldoDevedor: Number(data.saldo_devedor ?? 0),
  };
}
