import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  definirOperacaoTesteHomologacao,
  esquecerOperacoesTesteHomologacao,
  provarOperacaoTesteHomologacao,
} from "./autorizacao-operacao-homologacao";
import { esquecerMenuConector, prepararTransporteHomologacao } from "../../../print-agent/src/tef-menu-conector.mjs";

const par = generateKeyPairSync("ed25519");
const publica = par.publicKey.export({ type: "spki", format: "pem" }).toString();
const privada = par.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const agora = 1_800_000_000_000;
const dispositivo = "33333333-3333-4333-8333-333333333333";

function entrada(extra: Record<string, unknown> = {}) {
  return {
    empresaId: "empresa-a",
    dispositivoId: dispositivo,
    terminalCodigo: "caixa-lab",
    posid: "ponto-lab",
    valorCentavos: 100,
    idempotencyKey: "op-servidor-1",
    ...extra,
  };
}

test("o servidor grava a operação e o Connector só aceita a prova assinada", async () => {
  esquecerOperacoesTesteHomologacao();
  esquecerMenuConector();
  const prova = await provarOperacaoTesteHomologacao(entrada(), agora, privada);
  assert.equal(prova.ok, true);
  if (!prova.ok) return;
  let chamadas = 0;
  const preparo = prepararTransporteHomologacao({
    pedido: prova.operacao,
    assinatura: prova.assinatura,
    chavePublicaPem: publica,
    agora,
    entrada: {
      journal: { seguir: true },
      pontoInstalado: true,
      dllOk: true,
      biblioteca: {
        residente: true,
        homologacao: true,
        origem: "conector",
        newTransac() {
          chamadas += 1;
          throw new Error("PW_iNewTransac");
        },
      },
    },
  });
  assert.equal(preparo.codigo, "preparada");
  assert.equal(preparo.nativo, true);
  assert.equal(preparo.execucaoFisica, false);
  assert.equal(preparo.comandoDll, false);
  assert.equal(preparo.transacaoIniciada, false);
  assert.equal(chamadas, 0);

  const divergente = definirOperacaoTesteHomologacao(
    entrada({ informado: { empresaId: "empresa-b", posid: "ponto-errado" } }),
    agora
  );
  assert.equal(divergente.ok, false);
  if (!divergente.ok) assert.equal(divergente.codigo, "empresa");

  const valor = definirOperacaoTesteHomologacao(entrada({ valorCentavos: 250 }), agora);
  assert.equal(valor.ok, false);
  if (!valor.ok) assert.equal(valor.codigo, "valor");

  const semProva = prepararTransporteHomologacao({
    pedido: prova.operacao,
    assinatura: "",
    chavePublicaPem: publica,
    agora,
    entrada: { journal: { seguir: true }, pontoInstalado: true, dllOk: true },
  });
  assert.equal(semProva.codigo, "ausente");
  assert.equal(semProva.nativo, false);
  esquecerOperacoesTesteHomologacao();
  esquecerMenuConector();
});
