import {
  cnpjValido,
  somenteDigitosDocumento,
} from "@/lib/fiscal/destinatario/documento";

export const URL_CONSULTA_CNPJ_WS = "https://publica.cnpj.ws/cnpj";
export const TIMEOUT_CONSULTA_CNPJ_MS = 8_000;
export const CACHE_CONSULTA_CNPJ_MS = 10 * 60 * 1000;
export const LIMITE_CONSULTAS_CNPJ_POR_MINUTO = 20;

export const MENSAGEM_CNPJ_INVALIDO = "CNPJ inválido.";
export const MENSAGEM_CNPJ_NAO_ENCONTRADO = "CNPJ não encontrado.";
export const MENSAGEM_CNPJ_LIMITE =
  "Limite de consultas atingido. Tente novamente em instantes.";
export const MENSAGEM_CNPJ_TIMEOUT =
  "A consulta do CNPJ demorou demais. Tente novamente.";
export const MENSAGEM_CNPJ_INDISPONIVEL =
  "Não foi possível consultar o CNPJ. Preencha os dados manualmente.";
export const MENSAGEM_CNPJ_INCOMPLETO =
  "Consulta concluída com dados incompletos. Complete os campos manualmente.";
export const MENSAGEM_CONSULTANDO_CNPJ = "Consultando CNPJ...";

export type MotivoConsultaCnpj =
  | "invalido"
  | "nao_encontrado"
  | "limite"
  | "timeout"
  | "indisponivel";

export type DadosCnpjNormalizados = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  inscricaoEstadual: string;
  situacaoCadastral: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  codigoIbge: string;
  uf: string;
  telefone: string;
  email: string;
  cnaePrincipal: string;
  descricaoCnaePrincipal: string;
  simplesNacional: boolean | null;
  mei: boolean | null;
  incompleto: boolean;
};

export type ResultadoConsultaCnpj =
  | { ok: true; dados: DadosCnpjNormalizados }
  | { ok: false; motivo: MotivoConsultaCnpj; mensagem: string };

export type InscricaoEstadualCnpj = {
  inscricao: string;
  ativo: boolean;
  uf: string;
};

export function mensagemConsultaCnpj(motivo: MotivoConsultaCnpj) {
  if (motivo === "invalido") return MENSAGEM_CNPJ_INVALIDO;
  if (motivo === "nao_encontrado") return MENSAGEM_CNPJ_NAO_ENCONTRADO;
  if (motivo === "limite") return MENSAGEM_CNPJ_LIMITE;
  if (motivo === "timeout") return MENSAGEM_CNPJ_TIMEOUT;
  return MENSAGEM_CNPJ_INDISPONIVEL;
}

export function mascararCnpjDigitando(valor: string) {
  const digitos = somenteDigitosDocumento(valor).slice(0, 14);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 5) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2)}`;
  }
  if (digitos.length <= 8) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5)}`;
  }
  if (digitos.length <= 12) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8)}`;
  }
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

export function dadosCnpjVazios(cnpj = ""): DadosCnpjNormalizados {
  return {
    cnpj,
    razaoSocial: "",
    nomeFantasia: "",
    inscricaoEstadual: "",
    situacaoCadastral: "",
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    codigoIbge: "",
    uf: "",
    telefone: "",
    email: "",
    cnaePrincipal: "",
    descricaoCnaePrincipal: "",
    simplesNacional: null,
    mei: null,
    incompleto: true,
  };
}

export function escolherInscricaoEstadual(
  inscricoes: InscricaoEstadualCnpj[],
  ufEstabelecimento: string
) {
  const comNumero = inscricoes.filter((item) => item.inscricao.trim() !== "");
  if (comNumero.length === 0) {
    return "";
  }

  const ativas = comNumero.filter((item) => item.ativo);
  if (ativas.length === 0) {
    return "";
  }

  const uf = ufEstabelecimento.trim().toUpperCase();
  const candidatas = uf
    ? ativas.filter((item) => item.uf === uf)
    : ativas;

  if (candidatas.length === 1) {
    return candidatas[0].inscricao;
  }

  return "";
}

function objeto(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as Record<string, unknown>;
}

function texto(valor: unknown) {
  if (valor == null) return "";
  return String(valor).trim();
}

function simNao(valor: unknown): boolean | null {
  const bruto = texto(valor).toLowerCase();
  if (!bruto) return null;
  if (["sim", "true", "1", "s"].includes(bruto)) return true;
  if (["nao", "não", "false", "0", "n"].includes(bruto)) return false;
  return null;
}

function regimeAtivo(flag: unknown, dataExclusao: unknown) {
  const ativo = simNao(flag);
  if (ativo !== true) return ativo;
  if (texto(dataExclusao)) return false;
  return true;
}

function montarLogradouro(tipo: string, logradouro: string) {
  const via = logradouro.trim();
  const prefixo = tipo.trim();
  if (!via) return prefixo;
  if (!prefixo) return via;
  const inicio = via.slice(0, prefixo.length).toLowerCase();
  if (inicio === prefixo.toLowerCase()) return via;
  return `${prefixo} ${via}`.trim();
}

function montarTelefone(ddd: string, numero: string) {
  const dddLimpo = somenteDigitosDocumento(ddd).slice(0, 3);
  const numeroLimpo = somenteDigitosDocumento(numero).slice(0, 11);
  if (!numeroLimpo) return "";
  if (!dddLimpo) return numeroLimpo;
  if (numeroLimpo.startsWith(dddLimpo)) return numeroLimpo;
  return `${dddLimpo}${numeroLimpo}`;
}

function cepDigitos(valor: unknown) {
  return somenteDigitosDocumento(valor).slice(0, 8);
}

function ibgeDigitos(valor: unknown) {
  return somenteDigitosDocumento(valor).slice(0, 7);
}

function lerInscricoes(valor: unknown): InscricaoEstadualCnpj[] {
  if (!Array.isArray(valor)) return [];
  const lista: InscricaoEstadualCnpj[] = [];
  for (const item of valor) {
    const bruto = objeto(item);
    if (!bruto) continue;
    const estado = objeto(bruto.estado);
    lista.push({
      inscricao: texto(bruto.inscricao_estadual ?? bruto.inscricao),
      ativo: bruto.ativo === true || simNao(bruto.ativo) === true,
      uf: texto(estado?.sigla ?? bruto.uf).toUpperCase(),
    });
  }
  return lista;
}

export function normalizarRespostaCnpjWs(
  json: unknown,
  cnpjConsultado: string
): ResultadoConsultaCnpj {
  const raiz = objeto(json);
  if (!raiz) {
    return {
      ok: false,
      motivo: "indisponivel",
      mensagem: MENSAGEM_CNPJ_INDISPONIVEL,
    };
  }

  const estabelecimento = objeto(raiz.estabelecimento) ?? {};
  const cidade = objeto(estabelecimento.cidade) ?? {};
  const estado = objeto(estabelecimento.estado) ?? {};
  const atividade = objeto(estabelecimento.atividade_principal) ?? {};
  const simples = objeto(raiz.simples);
  const cnpj = somenteDigitosDocumento(
    estabelecimento.cnpj ?? raiz.cnpj ?? cnpjConsultado
  ).slice(0, 14);

  const uf = texto(estado.sigla ?? estabelecimento.uf).toUpperCase();
  const inscricoes = lerInscricoes(estabelecimento.inscricoes_estaduais);
  const telefone = montarTelefone(
    texto(estabelecimento.ddd1 ?? estabelecimento.ddd),
    texto(estabelecimento.telefone1 ?? estabelecimento.telefone)
  );

  const dados: DadosCnpjNormalizados = {
    cnpj,
    razaoSocial: texto(raiz.razao_social ?? raiz.nome),
    nomeFantasia: texto(
      estabelecimento.nome_fantasia ?? raiz.nome_fantasia ?? raiz.fantasia
    ),
    inscricaoEstadual: escolherInscricaoEstadual(inscricoes, uf),
    situacaoCadastral: texto(estabelecimento.situacao_cadastral),
    cep: cepDigitos(estabelecimento.cep),
    logradouro: montarLogradouro(
      texto(estabelecimento.tipo_logradouro),
      texto(estabelecimento.logradouro)
    ),
    numero: texto(estabelecimento.numero),
    complemento: texto(estabelecimento.complemento),
    bairro: texto(estabelecimento.bairro),
    cidade: texto(cidade.nome ?? estabelecimento.cidade),
    codigoIbge: ibgeDigitos(cidade.ibge_id ?? cidade.ibge ?? estabelecimento.ibge),
    uf,
    telefone,
    email: texto(estabelecimento.email ?? raiz.email),
    cnaePrincipal: texto(atividade.id ?? atividade.codigo),
    descricaoCnaePrincipal: texto(atividade.descricao),
    simplesNacional: simples
      ? regimeAtivo(simples.simples, simples.data_exclusao_simples)
      : null,
    mei: simples ? regimeAtivo(simples.mei, simples.data_exclusao_mei) : null,
    incompleto: false,
  };

  dados.incompleto = !dados.razaoSocial || !dados.cnpj;

  return { ok: true, dados };
}

export function preencherCadastroComCnpj<T extends Record<string, string>>(
  atual: T,
  patch: Partial<T>
): T {
  const proximo = { ...atual };
  for (const [chave, valor] of Object.entries(patch)) {
    if (typeof valor !== "string") continue;
    const textoValor = valor.trim();
    if (!textoValor) continue;
    (proximo as Record<string, string>)[chave] = textoValor;
  }
  return proximo;
}

type EntradaCache = {
  expiraEm: number;
  resultado: ResultadoConsultaCnpj;
};

const cacheConsulta = new Map<string, EntradaCache>();

export function limparCacheConsultaCnpj() {
  cacheConsulta.clear();
}

function resultadoEmCache(cnpj: string) {
  const item = cacheConsulta.get(cnpj);
  if (!item) return null;
  if (Date.now() > item.expiraEm) {
    cacheConsulta.delete(cnpj);
    return null;
  }
  return item.resultado;
}

function guardarCache(cnpj: string, resultado: ResultadoConsultaCnpj) {
  if (!resultado.ok && resultado.motivo !== "nao_encontrado") {
    return;
  }
  cacheConsulta.set(cnpj, {
    expiraEm: Date.now() + CACHE_CONSULTA_CNPJ_MS,
    resultado,
  });
}

function ehTimeout(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const nome = "name" in error ? String(error.name) : "";
  return nome === "TimeoutError" || nome === "AbortError";
}

export async function consultarCnpjWs(
  cnpjBruto: string
): Promise<ResultadoConsultaCnpj> {
  const cnpj = somenteDigitosDocumento(cnpjBruto);
  if (!cnpjValido(cnpj)) {
    return {
      ok: false,
      motivo: "invalido",
      mensagem: MENSAGEM_CNPJ_INVALIDO,
    };
  }

  const emCache = resultadoEmCache(cnpj);
  if (emCache) {
    return emCache;
  }

  try {
    const resposta = await fetch(`${URL_CONSULTA_CNPJ_WS}/${cnpj}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_CONSULTA_CNPJ_MS),
      cache: "no-store",
    });

    if (resposta.status === 404) {
      const resultado: ResultadoConsultaCnpj = {
        ok: false,
        motivo: "nao_encontrado",
        mensagem: MENSAGEM_CNPJ_NAO_ENCONTRADO,
      };
      guardarCache(cnpj, resultado);
      return resultado;
    }

    if (resposta.status === 429) {
      return {
        ok: false,
        motivo: "limite",
        mensagem: MENSAGEM_CNPJ_LIMITE,
      };
    }

    if (!resposta.ok) {
      return {
        ok: false,
        motivo: "indisponivel",
        mensagem: MENSAGEM_CNPJ_INDISPONIVEL,
      };
    }

    const json: unknown = await resposta.json();
    const resultado = normalizarRespostaCnpjWs(json, cnpj);
    guardarCache(cnpj, resultado);
    return resultado;
  } catch (error) {
    if (ehTimeout(error)) {
      return {
        ok: false,
        motivo: "timeout",
        mensagem: MENSAGEM_CNPJ_TIMEOUT,
      };
    }
    return {
      ok: false,
      motivo: "indisponivel",
      mensagem: MENSAGEM_CNPJ_INDISPONIVEL,
    };
  }
}

type JanelaRateLimit = {
  inicio: number;
  quantidade: number;
};

const janelasRateLimit = new Map<string, JanelaRateLimit>();
const JANELA_RATE_LIMIT_MS = 60_000;

export function limparRateLimitConsultaCnpj() {
  janelasRateLimit.clear();
}

export function consumirRateLimitConsultaCnpj(usuarioId: string) {
  const agora = Date.now();
  const atual = janelasRateLimit.get(usuarioId);
  if (!atual || agora - atual.inicio >= JANELA_RATE_LIMIT_MS) {
    janelasRateLimit.set(usuarioId, { inicio: agora, quantidade: 1 });
    return { ok: true as const };
  }
  if (atual.quantidade >= LIMITE_CONSULTAS_CNPJ_POR_MINUTO) {
    return { ok: false as const };
  }
  atual.quantidade += 1;
  return { ok: true as const };
}
