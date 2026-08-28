import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, produtoA, produtoB } from "@/lib/multiempresa/cenario";
import {
  criarVinculoProdutoConfiguracao,
  inserirVinculoConfiguracaoProduto,
  produtosDaConfiguracao,
  vinculoMesmaEmpresa,
} from "./vinculo";

const configA = "cfg-acougue";
const configB = "cfg-padaria";

test("uma empresa pode ter o mesmo produto em uma config e não em outra", () => {
  const vinculos = [
    criarVinculoProdutoConfiguracao({
      empresaIdSessao: empresaA,
      empresaIdConfig: empresaA,
      empresaIdProduto: empresaA,
      configuracaoId: configA,
      produtoId: produtoA,
    }),
  ];

  const produtos = [
    { produtoId: produtoA, empresaId: empresaA, nome: "Alcatra" },
    { produtoId: produtoB, empresaId: empresaA, nome: "Pão" },
  ];

  const daA = produtosDaConfiguracao(produtos, vinculos, configA, empresaA);
  const daB = produtosDaConfiguracao(produtos, vinculos, configB, empresaA);

  assert.deepEqual(
    daA.map((item) => item.produtoId),
    [produtoA]
  );
  assert.equal(daB.length, 0);
});

test("empresa A não cria vínculo com configuração ou produto da empresa B", () => {
  assert.equal(
    vinculoMesmaEmpresa({
      empresaIdSessao: empresaA,
      empresaIdConfig: empresaB,
      empresaIdProduto: empresaA,
    }),
    false
  );
  assert.throws(
    () =>
      criarVinculoProdutoConfiguracao({
        empresaIdSessao: empresaA,
        empresaIdConfig: empresaA,
        empresaIdProduto: empresaB,
        configuracaoId: configA,
        produtoId: produtoB,
      }),
    /empresa_mismatch/
  );
});

test("UNIQUE impede vínculo duplicado na mesma configuração", () => {
  const vinculos = [
    criarVinculoProdutoConfiguracao({
      empresaIdSessao: empresaA,
      empresaIdConfig: empresaA,
      empresaIdProduto: empresaA,
      configuracaoId: configA,
      produtoId: produtoA,
    }),
  ];

  assert.throws(
    () =>
      inserirVinculoConfiguracaoProduto(
        vinculos,
        criarVinculoProdutoConfiguracao({
          empresaIdSessao: empresaA,
          empresaIdConfig: empresaA,
          empresaIdProduto: empresaA,
          configuracaoId: configA,
          produtoId: produtoA,
        })
      ),
    /unique_violation/
  );

  inserirVinculoConfiguracaoProduto(
    vinculos,
    criarVinculoProdutoConfiguracao({
      empresaIdSessao: empresaA,
      empresaIdConfig: empresaA,
      empresaIdProduto: empresaA,
      configuracaoId: configB,
      produtoId: produtoA,
    })
  );
  assert.equal(vinculos.length, 2);
});
