import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolverRaizAgente } from "./raiz.mjs";
import {
  ASSINATURAS_FINANCEIRAS,
  OFFSETS_PW_GETDATA,
  TAMANHO_PW_GETDATA,
  caminhoDeProducao,
  inspecionarDllFinanceira,
  medirLayoutFinanceiro,
} from "./tef-layout-financeiro.mjs";

const raiz = path.dirname(fileURLToPath(import.meta.url));

test("o layout financeiro mede PW_GetData da DLL x64 sem iniciar transação", async () => {
  const koffi = (await import("koffi")).default;
  const layout = medirLayoutFinanceiro(koffi);
  assert.equal(layout.sizeof, TAMANHO_PW_GETDATA);
  assert.deepEqual(layout.offsets, OFFSETS_PW_GETDATA);
});

test("a prova recusa perfil de produção e não carrega a DLL", async () => {
  let carregou = false;
  await assert.rejects(
    () =>
      inspecionarDllFinanceira("C:\\UltraPDV\\TEF\\Producao\\PGWebLib.dll", {
        carregar() {
          carregou = true;
        },
      }),
    (erro) => erro.code === "PERFIL_PRODUCAO"
  );
  assert.equal(carregou, false);
  assert.equal(caminhoDeProducao("C:\\Program Files (x86)\\PayGo\\PGWebLib\\x64\\PGWebLib.dll"), true);
});

test("as assinaturas financeiras são as da instalação e nenhuma venda é disparada", async () => {
  const contrato = readFileSync(path.join(raiz, "tef-pgweb.mjs"), "utf8");
  const instalacao = readFileSync(path.join(raiz, "tef-instalacao-homologacao.mjs"), "utf8");
  for (const [nome, assinatura] of ASSINATURAS_FINANCEIRAS) {
    if (assinatura.includes("PW_iWaitConfirmation")) continue;
    assert.equal(contrato.includes(assinatura), true);
    assert.equal(instalacao.includes(`assinaturaNativa("${nome}")`), true);
  }
  const venda = readFileSync(path.join(raiz, "tef-venda-nativa.mjs"), "utf8");
  assert.equal(venda.includes("koffi.load"), false);
  assert.equal(venda.includes("Buffer.alloc(4096)"), true);
  const motor = readFileSync(path.join(raiz, "tef-pgweb.mjs"), "utf8");
  assert.equal(motor.includes("ABI_COMPROVADO = false"), true);
  assert.equal(motor.includes("LAYOUT_HOMOLOGADO = false"), true);
  assert.equal(motor.includes("this.biblioteca.confirmation"), true);
  assert.equal(motor.includes("PW_iWaitConfirmation"), true);
  assert.equal(motor.includes("this.journal"), true);

  const arquivo = path.join(resolverRaizAgente(), "bin", "tef", "PGWebLib.dll");
  if (caminhoDeProducao(arquivo)) {
    assert.fail("A DLL candidata aponta para produção.");
  }
  try {
    await access(arquivo);
  } catch {
    return;
  }
  const prova = await inspecionarDllFinanceira(arquivo);
  assert.equal(prova.arquitetura, "x64");
  assert.equal(prova.sizeof, TAMANHO_PW_GETDATA);
  assert.equal(prova.invocacoes, 0);
  assert.equal(prova.vendaExecutada, false);
  assert.deepEqual(
    prova.exportacoes,
    ASSINATURAS_FINANCEIRAS.map(([nome]) => nome)
  );
});
