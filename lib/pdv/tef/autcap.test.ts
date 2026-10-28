import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { AUTCAP_FIXO, AUTCAP_VIAS_DIFERENCIADAS, CAPACIDADES_NAO_ENVIADAS, calcularPwinfoAutcap } from "@/lib/pdv/tef/autcap";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("PWINFO_AUTCAP declara as vias diferenciadas e preserva o termo fixo", () => {
  assert.equal(calcularPwinfoAutcap(), String(AUTCAP_FIXO + AUTCAP_VIAS_DIFERENCIADAS));
  assert.equal(calcularPwinfoAutcap(), "12");
  assert.equal(Number(calcularPwinfoAutcap()) & AUTCAP_FIXO, AUTCAP_FIXO);
  assert.equal(Number(calcularPwinfoAutcap()) & AUTCAP_VIAS_DIFERENCIADAS, AUTCAP_VIAS_DIFERENCIADAS);
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
  const motor = readFileSync(resolve(raiz, "lib/pdv/tef/motor.ts"), "utf8");
  const autcap = readFileSync(resolve(raiz, "lib/pdv/tef/autcap.ts"), "utf8");
  assert.match(motor, /PGWEB2_PRODUCAO = true/);
  assert.match(motor, /ABI_COMPROVADO = false/);
  assert.match(motor, /LAYOUT_HOMOLOGADO = false/);
  assert.match(autcap, /calcularPwinfoAutcap/);
  assert.equal(motor.includes("dados.capacidades"), false);
  assert.equal(existsSync(resolve(raiz, "print-agent/src/tef-pgweb.mjs")), false);
});
