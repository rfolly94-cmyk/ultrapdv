import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import {
  atribuirPluComRetry,
  pluPreenchido,
  precisaGerarPluVinculo,
  proximoPluDisponivel,
} from "./plu";

test("primeiro produto da empresa recebe PLU 1 e o segundo recebe 2", () => {
  assert.equal(proximoPluDisponivel([]), "1");
  assert.equal(proximoPluDisponivel(["1"]), "2");
});

test("não duplica PLU e não reutiliza números antigos", () => {
  assert.equal(proximoPluDisponivel(["1", "2", "4"]), "5");
  assert.equal(proximoPluDisponivel(["1", "2", "3"]), "4");
  assert.equal(proximoPluDisponivel(["01", "2"]), "3");
});

test("PLU existente não muda", async () => {
  let gravou = false;
  const saida = await atribuirPluComRetry({
    lerPluAtual: async () => "10",
    listarPlusDaEmpresa: async () => {
      throw new Error("não deveria listar PLUs de outra atribuição");
    },
    gravarNovoPlu: async () => {
      gravou = true;
      return "ok";
    },
  });
  assert.deepEqual(saida, { ok: true, plu: "10" });
  assert.equal(gravou, false);
  assert.equal(pluPreenchido("10"), true);
  assert.equal(pluPreenchido("  "), false);
});

test("empresas diferentes podem usar o mesmo PLU e A não considera B", () => {
  const plusA = ["1", "2", "3"];
  const plusB: string[] = [];
  assert.equal(proximoPluDisponivel(plusA), "4");
  assert.equal(proximoPluDisponivel(plusB), "1");
  assert.equal(proximoPluDisponivel(["1"]), "2");
  assert.notEqual(empresaA, empresaB);
});

test("colisão concorrente não gera duplicidade", async () => {
  const plus = ["1", "2"];
  let outroProcessoVenceu = true;

  const saida = await atribuirPluComRetry({
    lerPluAtual: async () => null,
    listarPlusDaEmpresa: async () => [...plus],
    gravarNovoPlu: async (plu) => {
      if (plus.includes(plu)) {
        return "colisao";
      }
      if (outroProcessoVenceu && plu === "3") {
        outroProcessoVenceu = false;
        plus.push("3");
        return "colisao";
      }
      plus.push(plu);
      return "ok";
    },
  });

  assert.deepEqual(saida, { ok: true, plu: "4" });
  assert.deepEqual(plus, ["1", "2", "3", "4"]);
  assert.equal(new Set(plus).size, plus.length);
});

test("registro sem PLU recebe o próximo crescente da empresa", async () => {
  const plus = ["5", "7"];
  const saida = await atribuirPluComRetry({
    lerPluAtual: async () => null,
    listarPlusDaEmpresa: async () => [...plus],
    gravarNovoPlu: async (plu) => {
      plus.push(plu);
      return "ok";
    },
  });
  assert.deepEqual(saida, { ok: true, plu: "8" });
});

test("produto antigo vinculado sem PLU recebe PLU automaticamente", async () => {
  const plusDaEmpresa = ["2"];
  const produtos = [
    {
      produtoId: "p-antigo",
      empresaId: empresaA,
      enviarBalanca: true,
      plu: null as string | null,
    },
    {
      produtoId: "p-com-plu",
      empresaId: empresaA,
      enviarBalanca: true,
      plu: "2" as string | null,
    },
    {
      produtoId: "p-b",
      empresaId: empresaB,
      enviarBalanca: true,
      plu: null as string | null,
    },
  ];

  for (const produto of produtos) {
    if (
      produto.empresaId !== empresaA ||
      !precisaGerarPluVinculo({
        vinculado: produto.enviarBalanca,
        plu: produto.plu,
      })
    ) {
      continue;
    }

    const saida = await atribuirPluComRetry({
      lerPluAtual: async () => produto.plu,
      listarPlusDaEmpresa: async () => [...plusDaEmpresa],
      gravarNovoPlu: async (plu) => {
        plusDaEmpresa.push(plu);
        produto.plu = plu;
        return "ok";
      },
    });
    assert.equal(saida.ok, true);
  }

  assert.equal(produtos[0]?.plu, "3");
  assert.equal(produtos[1]?.plu, "2");
  assert.equal(produtos[2]?.plu, null);
  assert.equal(pluPreenchido(produtos[1]?.plu), true);
});
