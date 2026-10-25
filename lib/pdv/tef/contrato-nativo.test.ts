import assert from "node:assert/strict";
import { accessSync, readFileSync } from "node:fs";
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
  const header = readFileSync(path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924/PGWebLib.h"), "utf8");
  const assinaturas = readFileSync(path.join(raiz, "print-agent/src/tef-pgweb.mjs"), "utf8");
  const buffers = [
    readFileSync(path.join(raiz, "print-agent/src/tef-diagnostico-homologacao.mjs"), "utf8"),
    readFileSync(path.join(raiz, "print-agent/src/tef-instalacao-homologacao.mjs"), "utf8"),
    readFileSync(path.join(raiz, "print-agent/src/tef-venda-nativa.mjs"), "utf8"),
  ].join("\n");
  assert.throws(() => accessSync(path.join(raiz, "tef-2/agente/PgWebLib.pas")));
  const pascal = TRECHOS_CONTRATO_NATIVO.pascal;
  return { header, conector: `${assinaturas}\n${buffers}`, pascal };
}

test("o contrato das quatro funções confere com o header e não inicia cobrança", () => {
  const lido = fontes();
  for (const trecho of TRECHOS_CONTRATO_NATIVO.header.split("\n")) {
    assert.equal(lido.header.includes(trecho), true, trecho);
  }
  for (const trecho of TRECHOS_CONTRATO_NATIVO.conector.split("\n")) {
    assert.equal(lido.conector.includes(trecho), true, trecho);
  }
  for (const trecho of TRECHOS_CONTRATO_NATIVO.pascal.split("\n")) {
    assert.equal(lido.pascal.includes(trecho), true, trecho);
  }
  const diagnostico = diagnosticarContratoNativo(lido);
  const embutido = diagnosticarContratoNativo(TRECHOS_CONTRATO_NATIVO);
  assert.deepEqual(
    [diagnostico.abort, diagnostico.evento, diagnostico.confirmacao, diagnostico.espera],
    [embutido.abort, embutido.evento, embutido.confirmacao, embutido.espera]
  );
  assert.deepEqual(diagnostico.divergencias, []);
  assert.equal(diagnostico.abort, true);
  assert.equal(diagnostico.evento, true);
  assert.equal(diagnostico.confirmacao, true);
  assert.equal(diagnostico.espera, true);
  assert.equal(diagnostico.abiComprovado, false);
  assert.equal(diagnostico.layoutHomologado, false);
  assert.equal(diagnostico.cobrancaIniciada, false);
  assert.equal(diagnostico.typedefNoKit, false);
  assert.equal(DISPLAY_MINIMO_PGWEB, 100);
  assert.equal(BUFFER_DISPLAY_IMPLEMENTADO >= DISPLAY_MINIMO_PGWEB, true);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, true);
  assert.throws(() => accessSync(path.join(raiz, "20260923-Integracao-PGWebLib_v4.1.50.924/PWL_Type.h")));
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
  const quebrado = diagnosticarContratoNativo({ ...lido, header: lido.header.replace("PW_iPPAbort(void);", "PW_iPPAbort(int);") });
  assert.equal(quebrado.abort, false);
  assert.equal(quebrado.cobrancaIniciada, false);
  assert.equal(quebrado.divergencias.some((item) => item.includes("PW_iPPAbort")), true);
});
