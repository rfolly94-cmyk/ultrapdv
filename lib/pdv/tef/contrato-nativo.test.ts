import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  BUFFER_DISPLAY_IMPLEMENTADO,
  DISPLAY_MINIMO_PGWEB,
  ROTEIRO_FISICO_HOMOLOGACAO,
  TRECHOS_CONTRATO_NATIVO,
  diagnosticarContratoNativo,
} from "./contrato-nativo";
import { evidenciaAtual } from "./concluir-venda-tef";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, PGWEB2_PRODUCAO } from "./motor";

const raiz = path.resolve(import.meta.dirname, "../../..");

function fontes() {
  assert.equal(existsSync(path.join(raiz, "print-agent/src/tef-pgweb.mjs")), false);
  assert.equal(existsSync(path.join(raiz, "print-agent/src/tef-venda-nativa.mjs")), false);
  const headerCaminho = path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924/PGWebLib.h");
  const header = existsSync(headerCaminho) ? readFileSync(headerCaminho, "utf8") : "";
  return { header };
}

test("o contrato das quatro funções confere com o header e não inicia cobrança", () => {
  const lido = fontes();
  if (lido.header) {
    for (const trecho of TRECHOS_CONTRATO_NATIVO.header.split("\n")) {
      assert.equal(lido.header.includes(trecho), true, trecho);
    }
  }
  const embutido = diagnosticarContratoNativo(TRECHOS_CONTRATO_NATIVO);
  assert.deepEqual(
    [embutido.abort, embutido.evento, embutido.confirmacao, embutido.espera],
    [true, true, true, true]
  );
  assert.deepEqual(embutido.divergencias, []);
  assert.equal(embutido.abort, true);
  assert.equal(embutido.evento, true);
  assert.equal(embutido.confirmacao, true);
  assert.equal(embutido.espera, true);
  assert.equal(embutido.abiComprovado, false);
  assert.equal(embutido.layoutHomologado, false);
  assert.equal(embutido.cobrancaIniciada, false);
  assert.equal(embutido.typedefNoKit, false);
  assert.equal(DISPLAY_MINIMO_PGWEB, 100);
  assert.equal(BUFFER_DISPLAY_IMPLEMENTADO >= DISPLAY_MINIMO_PGWEB, true);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, true);
  assert.equal(existsSync(path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924/PWL_Type.h")), false);
  assert.equal(ROTEIRO_FISICO_HOMOLOGACAO.some((passo) => passo.includes("PW_iPPAbort")), true);
  assert.equal(ROTEIRO_FISICO_HOMOLOGACAO.some((passo) => passo.includes("PW_iWaitConfirmation")), true);
  const evidencia = evidenciaAtual();
  assert.equal(evidencia.abortComprovado, true);
  assert.equal(evidencia.eventoComprovado, true);
  assert.equal(evidencia.confirmacaoComprovada, true);
  assert.equal(evidencia.esperaConfirmacaoComprovada, true);
  assert.equal(evidencia.abi, true);
  assert.equal(evidencia.layout, true);
  assert.equal(evidencia.producaoLiberada, true);
  const headerBase = lido.header || TRECHOS_CONTRATO_NATIVO.header;
  const quebrado = diagnosticarContratoNativo({
    header: headerBase.replace("PW_iPPAbort(void);", "PW_iPPAbort(int);"),
    conector: TRECHOS_CONTRATO_NATIVO.conector,
    pascal: TRECHOS_CONTRATO_NATIVO.pascal,
  });
  assert.equal(quebrado.abort, false);
  assert.equal(quebrado.cobrancaIniciada, false);
  assert.equal(quebrado.divergencias.some((item) => item.includes("PW_iPPAbort")), true);
});
