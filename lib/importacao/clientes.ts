import {
  normalizarDocumento,
  normalizarEmail,
  normalizarTelefone,
  parseBooleano,
  parseMonetario,
  parseTipoPessoa,
  textoCelula,
} from "@/lib/importacao/normalizadores";
import { resumirLinhas } from "@/lib/importacao/produtos";
import type {
  CampoCliente,
  ConfiguracaoImportacao,
  LinhaPlanilha,
  LinhaRevisaoImportacao,
  ResultadoPreviaImportacao,
} from "@/lib/importacao/tipos";

export type ClienteExistenteImportacao = {
  id: string;
  empresa_id: string;
  nome: string;
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
};

function valorMapeado(
  linha: LinhaPlanilha,
  mapeamento: Record<string, string | null>,
  campo: string
) {
  const coluna = mapeamento[campo];
  if (!coluna) {
    return "";
  }
  return textoCelula(linha.valores[coluna]);
}

function marcado(campos: CampoCliente[], campo: CampoCliente) {
  return campos.includes(campo);
}

function duplicadosPlanilha(
  linhas: LinhaPlanilha[],
  mapeamento: Record<string, string | null>,
  campo: "cpf_cnpj" | "email" | "telefone"
) {
  const vistos = new Map<string, number>();
  const duplicadas = new Map<number, string>();
  const rotulo =
    campo === "cpf_cnpj"
      ? "CPF/CNPJ duplicado dentro da planilha"
      : campo === "email"
        ? "E-mail duplicado dentro da planilha"
        : "Telefone duplicado dentro da planilha";

  for (const linha of linhas) {
    const bruto = valorMapeado(linha, mapeamento, campo);
    const valor =
      campo === "email"
        ? normalizarEmail(bruto)
        : campo === "telefone"
          ? normalizarTelefone(bruto)
          : normalizarDocumento(bruto);
    if (!valor) {
      continue;
    }
    if (vistos.has(valor)) {
      duplicadas.set(linha.numero, rotulo);
    } else {
      vistos.set(valor, linha.numero);
    }
  }

  return duplicadas;
}

export function classificarLinhasClientes(params: {
  empresaId: string;
  linhas: LinhaPlanilha[];
  config: ConfiguracaoImportacao;
  clientes: ClienteExistenteImportacao[];
}): ResultadoPreviaImportacao {
  const { empresaId, linhas, config, clientes } = params;
  const campos = config.camposCliente;
  const map = config.mapeamento;
  const regras = config.regrasClientes;

  const porDoc = new Map<string, ClienteExistenteImportacao>();
  const porEmail = new Map<string, ClienteExistenteImportacao>();
  const porTel = new Map<string, ClienteExistenteImportacao>();
  for (const cliente of clientes) {
    if (cliente.empresa_id !== empresaId) {
      continue;
    }
    const doc = normalizarDocumento(cliente.cpf_cnpj);
    if (doc) porDoc.set(doc, cliente);
    const email = normalizarEmail(cliente.email);
    if (email) porEmail.set(email, cliente);
    const tel = normalizarTelefone(cliente.telefone);
    if (tel) porTel.set(tel, cliente);
  }

  const dups = duplicadosPlanilha(linhas, map, regras.identificador);
  const revisao: LinhaRevisaoImportacao[] = [];

  for (const linha of linhas) {
    const nome = marcado(campos, "nome") ? textoCelula(valorMapeado(linha, map, "nome")) : "";
    const nomeFantasia = marcado(campos, "nome_fantasia")
      ? textoCelula(valorMapeado(linha, map, "nome_fantasia"))
      : "";
    const tipoPessoa = marcado(campos, "tipo_pessoa")
      ? parseTipoPessoa(valorMapeado(linha, map, "tipo_pessoa"))
      : "";
    const documento = marcado(campos, "cpf_cnpj")
      ? normalizarDocumento(valorMapeado(linha, map, "cpf_cnpj"))
      : "";
    const ie = marcado(campos, "inscricao_estadual")
      ? textoCelula(valorMapeado(linha, map, "inscricao_estadual"))
      : "";
    const email = marcado(campos, "email")
      ? normalizarEmail(valorMapeado(linha, map, "email"))
      : "";
    const telefone = marcado(campos, "telefone")
      ? normalizarTelefone(valorMapeado(linha, map, "telefone"))
      : "";
    const uf = marcado(campos, "uf")
      ? textoCelula(valorMapeado(linha, map, "uf")).toUpperCase()
      : "";
    const cep = marcado(campos, "cep")
      ? normalizarDocumento(valorMapeado(linha, map, "cep"))
      : "";
    const ibge = marcado(campos, "codigo_municipio_ibge")
      ? normalizarDocumento(valorMapeado(linha, map, "codigo_municipio_ibge"))
      : "";
    const limite = marcado(campos, "limite_credito")
      ? parseMonetario(valorMapeado(linha, map, "limite_credito"))
      : null;

    const vazia = campos.every((campo) => !valorMapeado(linha, map, campo));
    if (vazia) {
      revisao.push({
        numero: linha.numero,
        situacao: "ignorado",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "Linha sem dados suficientes nos campos selecionados",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (dups.get(linha.numero)) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: dups.get(linha.numero) ?? "Duplicado na planilha",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (marcado(campos, "nome") && nome && nome.length < 2) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "Informe o nome do cliente.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    const tipoEfetivo = tipoPessoa || (documento.length === 14 ? "J" : documento.length === 11 ? "F" : "");
    if (marcado(campos, "cpf_cnpj") && documento) {
      if (tipoEfetivo === "F" && documento.length !== 11) {
        revisao.push({
          numero: linha.numero,
          situacao: "erro",
          codigo: documento,
          descricao: nome,
          venda: "",
          observacao: "CPF deve conter 11 dígitos.",
          payload: {},
          quantidadeEstoque: null,
          ignorarEstoque: true,
          existenteId: null,
        });
        continue;
      }
      if (tipoEfetivo === "J" && documento.length !== 14) {
        revisao.push({
          numero: linha.numero,
          situacao: "erro",
          codigo: documento,
          descricao: nome,
          venda: "",
          observacao: "CNPJ deve conter 14 dígitos.",
          payload: {},
          quantidadeEstoque: null,
          ignorarEstoque: true,
          existenteId: null,
        });
        continue;
      }
      if (!tipoEfetivo && documento.length !== 11 && documento.length !== 14) {
        revisao.push({
          numero: linha.numero,
          situacao: "erro",
          codigo: documento,
          descricao: nome,
          venda: "",
          observacao: "CPF/CNPJ inválido",
          payload: {},
          quantidadeEstoque: null,
          ignorarEstoque: true,
          existenteId: null,
        });
        continue;
      }
    }

    if (marcado(campos, "email") && email && !email.includes("@")) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "Informe um e-mail válido.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (marcado(campos, "uf") && uf && !/^[A-Z]{2}$/.test(uf)) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "UF deve conter 2 letras.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (marcado(campos, "cep") && cep && cep.length !== 8) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "CEP deve conter 8 dígitos.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (marcado(campos, "codigo_municipio_ibge") && ibge && ibge.length !== 7) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "Código IBGE do município deve conter 7 dígitos.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (marcado(campos, "limite_credito") && valorMapeado(linha, map, "limite_credito") && limite === null) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "Limite de crédito inválido",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    if (limite != null && limite < 0) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "Limite de crédito não pode ser negativo.",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    let existente: ClienteExistenteImportacao | null = null;
    if (regras.identificador === "cpf_cnpj" && documento) {
      existente = porDoc.get(documento) ?? null;
    } else if (regras.identificador === "email" && email) {
      existente = porEmail.get(email) ?? null;
    } else if (regras.identificador === "telefone" && telefone) {
      existente = porTel.get(telefone) ?? null;
    }

    if (existente && existente.empresa_id !== empresaId) {
      existente = null;
    }

    if (existente && regras.existente === "ignorar") {
      revisao.push({
        numero: linha.numero,
        situacao: "ignorado",
        codigo: documento,
        descricao: nome || existente.nome,
        venda: "",
        observacao: "Cliente já cadastrado — ignorado",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: existente.id,
      });
      continue;
    }

    if (existente && regras.existente === "erro") {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome || existente.nome,
        venda: "",
        observacao: "Cliente já cadastrado",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: existente.id,
      });
      continue;
    }

    if (!existente && !(marcado(campos, "nome") && nome.length >= 2)) {
      revisao.push({
        numero: linha.numero,
        situacao: "erro",
        codigo: documento,
        descricao: nome,
        venda: "",
        observacao: "Cliente novo precisa de nome",
        payload: {},
        quantidadeEstoque: null,
        ignorarEstoque: true,
        existenteId: null,
      });
      continue;
    }

    const payload: Record<string, string | number | boolean | null> = {};
    if (marcado(campos, "nome") && nome) payload.nome = nome;
    if (marcado(campos, "nome_fantasia") && nomeFantasia) {
      payload.nome_fantasia = nomeFantasia;
    }
    if (marcado(campos, "tipo_pessoa") && tipoEfetivo) {
      payload.tipo_pessoa = tipoEfetivo;
    }
    if (marcado(campos, "cpf_cnpj") && documento) payload.cpf_cnpj = documento;
    if (marcado(campos, "inscricao_estadual") && ie) payload.inscricao_estadual = ie;
    if (marcado(campos, "email") && email) payload.email = email;
    if (marcado(campos, "telefone") && telefone) payload.telefone = telefone;
    if (marcado(campos, "uf") && uf) payload.uf = uf;
    if (marcado(campos, "cep") && cep) payload.cep = cep;
    if (marcado(campos, "codigo_municipio_ibge") && ibge) {
      payload.codigo_municipio_ibge = ibge;
    }
    if (marcado(campos, "limite_credito") && limite != null) {
      payload.limite_credito = limite;
    }

    for (const campo of [
      "logradouro",
      "numero",
      "complemento",
      "bairro",
      "municipio",
      "observacao",
    ] as const) {
      if (marcado(campos, campo)) {
        const valor = textoCelula(valorMapeado(linha, map, campo));
        if (valor) payload[campo] = valor;
      }
    }

    if (marcado(campos, "indicador_ie_destinatario")) {
      const ind = textoCelula(valorMapeado(linha, map, "indicador_ie_destinatario"));
      payload.indicador_ie_destinatario =
        ind === "1" || ind === "2" || ind === "9" ? ind : "9";
      payload.contribuinte_icms = payload.indicador_ie_destinatario === "1";
    }
    if (marcado(campos, "consumidor_final")) {
      payload.consumidor_final =
        parseBooleano(valorMapeado(linha, map, "consumidor_final")) ?? true;
    }
    if (marcado(campos, "bloqueado")) {
      payload.bloqueado =
        parseBooleano(valorMapeado(linha, map, "bloqueado")) ?? false;
    }
    if (marcado(campos, "ativo")) {
      payload.ativo = parseBooleano(valorMapeado(linha, map, "ativo")) ?? true;
    }
    if (marcado(campos, "dia_vencimento")) {
      const dia = Number(textoCelula(valorMapeado(linha, map, "dia_vencimento")));
      payload.dia_vencimento =
        Number.isInteger(dia) && dia >= 1 && dia <= 31 ? dia : null;
    }

    revisao.push({
      numero: linha.numero,
      situacao: existente ? "atualizar" : "criar",
      codigo: documento,
      descricao: nome || existente?.nome || "",
      venda: "",
      observacao: existente ? "Será atualizado" : "Será criado",
      payload,
      quantidadeEstoque: null,
      ignorarEstoque: true,
      existenteId: existente?.id ?? null,
    });
  }

  return { resumo: resumirLinhas(revisao), linhas: revisao };
}
