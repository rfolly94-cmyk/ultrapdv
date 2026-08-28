import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, produtoA, produtoB } from "@/lib/multiempresa/cenario";
import {
  filtrarProdutosVinculados,
  resumirValidacaoCarga,
  validarProdutoBalanca,
  validarProdutosBalanca,
} from "./validar-produto-balanca";
import { produtoElegivelBalanca } from "./elegivel";
import type {
  ConfiguracaoBalanca,
  ProdutoElegivelBalanca,
} from "./tipos";

function produto(parcial: Partial<ProdutoElegivelBalanca>): ProdutoElegivelBalanca {
  return {
    produtoId: produtoA,
    empresaId: empresaA,
    codigo: "100",
    nome: "Banana",
    unidade: "KG",
    precoVenda: 9.9,
    configuracaoId: "cfg-a",
    enviarBalanca: true,
    plu: "1234",
    descricaoBalanca: "Banana",
    validadeEtiquetaDias: 3,
    taraPadrao: null,
    departamento: "01",
    mensagem: null,
    ...parcial,
  };
}

const config: ConfiguracaoBalanca = {
  id: "cfg-a",
  empresaId: empresaA,
  nome: "Toledo caixa 1",
  fabricante: "toledo",
  modelo: "Prix",
  layout: "mgv7",
  tipoIntegracao: "arquivo",
  configuracao: {
    etiqueta: {
      prefixo: "2",
      plu: true,
      modo: "peso",
      quantidadeDigitos: 6,
      casasDecimais: 3,
      digitoVerificador: false,
    },
    departamentoPadrao: "01",
  },
  ativo: true,
};

test("UN = KG habilita elegibilidade; outra UN não entra", () => {
  assert.equal(produtoElegivelBalanca("KG"), true);
  assert.equal(produtoElegivelBalanca("kg"), true);
  assert.equal(produtoElegivelBalanca("UN"), false);
  assert.equal(produtoElegivelBalanca("G"), false);
});

test("KG sem vínculo na configuração fica não vinculado", () => {
  const item = validarProdutoBalanca(
    produto({ enviarBalanca: false, plu: "1234" }),
    [],
    config
  );
  assert.equal(item.status, "nao_vinculado");
});

test("PLU ausente, descrição inválida e preço inválido", () => {
  assert.equal(
    validarProdutoBalanca(produto({ plu: null }), [], config).status,
    "plu_ausente"
  );
  assert.equal(
    validarProdutoBalanca(
      produto({ descricaoBalanca: "", nome: "" }),
      [],
      config
    ).status,
    "descricao_invalida"
  );
  assert.equal(
    validarProdutoBalanca(produto({ precoVenda: 0 }), [], config).status,
    "preco_invalido"
  );
});

test("PLU duplicado só na mesma empresa", () => {
  const a = produto({ produtoId: produtoA, plu: "10", empresaId: empresaA });
  const duplicado = produto({
    produtoId: "p-outro",
    plu: "10",
    empresaId: empresaA,
  });
  const outraEmpresa = produto({
    produtoId: produtoB,
    plu: "10",
    empresaId: empresaB,
  });

  assert.equal(
    validarProdutoBalanca(a, [a, duplicado], config).status,
    "plu_duplicado"
  );
  assert.equal(
    validarProdutoBalanca(a, [a, outraEmpresa], config).status,
    "pronto"
  );
});

test("MGV7 rejeita PLU, departamento, validade e descrição fora da spec", () => {
  assert.equal(
    validarProdutoBalanca(produto({ plu: "1234567" }), [], config).status,
    "plu_invalido"
  );
  assert.equal(
    validarProdutoBalanca(produto({ departamento: "Açougue" }), [], config)
      .status,
    "departamento_invalido"
  );
  assert.equal(
    validarProdutoBalanca(produto({ validadeEtiquetaDias: 1000 }), [], config)
      .status,
    "validade_invalida"
  );
  assert.equal(
    validarProdutoBalanca(
      produto({ descricaoBalanca: "A".repeat(121) }),
      [],
      config
    ).status,
    "descricao_invalida"
  );
});

test("produto sem departamento próprio usa o padrão 01 e fica Pronto", () => {
  const item = validarProdutoBalanca(
    produto({ departamento: null }),
    [],
    config
  );
  assert.equal(item.status, "pronto");
  assert.deepEqual(item.problemas, []);
});

test("departamento próprio sobrescreve o padrão da configuração", () => {
  const item = validarProdutoBalanca(
    produto({ departamento: "03" }),
    [],
    config
  );
  assert.equal(item.status, "pronto");
});

test("sem departamento próprio e sem padrão válido gera erro", () => {
  const semPadrao = {
    ...config,
    configuracao: {
      ...config.configuracao,
      departamentoPadrao: null,
    },
  };
  const item = validarProdutoBalanca(
    produto({ departamento: null }),
    [],
    semPadrao
  );
  assert.equal(item.status, "departamento_invalido");
  assert.match(item.problemas[0] ?? "", /departamento numérico/);
});

test("configuração MGV7 antiga sem o campo de padrão valida com 01", () => {
  const antiga = {
    ...config,
    configuracao: {
      etiqueta: config.configuracao.etiqueta,
    },
  };
  const item = validarProdutoBalanca(
    produto({ departamento: null }),
    [],
    antiga
  );
  assert.equal(item.status, "pronto");
});

test("configuração incompleta bloqueia status pronto", () => {
  const incompleta = { ...config, layout: null };
  assert.equal(
    validarProdutoBalanca(produto({}), [produto({})], incompleta).status,
    "configuracao_incompleta"
  );
});

test("validação resume encontrados, válidos e erros sem incluir não vinculados", () => {
  const itens = validarProdutosBalanca(
    [
      produto({ produtoId: "1", plu: "1" }),
      produto({ produtoId: "2", enviarBalanca: false, plu: "2" }),
      produto({ produtoId: "3", plu: null }),
    ],
    config
  );
  const resumo = resumirValidacaoCarga(itens);
  assert.equal(resumo.encontrados, 3);
  assert.equal(resumo.validos, 1);
  assert.equal(resumo.comErro, 1);
  assert.equal(resumo.problemas[0]?.status, "plu_ausente");
});

test("filtros de vinculados, não vinculados, erro, departamento e busca", () => {
  const itens = validarProdutosBalanca(
    [
      produto({ produtoId: "1", plu: "11", nome: "Maçã", codigo: "A1" }),
      produto({
        produtoId: "2",
        enviarBalanca: false,
        plu: "22",
        nome: "Pera",
      }),
      produto({
        produtoId: "3",
        plu: null,
        nome: "Uva",
        departamento: "Frios",
      }),
    ],
    config
  );

  assert.equal(filtrarProdutosVinculados(itens, "vinculados").length, 2);
  assert.equal(filtrarProdutosVinculados(itens, "nao_vinculados").length, 1);
  assert.equal(filtrarProdutosVinculados(itens, "com_erro").length, 1);
  assert.equal(
    filtrarProdutosVinculados(itens, "todos", "", "Frios").length,
    1
  );
  assert.equal(filtrarProdutosVinculados(itens, "todos", "maç").length, 1);
  assert.equal(filtrarProdutosVinculados(itens, "todos", "11").length, 1);
  assert.equal(
    filtrarProdutosVinculados(
      validarProdutosBalanca(
        [produto({ departamento: null, plu: "11" })],
        config
      ),
      "todos",
      "",
      "01",
      "01"
    ).length,
    1
  );
});
