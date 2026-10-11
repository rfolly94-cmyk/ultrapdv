import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import {
  assinarEvidenciaInstalacao,
  avaliarEmissaoEvidencia,
  mensagemEvidenciaInstalacao,
} from "./tef-prova.mjs";

const empresa = "11111111-1111-4111-8111-111111111111";
const dispositivo = "33333333-3333-4333-8333-333333333333";
const terminal = "44444444-4444-4444-8444-444444444444";
const instalacao = "55555555-5555-4555-8555-555555555555";

function observacao(parcial = {}) {
  return {
    empresaId: empresa,
    dispositivoId: dispositivo,
    terminalId: terminal,
    pontoCaptura: "200001",
    pontoInstalado: "200001",
    estabelecimento: "LOJA",
    ambienteSolicitado: "homologacao",
    instalacaoId: instalacao,
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
    ...parcial,
  };
}

function par() {
  const gerado = generateKeyPairSync("ed25519");
  return {
    publica: gerado.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

test("o Connector só assina instalação controlada bem-sucedida", () => {
  const chave = par();
  const homologacao = assinarEvidenciaInstalacao(chave.privada, observacao());
  const producao = assinarEvidenciaInstalacao(
    chave.privada,
    observacao({
      ambienteSolicitado: "producao",
      instalacaoId: "56565656-5656-4565-8565-565656565656",
    })
  );
  assert.ok(homologacao);
  assert.ok(producao);
  assert.equal(
    mensagemEvidenciaInstalacao(homologacao.campos),
    [
      "ultrapdv-tef-instalacao-v1",
      empresa,
      dispositivo,
      terminal,
      "200001",
      "LOJA",
      "homologacao",
      instalacao,
      "1",
      "0",
      "1",
      "1",
    ].join("\n")
  );
  assert.equal(producao.campos.ambiente, "producao");
  assert.notEqual(homologacao.assinatura, producao.assinatura);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ instalacaoConcluida: false })), null);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ retornoSetEnvironment: 7 })), null);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ pontoNaoExistia: false })), null);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ pontoInstalado: "117473" })), null);
  assert.equal(assinarEvidenciaInstalacao(chave.privada, observacao({ vinculoAutorizado: false })), null);
  const falha = avaliarEmissaoEvidencia(observacao({ instalacaoConcluida: false }));
  assert.equal(falha.ok, false);
});
