import assert from "node:assert/strict";
import { accessSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ABI_COMPROVADO, ASSINATURAS_NATIVAS, LAYOUT_HOMOLOGADO, PGWEB2_PRODUCAO } from "./tef-pgweb.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("o diagnóstico nativo confere as quatro funções sem carregar a DLL nem cobrar", () => {
  const header = readFileSync(path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924/PGWebLib.h"), "utf8");
  const instalacao = readFileSync(new URL("./tef-instalacao-homologacao.mjs", import.meta.url), "utf8");
  const diagnostico = readFileSync(new URL("./tef-diagnostico-homologacao.mjs", import.meta.url), "utf8");
  const venda = readFileSync(new URL("./tef-venda-nativa.mjs", import.meta.url), "utf8");
  assert.match(header, /extern Int16 PW_EXPORT PW_iPPAbort\(void\);/);
  assert.match(header, /extern Int16 PW_EXPORT PW_iPPEventLoop \(char \*pszDisplay, Uint32 ulDisplaySize\);/);
  assert.match(header, /extern Int16 PW_EXPORT PW_iConfirmation \(Uint32 ulResult, const char\* pszReqNum, const char\* pszLocRef, const char\* pszExtRef,/);
  assert.match(header, /const char\* pszVirtMerch, const char\* pszAuthSyst\);/);
  assert.match(header, /extern Int16 PW_EXPORT PW_iWaitConfirmation\(void\);/);
  assert.match(header, /PW_iPPEventLoop[\s\S]{0,900}100 bytes/);
  assert.match(header, /#include "PWL_Type.h"/);
  assert.equal(ASSINATURAS_NATIVAS.PW_iPPAbort, "int16 __stdcall PW_iPPAbort()");
  assert.equal(ASSINATURAS_NATIVAS.PW_iPPEventLoop, "int16 __stdcall PW_iPPEventLoop(_Out_ char *display, uint32)");
  assert.equal(ASSINATURAS_NATIVAS.PW_iConfirmation, "int16 __stdcall PW_iConfirmation(uint32, str, str, str, str, str)");
  assert.equal(ASSINATURAS_NATIVAS.PW_iWaitConfirmation, "int16 __stdcall PW_iWaitConfirmation()");
  for (const fonte of [instalacao, diagnostico, venda]) {
    assert.match(fonte, /Buffer\.alloc\(128\)/);
  }
  assert.throws(() => accessSync(path.join(raiz, "tef-2/agente/PgWebLib.pas")));
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, false);
  assert.throws(() => accessSync(path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924/PWL_Type.h")));
  assert.equal(header.includes("PW_iNewTransac"), true);
  assert.equal(new URL(import.meta.url).pathname.endsWith("tef-diagnostico-contrato.test.mjs"), true);
});
