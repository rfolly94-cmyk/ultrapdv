export const MENSAGEM_CEP_NAO_ENCONTRADO =
  "CEP não encontrado. Preencha o endereço manualmente.";

export const MENSAGEM_CEP_CONSULTA_FALHOU =
  "Não foi possível consultar o CEP. Preencha o endereço manualmente.";

export type EnderecoViaCep = {
  logradouro: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigoMunicipioIbge: string;
};

export type ResultadoViaCep =
  | { ok: true; endereco: EnderecoViaCep }
  | { ok: false; motivo: "nao_encontrado" | "invalido" | "falha" };

const cacheConsulta = new Map<string, ResultadoViaCep>();

export function digitosCep(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "").slice(0, 8);
}

export function interpretarRespostaViaCep(json: unknown): ResultadoViaCep {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, motivo: "falha" };
  }
  const bruto = json as Record<string, unknown>;
  if (bruto.erro === true || bruto.erro === "true") {
    return { ok: false, motivo: "nao_encontrado" };
  }
  const ibge = String(bruto.ibge ?? "").replace(/\D/g, "");
  const uf = String(bruto.uf ?? "").trim().toUpperCase();
  return {
    ok: true,
    endereco: {
      logradouro: String(bruto.logradouro ?? "").trim(),
      bairro: String(bruto.bairro ?? "").trim(),
      municipio: String(bruto.localidade ?? "").trim(),
      uf,
      codigoMunicipioIbge: ibge,
    },
  };
}

export function aplicarEnderecoViaCep<T extends Record<string, unknown>>(
  atual: T,
  endereco: EnderecoViaCep
): T {
  return {
    ...atual,
    logradouro: endereco.logradouro,
    bairro: endereco.bairro,
    municipio: endereco.municipio,
    uf: endereco.uf,
    codigoMunicipioIbge: endereco.codigoMunicipioIbge,
  };
}

export async function buscarEnderecoPorCep(cepBruto: string): Promise<ResultadoViaCep> {
  const cep = digitosCep(cepBruto);
  if (cep.length !== 8) {
    return { ok: false, motivo: "invalido" };
  }
  const emCache = cacheConsulta.get(cep);
  if (emCache) {
    return emCache;
  }
  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!resposta.ok) {
      return { ok: false, motivo: "falha" };
    }
    const json: unknown = await resposta.json();
    const resultado = interpretarRespostaViaCep(json);
    if (resultado.ok || resultado.motivo === "nao_encontrado") {
      cacheConsulta.set(cep, resultado);
    }
    return resultado;
  } catch {
    return { ok: false, motivo: "falha" };
  }
}

export function limparCacheViaCep() {
  cacheConsulta.clear();
}
