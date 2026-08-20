import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aplicarEnderecoViaCep,
  buscarEnderecoPorCep,
  digitosCep,
  interpretarRespostaViaCep,
  limparCacheViaCep,
} from "./viacep";

test("remove máscara e limita o CEP a 8 dígitos", () => {
  assert.equal(digitosCep("78.043-604"), "78043604");
  assert.equal(digitosCep("78043-6041"), "78043604");
  assert.equal(digitosCep(""), "");
});

test("usa o campo ibge do ViaCEP como código IBGE do município", () => {
  const resultado = interpretarRespostaViaCep({
    logradouro: "Avenida Historiador Rubens de Mendonça",
    bairro: "Bosque da Saúde",
    localidade: "Cuiabá",
    uf: "mt",
    ibge: "5103403",
    complemento: "de 5000 ao fim",
  });
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.equal(resultado.endereco.codigoMunicipioIbge, "5103403");
  assert.equal(resultado.endereco.municipio, "Cuiabá");
  assert.equal(resultado.endereco.uf, "MT");
  assert.equal(resultado.endereco.logradouro, "Avenida Historiador Rubens de Mendonça");
  assert.equal(resultado.endereco.bairro, "Bosque da Saúde");
});

test("CEP inexistente não quebra o formulário", () => {
  const resultado = interpretarRespostaViaCep({ erro: true });
  assert.equal(resultado.ok, false);
  if (resultado.ok) return;
  assert.equal(resultado.motivo, "nao_encontrado");
});

test("não sobrescreve número nem complemento do cadastro", () => {
  const atualizado = aplicarEnderecoViaCep(
    {
      logradouro: "",
      bairro: "",
      municipio: "",
      uf: "",
      codigoMunicipioIbge: "",
      numero: "120",
      complemento: "Sala 2",
    },
    {
      logradouro: "Rua das Palmeiras",
      bairro: "Centro",
      municipio: "Cuiabá",
      uf: "MT",
      codigoMunicipioIbge: "5103403",
    }
  );
  assert.equal(atualizado.numero, "120");
  assert.equal(atualizado.complemento, "Sala 2");
  assert.equal(atualizado.logradouro, "Rua das Palmeiras");
  assert.equal(atualizado.codigoMunicipioIbge, "5103403");
});

test("evita chamada repetida para o mesmo CEP", async () => {
  limparCacheViaCep();
  let chamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    chamadas += 1;
    return {
      ok: true,
      json: async () => ({
        logradouro: "Praça da Sé",
        bairro: "Sé",
        localidade: "São Paulo",
        uf: "SP",
        ibge: "3550308",
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const primeira = await buscarEnderecoPorCep("01001-000");
    const segunda = await buscarEnderecoPorCep("01001000");
    assert.equal(primeira.ok, true);
    assert.equal(segunda.ok, true);
    assert.equal(chamadas, 1);
  } finally {
    globalThis.fetch = original;
    limparCacheViaCep();
  }
});
