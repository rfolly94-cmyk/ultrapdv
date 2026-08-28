import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import {
  departamentoEfetivoBalanca,
  departamentoNumericoBalanca,
  departamentoPadraoDaConfiguracao,
  rotuloDepartamentoTabela,
  sugerirDepartamentoPadrao,
} from "./departamento";

test("produto sem departamento próprio usa departamento padrão 01", () => {
  const efetivo = departamentoEfetivoBalanca(null, "01");
  assert.deepEqual(efetivo, { valor: "01", fonte: "padrao" });
  assert.equal(rotuloDepartamentoTabela(null, "1"), "01 (padrão)");
  assert.equal(departamentoNumericoBalanca("01"), "01");
  assert.equal(departamentoPadraoDaConfiguracao({
    configuracao: { departamentoPadrao: "1" },
  }), "01");
});

test("departamento próprio sobrescreve o padrão", () => {
  const efetivo = departamentoEfetivoBalanca("03", "01");
  assert.deepEqual(efetivo, { valor: "03", fonte: "produto" });
  assert.equal(rotuloDepartamentoTabela("03", "01"), "03");
});

test("sem departamento próprio e sem padrão válido não inventa valor", () => {
  assert.deepEqual(departamentoEfetivoBalanca(null, null), {
    valor: null,
    fonte: null,
  });
  assert.deepEqual(departamentoEfetivoBalanca("", "Açougue"), {
    valor: "Açougue",
    fonte: "padrao",
  });
  assert.equal(rotuloDepartamentoTabela(null, null), "—");
});

test("configuração MGV7 antiga sem o campo usa 01 sem gravar no produto", () => {
  assert.equal(
    departamentoPadraoDaConfiguracao({
      layout: "mgv7",
      configuracao: {},
    }),
    "01"
  );
  assert.equal(
    departamentoPadraoDaConfiguracao({
      layout: "mgv7",
      configuracao: { departamentoPadrao: null },
    }),
    null
  );
});

test("layout MGV7 sugere 01 sem gravar nos produtos", () => {
  assert.equal(
    sugerirDepartamentoPadrao({ layout: "mgv7", atual: "" }),
    "01"
  );
  assert.equal(
    sugerirDepartamentoPadrao({ layout: "mgv7", atual: "03" }),
    "03"
  );
  assert.equal(sugerirDepartamentoPadrao({ layout: null, atual: "" }), "");
  assert.notEqual(empresaA, empresaB);
});
