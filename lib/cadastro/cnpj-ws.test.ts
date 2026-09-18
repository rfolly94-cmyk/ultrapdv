import assert from "node:assert/strict";
import { test } from "node:test";

import {
  consultarCnpjWs,
  consumirRateLimitConsultaCnpj,
  escolherInscricaoEstadual,
  limparCacheConsultaCnpj,
  limparRateLimitConsultaCnpj,
  LIMITE_CONSULTAS_CNPJ_POR_MINUTO,
  mascararCnpjDigitando,
  MENSAGEM_CNPJ_INDISPONIVEL,
  MENSAGEM_CNPJ_INVALIDO,
  MENSAGEM_CNPJ_LIMITE,
  MENSAGEM_CNPJ_NAO_ENCONTRADO,
  MENSAGEM_CNPJ_TIMEOUT,
  normalizarRespostaCnpjWs,
  preencherCadastroComCnpj,
  URL_CONSULTA_CNPJ_WS,
} from "./cnpj";

const CNPJ_BB = "00000000000191";

function fixtureCnpjWs(overrides?: {
  uf?: string;
  inscricoes?: Array<{
    inscricao_estadual: string;
    ativo: boolean;
    estado: { sigla: string };
  }>;
  razao_social?: string | null;
  simples?: Record<string, unknown> | null;
}) {
  return {
    razao_social: overrides?.razao_social === undefined
      ? "BANCO DO BRASIL SA"
      : overrides.razao_social,
    simples: overrides?.simples === undefined
      ? {
          simples: "Não",
          mei: "Não",
          data_exclusao_simples: null,
          data_exclusao_mei: null,
        }
      : overrides.simples,
    estabelecimento: {
      cnpj: CNPJ_BB,
      nome_fantasia: " ag. SAO PAULO",
      situacao_cadastral: "Ativa",
      tipo_logradouro: "Q",
      logradouro: "SAO PAULO",
      numero: "S/N",
      complemento: "ANDAR 1",
      bairro: "ASA SUL",
      cep: "70073901",
      ddd1: "61",
      telefone1: "34939000",
      email: "bb@example.com",
      atividade_principal: {
        id: "6422100",
        descricao: "Bancos comerciais",
      },
      estado: { sigla: overrides?.uf ?? "DF" },
      cidade: { nome: "BRASILIA", ibge_id: 5300108 },
      inscricoes_estaduais: overrides?.inscricoes ?? [
        {
          inscricao_estadual: "0733214100137",
          ativo: true,
          estado: { sigla: "DF" },
        },
        {
          inscricao_estadual: "172278860119",
          ativo: true,
          estado: { sigla: "SP" },
        },
      ],
    },
  };
}

test("máscara de CNPJ acompanha a digitação XX.XXX.XXX/XXXX-XX", () => {
  assert.equal(mascararCnpjDigitando("00"), "00");
  assert.equal(mascararCnpjDigitando("00000"), "00.000");
  assert.equal(mascararCnpjDigitando("00000000"), "00.000.000");
  assert.equal(mascararCnpjDigitando("000000000001"), "00.000.000/0001");
  assert.equal(mascararCnpjDigitando("00.000.000/0001-91"), "00.000.000/0001-91");
});

test("normaliza a resposta pública da CNPJ.ws sem inferir tributação", () => {
  const resultado = normalizarRespostaCnpjWs(fixtureCnpjWs(), CNPJ_BB);
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.dados.cnpj, CNPJ_BB);
  assert.equal(resultado.dados.razaoSocial, "BANCO DO BRASIL SA");
  assert.equal(resultado.dados.nomeFantasia, "ag. SAO PAULO");
  assert.equal(resultado.dados.situacaoCadastral, "Ativa");
  assert.equal(resultado.dados.cep, "70073901");
  assert.equal(resultado.dados.logradouro, "Q SAO PAULO");
  assert.equal(resultado.dados.numero, "S/N");
  assert.equal(resultado.dados.complemento, "ANDAR 1");
  assert.equal(resultado.dados.bairro, "ASA SUL");
  assert.equal(resultado.dados.cidade, "BRASILIA");
  assert.equal(resultado.dados.codigoIbge, "5300108");
  assert.equal(resultado.dados.uf, "DF");
  assert.equal(resultado.dados.telefone, "6134939000");
  assert.equal(resultado.dados.email, "bb@example.com");
  assert.equal(resultado.dados.cnaePrincipal, "6422100");
  assert.equal(resultado.dados.descricaoCnaePrincipal, "Bancos comerciais");
  assert.equal(resultado.dados.simplesNacional, false);
  assert.equal(resultado.dados.mei, false);
  assert.equal(resultado.dados.inscricaoEstadual, "0733214100137");
  assert.equal("crt" in resultado.dados, false);
  assert.equal("cfop" in resultado.dados, false);
  assert.equal("cst" in resultado.dados, false);
  assert.equal("csosn" in resultado.dados, false);
});

test("IE: prefere ativa da mesma UF e não escolhe quando há empate", () => {
  assert.equal(
    escolherInscricaoEstadual(
      [
        { inscricao: "SP1", ativo: true, uf: "SP" },
        { inscricao: "RJ1", ativo: true, uf: "RJ" },
      ],
      "SP"
    ),
    "SP1"
  );

  assert.equal(
    escolherInscricaoEstadual(
      [
        { inscricao: "SP-BAIXADA", ativo: false, uf: "SP" },
        { inscricao: "SP-ATIVA", ativo: true, uf: "SP" },
      ],
      "SP"
    ),
    "SP-ATIVA"
  );

  assert.equal(
    escolherInscricaoEstadual(
      [
        { inscricao: "SP1", ativo: true, uf: "SP" },
        { inscricao: "SP2", ativo: true, uf: "SP" },
      ],
      "SP"
    ),
    ""
  );

  assert.equal(
    escolherInscricaoEstadual(
      [{ inscricao: "RJ1", ativo: true, uf: "RJ" }],
      "SP"
    ),
    ""
  );

  assert.equal(
    escolherInscricaoEstadual(
      [{ inscricao: "SP-BAIXADA", ativo: false, uf: "SP" }],
      "SP"
    ),
    ""
  );
});

test("campos nulos da API viram string vazia e simples/MEI excluídos ficam false", () => {
  const resultado = normalizarRespostaCnpjWs(
    fixtureCnpjWs({
      razao_social: null,
      simples: {
        simples: "Sim",
        mei: "Sim",
        data_exclusao_simples: "2024-01-01",
        data_exclusao_mei: "2023-01-01",
      },
      inscricoes: [],
    }),
    CNPJ_BB
  );
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.dados.razaoSocial, "");
  assert.equal(resultado.dados.inscricaoEstadual, "");
  assert.equal(resultado.dados.simplesNacional, false);
  assert.equal(resultado.dados.mei, false);
  assert.equal(resultado.dados.incompleto, true);
});

test("preenche só campos com valor; nulos da consulta não apagam o cadastro", () => {
  const atualizado = preencherCadastroComCnpj(
    {
      nome: "Manual",
      email: "ja@existe.com",
      uf: "",
    },
    {
      nome: "BANCO DO BRASIL SA",
      email: "",
      uf: "DF",
    }
  );
  assert.equal(atualizado.nome, "BANCO DO BRASIL SA");
  assert.equal(atualizado.email, "ja@existe.com");
  assert.equal(atualizado.uf, "DF");
});

test("CNPJ inválido não chama a API externa", async () => {
  limparCacheConsultaCnpj();
  let chamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    chamadas += 1;
    throw new Error("não deveria chamar");
  }) as typeof fetch;
  try {
    const resultado = await consultarCnpjWs("00.000.000/0000-00");
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "invalido");
    assert.equal(resultado.mensagem, MENSAGEM_CNPJ_INVALIDO);
    assert.equal(chamadas, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("404 da CNPJ.ws vira CNPJ não encontrado e entra no cache", async () => {
  limparCacheConsultaCnpj();
  let chamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    chamadas += 1;
    assert.equal(String(input), `${URL_CONSULTA_CNPJ_WS}/${CNPJ_BB}`);
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;
  try {
    const primeira = await consultarCnpjWs(CNPJ_BB);
    const segunda = await consultarCnpjWs("00.000.000/0001-91");
    assert.equal(primeira.ok, false);
    if (!primeira.ok) {
      assert.equal(primeira.motivo, "nao_encontrado");
      assert.equal(primeira.mensagem, MENSAGEM_CNPJ_NAO_ENCONTRADO);
    }
    assert.equal(segunda.ok, false);
    assert.equal(chamadas, 1);
  } finally {
    globalThis.fetch = original;
    limparCacheConsultaCnpj();
  }
});

test("429, timeout e falha de rede viram motivos específicos", async () => {
  limparCacheConsultaCnpj();
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({ ok: false, status: 429, json: async () => ({}) }) as Response) as typeof fetch;
  try {
    const limite = await consultarCnpjWs(CNPJ_BB);
    assert.equal(limite.ok, false);
    if (!limite.ok) {
      assert.equal(limite.motivo, "limite");
      assert.equal(limite.mensagem, MENSAGEM_CNPJ_LIMITE);
    }
  } finally {
    globalThis.fetch = original;
  }

  limparCacheConsultaCnpj();
  globalThis.fetch = (async () => {
    const error = new Error("aborted");
    error.name = "TimeoutError";
    throw error;
  }) as typeof fetch;
  try {
    const timeout = await consultarCnpjWs(CNPJ_BB);
    assert.equal(timeout.ok, false);
    if (!timeout.ok) {
      assert.equal(timeout.motivo, "timeout");
      assert.equal(timeout.mensagem, MENSAGEM_CNPJ_TIMEOUT);
    }
  } finally {
    globalThis.fetch = original;
  }

  limparCacheConsultaCnpj();
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  try {
    const rede = await consultarCnpjWs(CNPJ_BB);
    assert.equal(rede.ok, false);
    if (!rede.ok) {
      assert.equal(rede.motivo, "indisponivel");
      assert.equal(rede.mensagem, MENSAGEM_CNPJ_INDISPONIVEL);
    }
  } finally {
    globalThis.fetch = original;
    limparCacheConsultaCnpj();
  }
});

test("rate limit por usuário bloqueia rajada sem chamar a API de novo", () => {
  limparRateLimitConsultaCnpj();
  for (let i = 0; i < LIMITE_CONSULTAS_CNPJ_POR_MINUTO; i += 1) {
    assert.equal(consumirRateLimitConsultaCnpj("user-a").ok, true);
  }
  assert.equal(consumirRateLimitConsultaCnpj("user-a").ok, false);
  assert.equal(consumirRateLimitConsultaCnpj("user-b").ok, true);
  limparRateLimitConsultaCnpj();
});
