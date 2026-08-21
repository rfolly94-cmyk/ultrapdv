import assert from "node:assert/strict";
import { test } from "node:test";

import {
  persistenciaFalhaComunicacaoEmitir,
  transmissaoPodeTerSaidoDoErro,
  montarDiagnosticoRespostaGeranet,
  montarLogRespostaGeranet,
} from "./cliente-geranet";
import { fonte } from "@/lib/multiempresa/fonte";

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

test("log sanitizado da resposta Geranet guarda mensagem/cStat/erros e omite segredos", () => {
  const log = montarLogRespostaGeranet({
    dados: {
      situacao: "erro",
      mensagem: "Rejeicao: CSC invalido para o emitente",
      cStat: "401",
      numero: "26",
      xml: "<nfeProc>conteudo enorme</nfeProc>",
      pdf: "%PDF-1.4 secreto",
      erros: [{ campo: "nfe.infNFe.ide.cUF", mensagem: "valor invalido" }],
      codigoValidacao: "X1",
      certificadoDigital: "MIIFakePFX",
      senhaCertificadoDigital: "senha-secreta",
      csc: "123456",
      codigoSegurancaContribuinte: "csc-secreto",
    },
    httpStatus: 422,
    httpOk: false,
    endpoint: "/api/v1/nfe/emitir",
    contexto: {
      emissao_id: "emissao-26",
      modelo: "65",
    },
  });

  assert.equal(log.httpStatus, 422);
  assert.equal(log.httpOk, false);
  assert.equal(log.emissao_id, "emissao-26");
  assert.equal(log.modelo, "65");
  assert.equal(log.endpoint, "/api/v1/nfe/emitir");
  assert.equal(log.situacao, "erro");
  assert.equal(log.mensagem, "Rejeicao: CSC invalido para o emitente");
  assert.equal(log.cstat, "401");
  assert.equal(log.numero, "26");
  assert.equal(log.xml_disponivel, true);
  assert.equal(log.pdf_disponivel, true);
  assert.deepEqual(log.erros, [
    { campo: "nfe.infNFe.ide.cUF", mensagem: "valor invalido" },
  ]);
  assert.equal(
    (log.extras as Record<string, unknown>).codigoValidacao,
    "X1"
  );
  assert.ok((log.chaves_body as string[]).includes("situacao"));
  assert.equal((log.chaves_body as string[]).includes("certificadoDigital"), false);
  assert.equal((log.chaves_body as string[]).includes("csc"), false);

  const json = JSON.stringify(log);
  assert.doesNotMatch(json, /MIIFakePFX/);
  assert.doesNotMatch(json, /senha-secreta/);
  assert.doesNotMatch(json, /csc-secreto/);
  assert.doesNotMatch(json, /nfeProc/);
  assert.doesNotMatch(json, /%PDF-1\.4/);
  assert.doesNotMatch(json, /certificadoDigital/);
  assert.doesNotMatch(json, /senhaCertificadoDigital/);
  assert.doesNotMatch(json, /codigoSegurancaContribuinte/);
});

test("chamarGeranet registra a resposta depois de ler o body e nao loga o payload", () => {
  const cliente = fonte("lib/fiscal/geranet/cliente-geranet.ts");
  const inicioChamada = cliente.indexOf("export async function chamarGeranet");
  const trecho = cliente.slice(inicioChamada, cliente.indexOf("const ROTAS_GET_PERMITIDAS"));
  const posicaoLeitura = trecho.indexOf("await lerJsonSeguro");
  const posicaoLog = trecho.indexOf("registrarLogRespostaGeranet");
  assert.ok(inicioChamada > 0);
  assert.ok(posicaoLeitura > 0);
  assert.ok(posicaoLog > posicaoLeitura);
  assert.match(cliente, /\[fiscal\] geranet-resposta/);
  assert.doesNotMatch(
    cliente,
    /console\.(info|log|warn)\([^\n]*JSON\.stringify\(\s*payload/
  );
});
