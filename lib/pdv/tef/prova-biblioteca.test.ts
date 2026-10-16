import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import {
  decidirValidacaoBiblioteca,
  mensagemProvaBibliotecaV2,
  type CamposProvaBibliotecaV2,
} from "@/lib/pdv/tef/prova-biblioteca";

const terminal = "33333333-3333-4333-8333-333333333333";
const dispositivo = "44444444-4444-4444-8444-444444444444";
const outroDispositivo = "55555555-5555-4555-8555-555555555555";

const par = generateKeyPairSync("ed25519");
const publica = par.publicKey.export({ type: "spki", format: "pem" }).toString();

function campos(parcial: Partial<CamposProvaBibliotecaV2> = {}): CamposProvaBibliotecaV2 {
  return {
    pontoCaptura: "200001",
    servidor: "tef.loja.example:31735",
    ambiente: "producao",
    retornoSetEnvironment: 0,
    codigoAmbiente: 0,
    diretorio: "producao",
    ...parcial,
  };
}

function assinar(valor: CamposProvaBibliotecaV2, chave = par.privateKey) {
  return sign(null, Buffer.from(mensagemProvaBibliotecaV2(valor)), chave).toString("base64");
}

function entrada(parcial: Record<string, unknown> = {}) {
  const atuais = campos();
  return {
    versao: 2,
    campos: atuais,
    assinatura: assinar(atuais),
    chavePublicaPem: publica,
    empresaSessaoId: empresaA,
    dispositivoInformado: dispositivo,
    terminal: { id: terminal, empresaId: empresaA, dispositivoId: dispositivo },
    dispositivoEmOutraEmpresa: false,
    pontoOficial: "200001",
    servidorOficial: "tef.loja.example:31735",
    ambienteOficial: "producao" as const,
    registroExistente: null,
    ...parcial,
  };
}

test("a mensagem v2 é a mesma do Connector e não inclui empresa nem dispositivo", async () => {
  const { mensagemBibliotecaTef } = await import("../../../print-agent/src/tef-prova.mjs");
  const valor = campos();
  assert.equal(mensagemProvaBibliotecaV2(valor), mensagemBibliotecaTef(valor));
  assert.equal(mensagemProvaBibliotecaV2(valor).includes(empresaA), false);
  assert.equal(mensagemProvaBibliotecaV2(valor).includes(dispositivo), false);
});

test("assinatura válida registra a prova sem liberar cobrança nem NFC-e", () => {
  const decisao = decidirValidacaoBiblioteca(entrada());
  assert.equal(decisao.efeito, "registrar");
  assert.equal(decisao.instalacaoTecnica, "comprovada");
  assert.equal(decisao.ambienteBiblioteca, "configurado");
  assert.equal(decisao.adquirente, "desconhecida");
  assert.equal(decisao.cobrancaLiberada, false);
  assert.equal(decisao.nfceLiberada, false);
});

test("assinatura adulterada é recusada", () => {
  const base = entrada();
  const decisao = decidirValidacaoBiblioteca({
    ...base,
    assinatura: `${base.assinatura.slice(0, -4)}AAAA`,
  });
  assert.equal(decisao.efeito, "recusar");
  assert.match(decisao.motivo, /assinatura/);
});

test("dispositivo de outra empresa não usa a chave desta sessão", () => {
  const decisao = decidirValidacaoBiblioteca(
    entrada({
      dispositivoEmOutraEmpresa: true,
      empresaSessaoId: empresaB,
      terminal: { id: terminal, empresaId: empresaA, dispositivoId: dispositivo },
    })
  );
  assert.equal(decisao.efeito, "recusar");
  assert.match(decisao.motivo, /outra empresa/);
});

test("outro dispositivo é recusado porque a assinatura v2 não o identifica", () => {
  const decisao = decidirValidacaoBiblioteca(entrada({ dispositivoInformado: outroDispositivo }));
  assert.equal(decisao.efeito, "recusar");
  assert.match(decisao.motivo, /outro computador/);
});

test("ponto divergente é recusado depois da assinatura válida", () => {
  const decisao = decidirValidacaoBiblioteca(entrada({ pontoOficial: "200002" }));
  assert.equal(decisao.efeito, "recusar");
  assert.equal(decisao.ambienteBiblioteca, "divergente");
  assert.match(decisao.motivo, /ponto/);
});

test("host divergente e host de homologação são recusados", () => {
  const oficial = decidirValidacaoBiblioteca(entrada({ servidorOficial: "outro.loja.example:31735" }));
  assert.match(oficial.motivo, /servidor/);
  const sandbox = campos({ servidor: "pos-transac-sb.tpgweb.io:31735" });
  const homologacao = decidirValidacaoBiblioteca(
    entrada({ campos: sandbox, assinatura: assinar(sandbox), servidorOficial: sandbox.servidor })
  );
  assert.match(homologacao.motivo, /homologação/);
});

test("prova antiga e prova ausente não viram evidência nova", () => {
  assert.match(decidirValidacaoBiblioteca(entrada({ versao: 1 })).motivo, /versão 2/);
  assert.match(decidirValidacaoBiblioteca(entrada({ assinatura: "" })).motivo, /não foi apresentada/);
});

test("a mesma prova é idempotente e outra prova não substitui o registro", () => {
  const base = entrada();
  const repetida = decidirValidacaoBiblioteca(
    entrada({
      registroExistente: {
        assinaturaSha256: decidirValidacaoBiblioteca(base).assinaturaSha256,
        terminalId: terminal,
        empresaId: empresaA,
      },
    })
  );
  assert.equal(repetida.efeito, "ja_registrada");
  const outros = campos({ pontoCaptura: "200001", diretorio: "producao" });
  const substituicao = decidirValidacaoBiblioteca(
    entrada({
      campos: outros,
      assinatura: assinar(outros),
      registroExistente: {
        assinaturaSha256: "a".repeat(64),
        terminalId: terminal,
        empresaId: empresaA,
      },
    })
  );
  assert.equal(substituicao.efeito, "recusar");
  assert.match(substituicao.motivo, /não substitui/);
});

test("a validação não grava evidência v1 nem reinstala a biblioteca", () => {
  const sessao = readFileSync(new URL("./prova-biblioteca-sessao.ts", import.meta.url), "utf8");
  const assistente = readFileSync(new URL("../../../components/pdv/tef-assistente.tsx", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../../supabase/migrations/20261013180000_tef_validacao_biblioteca.sql", import.meta.url),
    "utf8"
  );
  assert.equal(sessao.includes("tef_evidencias_instalacao"), false);
  assert.equal(sessao.includes("/tef/instalar"), false);
  assert.match(assistente, /\/tef\/biblioteca\/evidencia/);
  assert.match(migration, /Não aplicar automaticamente/);
  assert.match(migration, /Não libera cobrança/);
});
