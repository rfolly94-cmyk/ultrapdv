import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { diagnosticarBibliotecaPayGo, GerenciadorTefNativo } from "./tef.mjs";
import { assinarBibliotecaTef, verificarBibliotecaTef } from "./tef-prova.mjs";

const PRODUCAO = {
  pontoSolicitado: "6696546",
  servidorSolicitado: "pos-transac.pgweb.io:31735",
  ambienteSolicitado: "producao",
  bibliotecaInstalada: false,
  setEnvironmentExecutado: true,
  retornoSetEnvironment: 0,
  codigoAmbiente: 0,
  instalacaoConcluida: true,
  diretorioBiblioteca: "producao",
};

test("diagnóstico bloqueia biblioteca ausente, sandbox e ponto já instalado", () => {
  assert.equal(diagnosticarBibliotecaPayGo(null).cobrancaPermitida, false);
  assert.equal(
    diagnosticarBibliotecaPayGo({
      ...PRODUCAO,
      servidorSolicitado: "pos-transac-sb.tpgweb.io:31735",
    }).cobrancaPermitida,
    false
  );
  assert.equal(
    diagnosticarBibliotecaPayGo({
      ...PRODUCAO,
      pontoSolicitado: "117473",
      bibliotecaInstalada: true,
      setEnvironmentExecutado: false,
      instalacaoConcluida: false,
    }).cobrancaPermitida,
    false
  );
  assert.equal(diagnosticarBibliotecaPayGo(PRODUCAO).cobrancaPermitida, true);
  assert.equal(diagnosticarBibliotecaPayGo(PRODUCAO).origemComprovacao, "set_environment");
});

test("instalação assinada libera a cobrança sem repetir PW_iSetEnvironment", () => {
  const par = generateKeyPairSync("ed25519");
  const privada = par.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publica = par.publicKey.export({ type: "spki", format: "pem" }).toString();
  const campos = {
    pontoCaptura: "6696546",
    servidor: "pos-transac.pgweb.io:31735",
    ambiente: "producao",
    retornoSetEnvironment: 0,
    codigoAmbiente: 0,
    diretorio: "producao",
  };
  const assinatura = assinarBibliotecaTef(privada, campos);
  assert.equal(verificarBibliotecaTef(publica, campos, assinatura), true);
  assert.equal(
    verificarBibliotecaTef(publica, { ...campos, servidor: "pos-transac-sb.tpgweb.io:31735" }, assinatura),
    false
  );
  const liberado = diagnosticarBibliotecaPayGo({
    ...PRODUCAO,
    bibliotecaInstalada: true,
    setEnvironmentExecutado: false,
    instalacaoConcluida: false,
    retornoSetEnvironment: -999,
    evidenciaConfirmada: true,
  });
  assert.equal(liberado.cobrancaPermitida, true);
  assert.equal(liberado.origemComprovacao, "instalacao_assinada");
});

test("a consulta da prova lê somente o arquivo público", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const pasta = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-prova-"));
  const par = generateKeyPairSync("ed25519");
  const privada = par.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const campos = {
    pontoCaptura: "200001",
    servidor: "tef.loja.example:31735",
    ambiente: "producao",
    retornoSetEnvironment: 0,
    codigoAmbiente: 0,
    diretorio: "producao",
  };
  const assinatura = assinarBibliotecaTef(privada, campos);
  const arquivo = path.join(pasta, "tef-biblioteca.json");
  await writeFile(arquivo, JSON.stringify({ versao: 2, campos, assinatura, privada }));
  await writeFile(path.join(pasta, "tef-chave.json"), JSON.stringify({ privada }));
  const gerenciador = new GerenciadorTefNativo({
    arquivoPendencia: path.join(pasta, "tef-pendencia.json"),
    arquivoBiblioteca: arquivo,
    arquivoChave: path.join(pasta, "tef-chave.json"),
  });
  const lido = await gerenciador.lerEvidenciaBiblioteca();
  const texto = JSON.stringify(lido);
  assert.equal(lido.ok, true);
  assert.equal(lido.campos.pontoCaptura, campos.pontoCaptura);
  assert.equal(texto.includes("PRIVATE KEY"), false);
  assert.equal(texto.includes(privada), false);
  const ausente = new GerenciadorTefNativo({
    arquivoPendencia: path.join(pasta, "tef-pendencia.json"),
    arquivoBiblioteca: path.join(pasta, "ausente.json"),
  });
  const falta = await ausente.lerEvidenciaBiblioteca();
  assert.equal(falta.erro, "A prova assinada da biblioteca não está neste computador.");
  await rm(pasta, { recursive: true, force: true });
});
