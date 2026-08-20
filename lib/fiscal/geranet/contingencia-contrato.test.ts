import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import {
  aplicarContingenciaContratoGeranet,
  type NfeComContingenciaGeranet,
} from "./contingencia-contrato";
import { montarPayloadNfeGeranet } from "./montar-payload-nfe";
import { montarPayloadNfceGeranet } from "./montar-payload-nfce";

const DATA = "2026-08-18 14:00:00";

function emitente(cnpj: string) {
  return {
    cnpj,
    inscricaoEstadual: "13.885.672-9",
    razaoSocial: "EMPRESA TESTE",
    nomeFantasia: "TESTE",
    logradouro: "Rua A",
    numero: "1",
    bairro: "Centro",
    municipio: "Cuiaba",
    codigoMunicipio: "5103403",
    uf: "MT",
    cep: "78000000",
    codigoRegimeTributario: 1 as const,
  };
}

function destinatario() {
  return {
    cpf: "52998224725",
    consumidorFinal: "1" as const,
    indicadorIEdestinatario: "9" as const,
    logradouro: "Rua B",
    numero: "2",
    bairro: "Centro",
    municipio: "Cuiaba",
    codigoMunicipio: "5103403",
    uf: "MT",
    cep: "78000000",
  };
}

function payloadNfe(cnpj: string) {
  return montarPayloadNfeGeranet({
    ambiente: "2",
    ufEmitente: "MT",
    certificadoDigital: "CERT-A",
    senhaCertificadoDigital: "SENHA-A",
    emitente: emitente(cnpj),
    destinatario: destinatario(),
    config: {
      serie: 1,
      numeroNota: 102,
      codigoNumerico: "33620618",
      dataSaida: DATA,
      dataEmissao: DATA,
      fusoHorario: "America/Cuiaba",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      tipo: "1",
      finalidade: "1",
    },
    pagamento: {
      troco: 0,
      detalhamento: [
        { tipo: "01", valor: 55, indicadorPagamento: "0" },
      ],
    },
    itens: [{ ncmProduto: "85299020", icmsCsosn: "500" }],
  });
}

test("NF-e 55: contingencia no nfe, nunca em empresa", () => {
  const payload = payloadNfe("42741754000142");
  assert.equal(payload.nfe.contingencia, "nao");
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.nfe.empresa, "contingencia"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.nfe, "justificativaContingencia"),
    false
  );
});

test("NFC-e 65 normal: contingencia no nfe, nunca em empresa", () => {
  const payload = montarPayloadNfceGeranet({
    emitente: {
      ...emitente("42741754000142"),
      nomeFantasia: "TESTE",
      codigoRegimeTributario: 1,
    },
    config: {
      ambiente: "2",
      serie: 1,
      numeroNota: 1,
      idCsc: "1",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      dataEmissao: DATA,
      dataSaida: DATA,
      fusoHorario: "America/Cuiaba",
    },
    segredos: {
      certificado_a1: "CERT-A",
      senha_certificado: "SENHA-A",
      csc: "CSC-A",
    },
    item: { ncmProduto: "85299020", icmsCsosn: "500" } as never,
    pagamento: { tipo: "01", valor: 55, indicadorPagamento: "0" },
    codigoNumerico: "33620618",
  });

  assert.equal(payload.nfe.contingencia, "nao");
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.nfe.empresa, "contingencia"),
    false
  );
});

test("NFC-e offline: sim + justificativa, sem chave em empresa", () => {
  const nfe: NfeComContingenciaGeranet = {
    empresa: { contingencia: "nao", cnpj: "42741754000142" },
    contingencia: "nao",
  };
  aplicarContingenciaContratoGeranet(
    nfe,
    "sim",
    "Indisponibilidade temporaria de comunicacao com a SEFAZ"
  );
  assert.equal(nfe.contingencia, "sim");
  assert.equal(
    nfe.justificativaContingencia,
    "Indisponibilidade temporaria de comunicacao com a SEFAZ"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(nfe.empresa, "contingencia"),
    false
  );
});

test("A×B: contingencia não cruza emitente nem CRT de outra empresa", () => {
  const payloadA = payloadNfe("11111111000191");
  const payloadB = payloadNfe("22222222000191");

  assert.equal(payloadA.nfe.empresa.cnpj, "11111111000191");
  assert.equal(payloadB.nfe.empresa.cnpj, "22222222000191");
  assert.equal(payloadA.nfe.contingencia, "nao");
  assert.equal(payloadB.nfe.contingencia, "nao");
  assert.notEqual(payloadA.nfe.empresa.cnpj, payloadB.nfe.empresa.cnpj);

  aplicarContingenciaContratoGeranet(payloadA.nfe, "sim", `offline-${empresaA}`);
  assert.equal(payloadA.nfe.contingencia, "sim");
  assert.equal(payloadB.nfe.contingencia, "nao");
  const justificativaA = String(
    (payloadA.nfe as NfeComContingenciaGeranet).justificativaContingencia
  );
  assert.match(justificativaA, new RegExp(empresaA));
  assert.doesNotMatch(justificativaA, new RegExp(empresaB));
});

test("Tentativa 2 histórica permanece com contingencia só em empresa", () => {
  const historico = {
    nfe: {
      contingencia: undefined,
      empresa: { contingencia: "nao", cnpj: "42741754000142" },
    },
  };
  assert.equal(historico.nfe.empresa.contingencia, "nao");
  assert.equal(historico.nfe.contingencia, undefined);
});

test("A. builders centrais não escrevem empresa.contingencia", () => {
  const nfe = readFileSync(
    path.join(process.cwd(), "lib/fiscal/geranet/montar-payload-nfe.ts"),
    "utf8"
  );
  const nfce = readFileSync(
    path.join(process.cwd(), "lib/fiscal/geranet/montar-payload-nfce.ts"),
    "utf8"
  );
  const avulsoNfe = readFileSync(
    path.join(process.cwd(), "app/api/fiscal/geranet/nfe-emitir/route.ts"),
    "utf8"
  );
  const avulsoNfce = readFileSync(
    path.join(process.cwd(), "app/api/fiscal/geranet/nfce-emitir/route.ts"),
    "utf8"
  );
  const offline = readFileSync(
    path.join(
      process.cwd(),
      "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts"
    ),
    "utf8"
  );

  assert.match(nfe, /aplicarContingenciaContratoGeranet\(payload\.nfe, "nao"\)/);
  assert.match(nfce, /aplicarContingenciaContratoGeranet\(payload\.nfe, "nao"\)/);
  assert.match(avulsoNfe, /aplicarContingenciaContratoGeranet\(payload\.nfe, "nao"\)/);
  assert.match(avulsoNfce, /aplicarContingenciaContratoGeranet\(payload\.nfe, "nao"\)/);
  assert.match(
    offline,
    /aplicarContingenciaContratoGeranet\(\s*payload\.nfe,\s*"sim"/
  );
  assert.equal((nfe.match(/contingencia:\s*"nao"/g) ?? []).length, 1);
  assert.equal((nfce.match(/contingencia:\s*"nao"/g) ?? []).length, 1);
});
