import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import {
  assinarProvaTef,
  mensagemProvaTef,
  verificarProvaTef,
} from "./prova";

function par() {
  const gerado = generateKeyPairSync("ed25519");
  return {
    publica: gerado.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const campos = {
  acao: "pagamento" as const,
  desafio: "a".repeat(64),
  identificador: "11111111-1111-4111-8111-111111111111",
  valorCentavos: 2500,
  nsu: "998877",
  autorizacao: "AUT01",
  rede: "CIELO",
  finalizacao: "FIN01",
  sucesso: true,
  codigo: "",
};

test("a prova do terminal confere e não aceita NSU ou valor trocados", () => {
  const chave = par();
  const prova = assinarProvaTef(chave.privada, campos);
  assert.equal(verificarProvaTef(chave.publica, campos, prova), true);
  assert.equal(
    verificarProvaTef(chave.publica, { ...campos, nsu: "000001" }, prova),
    false
  );
  assert.equal(
    verificarProvaTef(chave.publica, { ...campos, valorCentavos: 1 }, prova),
    false
  );
  assert.equal(
    verificarProvaTef(chave.publica, { ...campos, desafio: "b".repeat(64) }, prova),
    false
  );
  assert.equal(verificarProvaTef(chave.publica, campos, ""), false);
  assert.match(mensagemProvaTef(campos), /^ultrapdv-tef-v1\n/);
});
