import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { AUTCAP_FIXO, CAPACIDADES_NAO_ENVIADAS, calcularPwinfoAutcap } from "@/lib/pdv/tef/autcap";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("PWINFO_AUTCAP envia somente o valor fixo da especificação", () => {
  assert.equal(calcularPwinfoAutcap(), String(AUTCAP_FIXO));
  assert.equal(calcularPwinfoAutcap(), "4");
  const soma = CAPACIDADES_NAO_ENVIADAS.reduce((total, item) => total + item.valor, AUTCAP_FIXO);
  assert.notEqual(calcularPwinfoAutcap(), String(soma));
  for (const item of CAPACIDADES_NAO_ENVIADAS) {
    assert.equal(Number(calcularPwinfoAutcap()) & item.valor, 0, item.nome);
  }
});

test("a configuração do lojista não edita AUTCAP e o motor único é pgweb", () => {
  const pagina = readFileSync(resolve(raiz, "app/configuracoes/financeiro/tef/page.tsx"), "utf8");
  const acao = readFileSync(resolve(raiz, "app/configuracoes/financeiro/tef/actions.ts"), "utf8");
  assert.equal(pagina.toLowerCase().includes("autcap"), false);
  assert.equal(acao.toLowerCase().includes("autcap"), false);
  assert.equal(pagina.includes('name="capacidades"'), false);
  const motor = readFileSync(resolve(raiz, "print-agent/src/tef-pgweb.mjs"), "utf8");
  assert.match(motor, /MOTOR_PADRAO = "pgweb"/);
  assert.match(motor, /PGWEB2_PRODUCAO = true/);
  assert.match(motor, /ABI_COMPROVADO = false/);
  assert.match(motor, /LAYOUT_HOMOLOGADO = false/);
  assert.match(motor, /calcularPwinfoAutcap\(\)/);
  assert.equal(motor.includes("dados.capacidades"), false);
});
