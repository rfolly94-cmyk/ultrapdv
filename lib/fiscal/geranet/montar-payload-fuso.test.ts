import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import {
  MENSAGEM_FUSO_CONTRATO_AUSENTE,
  resolverOffsetFiscal,
} from "./data-hora";
import {
  montarPayloadNfeGeranet,
  ocultarSegredosPayloadNfe,
} from "./montar-payload-nfe";
import { montarPayloadNfceGeranet } from "./montar-payload-nfce";
import { exigirFusoHorarioFiscalDaEmissao } from "@/lib/fiscal/fuso-horario-empresa";

const DATA_EMISSAO = "2026-08-18 14:00:00";
const INSTANTE = new Date("2026-08-18T18:00:00.000Z");

function emitente() {
  return {
    cnpj: "42741754000142",
    inscricaoEstadual: "138856729",
    razaoSocial: "EMPRESA TESTE",
    nomeFantasia: "TESTE",
    logradouro: "Rua A",
    numero: "1",
    bairro: "Centro",
    municipio: "Cuiaba",
    codigoMunicipio: "5103403",
    uf: "MT",
    cep: "78000000",
    codigoRegimeTributario: 1,
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

function payloadNfe(iana: string) {
  return montarPayloadNfeGeranet({
    ambiente: "2",
    ufEmitente: "MT",
    certificadoDigital: "CERT-SECRETO-A1",
    senhaCertificadoDigital: "SENHA-SECRETA",
    emitente: emitente(),
    destinatario: destinatario(),
    config: {
      serie: 1,
      numeroNota: 1,
      codigoNumerico: "12345678",
      dataSaida: DATA_EMISSAO,
      dataEmissao: DATA_EMISSAO,
      fusoHorario: iana,
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      tipo: "1",
      finalidade: "1",
    },
    pagamento: {
      troco: 0,
      detalhamento: [
        { tipo: "01", valor: 10, indicadorPagamento: "0" },
      ],
    },
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  });
}

test("resolverOffsetFiscal: Cuiaba e Sao Paulo na mesma data", () => {
  assert.equal(
    resolverOffsetFiscal("America/Cuiaba", INSTANTE),
    "-04:00"
  );
  assert.equal(
    resolverOffsetFiscal("America/Sao_Paulo", INSTANTE),
    "-03:00"
  );
});

test("payload NF-e 55: A recebe offset de Cuiaba e B o de Sao Paulo", () => {
  const fiscalA = {
    empresa_id: empresaA,
    fuso_horario: "America/Cuiaba",
  };
  const fiscalB = {
    empresa_id: empresaB,
    fuso_horario: "America/Sao_Paulo",
  };

  const ianaA = exigirFusoHorarioFiscalDaEmissao({
    empresaIdDaEmissao: empresaA,
    fiscal: fiscalA,
  });
  const ianaB = exigirFusoHorarioFiscalDaEmissao({
    empresaIdDaEmissao: empresaB,
    fiscal: fiscalB,
  });

  const payloadA = payloadNfe(ianaA);
  const payloadB = payloadNfe(ianaB);

  assert.equal(payloadA.nfe.fusoHorario, "-04:00");
  assert.equal(payloadB.nfe.fusoHorario, "-03:00");
  assert.notEqual(payloadA.nfe.fusoHorario, ianaA);
  assert.notEqual(payloadB.nfe.fusoHorario, ianaB);
  assert.equal(payloadA.nfe.dataEmissao, DATA_EMISSAO);
  assert.equal(payloadA.nfe.dataSaida, DATA_EMISSAO);
});

test("payload NFC-e 65 também envia offset Geranet", () => {
  const payload = montarPayloadNfceGeranet({
    emitente: {
      ...emitente(),
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
      dataEmissao: DATA_EMISSAO,
      dataSaida: DATA_EMISSAO,
      fusoHorario: "America/Cuiaba",
    },
    segredos: {
      certificado_a1: "CERT-SECRETO-A1",
      senha_certificado: "SENHA-SECRETA",
      csc: "CSC-SECRETO",
    },
    item: { ncmProduto: "85171231", icmsCsosn: "102" } as never,
    pagamento: { tipo: "01", valor: 10, indicadorPagamento: "0" },
    codigoNumerico: "12345678",
  });

  assert.equal(payload.nfe.fusoHorario, "-04:00");
});

test("fuso IANA vazio bloqueia antes de montar o contrato Geranet", () => {
  assert.throws(
    () => resolverOffsetFiscal("", INSTANTE),
    { message: MENSAGEM_FUSO_CONTRATO_AUSENTE }
  );
  assert.throws(
    () => payloadNfe(""),
    { message: MENSAGEM_FUSO_CONTRATO_AUSENTE }
  );
});

test("segredos do payload NF-e são redigidos na apresentação", () => {
  const limpo = ocultarSegredosPayloadNfe(payloadNfe("America/Cuiaba"));
  assert.equal(limpo.certificadoDigital, "[REDACTED]");
  assert.equal(limpo.senhaCertificadoDigital, "[REDACTED]");
  assert.equal(limpo.nfe.fusoHorario, "-04:00");
});
