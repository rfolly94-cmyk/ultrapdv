import assert from "node:assert/strict";
import { test } from "node:test";

import {
  persistenciaFalhaComunicacaoEmitir,
  transmissaoPodeTerSaidoDoErro,
  montarDiagnosticoRespostaGeranet,
} from "./cliente-geranet";

function erroRede(code: string, name = "Error") {
  const error = new Error(code);
  error.name = name;
  (error as Error & { code?: string }).code = code;
  return error;
}

test("timeout/AbortError depois do POST vai para aguardando_reconciliacao e não retransmite", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";

  assert.equal(transmissaoPodeTerSaidoDoErro(abort), true);

  const persistencia = persistenciaFalhaComunicacaoEmitir(abort);
  assert.equal(persistencia.status, "aguardando_reconciliacao");
  assert.equal(persistencia.retransmitir, false);
  assert.equal(persistencia.classificacaoResumo, "erro_tecnico");
  assert.match(persistencia.motivo, /Timeout/i);
});

test("ECONNRESET depois da transmissão iniciada bloqueia retransmissão", () => {
  const persistencia = persistenciaFalhaComunicacaoEmitir(
    erroRede("ECONNRESET")
  );
  assert.equal(persistencia.status, "aguardando_reconciliacao");
  assert.equal(persistencia.retransmitir, false);
  assert.equal(persistencia.classificacaoResumo, "erro_tecnico");
});

test("ECONNREFUSED/ENOTFOUND antes de alcançar a Geranet permanece retransmitível", () => {
  const recusado = persistenciaFalhaComunicacaoEmitir(
    erroRede("ECONNREFUSED")
  );
  assert.equal(recusado.status, "erro_comunicacao");
  assert.equal(recusado.retransmitir, true);
  assert.equal(recusado.classificacaoResumo, "erro_envio");

  const dns = persistenciaFalhaComunicacaoEmitir(erroRede("ENOTFOUND"));
  assert.equal(dns.status, "erro_comunicacao");
  assert.equal(dns.retransmitir, true);
  assert.equal(dns.classificacaoResumo, "erro_envio");
});

test("diagnóstico Geranet resume XML/PDF e não guarda blob nem segredo", () => {
  const diagnostico = montarDiagnosticoRespostaGeranet({
    dados: {
      situacao: "erro",
      mensagem:
        "Não foi possível processar a solicitação. Confira os dados informados e tente novamente.",
      cstat: null,
      chave: null,
      protocolo: null,
      xml: "conteúdo omitido; consulte os anexos do log quando disponíveis",
      pdf: "%PDF-1.4 enorme".repeat(20),
      certificadoDigital: "MIIFake",
      senhaCertificadoDigital: "segredo",
      codigoValidacao: "X1",
    },
    httpStatus: 422,
    endpoint: "/api/v1/nfe/emitir",
    timestamp: "2026-08-19T12:00:00.000Z",
  });

  assert.equal(diagnostico.situacao, "erro");
  assert.equal(diagnostico.httpStatus, 422);
  assert.equal(diagnostico.endpoint, "/api/v1/nfe/emitir");
  assert.equal(
    (diagnostico.xml as { presente: boolean; tamanho: number }).presente,
    true
  );
  assert.equal(
    typeof (diagnostico.xml as { tamanho: number }).tamanho,
    "number"
  );
  const json = JSON.stringify(diagnostico);
  assert.doesNotMatch(json, /MIIFake/);
  assert.doesNotMatch(json, /segredo/);
  assert.doesNotMatch(json, /%PDF-1\.4 enorme/);
  assert.doesNotMatch(json, /conteúdo omitido/);
});
