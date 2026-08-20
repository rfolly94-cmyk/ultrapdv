import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bufferParecePdf,
  decidirRecuperacaoPdf,
  decodificarArquivoFiscal,
  documentoPodeSerAberto,
  paraHex,
  xmlPareceAutorizado,
  xmlParaEnvioGeranet,
  extrairChaveAcessoXml,
  documentoFiscalEhPlaceholder,
  hexDocumentoFiscalPersistivel,
} from "./documento-fiscal";

const pdfHex = Buffer.from("%PDF-1.4 teste").toString("hex");
const xmlAutorizado = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe5126"></infNFe></NFe></nfeProc>`;
const xmlEvento = `<?xml version="1.0"?><procEventoNFe><infEvento>cancelamento</infEvento></procEventoNFe>`;

test("A. PDF local: usa banco e não precisa Geranet", () => {
  const plano = decidirRecuperacaoPdf({
    status: "autorizada",
    pdfLocal: true,
    xmlLocal: true,
    pdfAnexo: true,
    xmlAnexo: true,
  });

  assert.deepEqual(plano, { acao: "usar_local" });
  assert.equal(documentoPodeSerAberto("autorizada"), true);
});

test("B. sem PDF, com XML local: gerar-pdf", () => {
  const plano = decidirRecuperacaoPdf({
    status: "autorizada",
    pdfLocal: false,
    xmlLocal: true,
    pdfAnexo: false,
    xmlAnexo: false,
  });

  assert.deepEqual(plano, { acao: "gerar_pdf", xml: "local" });
});

test("C. sem arquivos locais, anexo tem PDF: usa anexo", () => {
  const plano = decidirRecuperacaoPdf({
    status: "autorizada",
    pdfLocal: false,
    xmlLocal: false,
    pdfAnexo: true,
    xmlAnexo: false,
  });

  assert.deepEqual(plano, { acao: "usar_anexo_pdf" });
});

test("D. sem arquivos locais, anexo só XML: gerar-pdf do anexo", () => {
  const plano = decidirRecuperacaoPdf({
    status: "autorizada",
    pdfLocal: false,
    xmlLocal: false,
    pdfAnexo: false,
    xmlAnexo: true,
  });

  assert.deepEqual(plano, { acao: "gerar_pdf", xml: "anexo" });
});

test("E. sem arquivos em lugar nenhum: erro controlado, sem emitir", () => {
  const plano = decidirRecuperacaoPdf({
    status: "autorizada",
    pdfLocal: false,
    xmlLocal: false,
    pdfAnexo: false,
    xmlAnexo: false,
  });

  assert.equal(plano.acao, "erro");
  if (plano.acao === "erro") {
    assert.match(plano.motivo, /XML autorizado também não está disponível/);
  }
});

test("F. rejeitada não gera DANFE", () => {
  const plano = decidirRecuperacaoPdf({
    status: "rejeitada",
    pdfLocal: true,
    xmlLocal: true,
    pdfAnexo: true,
    xmlAnexo: true,
  });

  assert.equal(plano.acao, "erro");
  if (plano.acao === "erro") {
    assert.match(plano.motivo, /rejeitado/);
  }
  assert.equal(documentoPodeSerAberto("rejeitada"), false);
});

test("G. cancelada pode abrir DANFE da nota original", () => {
  assert.equal(documentoPodeSerAberto("cancelada"), true);
  assert.equal(xmlPareceAutorizado(xmlAutorizado), true);
  assert.equal(xmlPareceAutorizado(xmlEvento), false);

  const plano = decidirRecuperacaoPdf({
    status: "cancelada",
    pdfLocal: false,
    xmlLocal: true,
    pdfAnexo: false,
    xmlAnexo: false,
  });

  assert.deepEqual(plano, { acao: "gerar_pdf", xml: "local" });
});

test("H. segunda abertura com PDF local não chama Geranet", () => {
  const plano = decidirRecuperacaoPdf({
    status: "autorizada",
    pdfLocal: true,
    xmlLocal: true,
    pdfAnexo: false,
    xmlAnexo: false,
  });

  assert.deepEqual(plano, { acao: "usar_local" });
});

test("valida PDF hexadecimal e rejeita JSON gravado como arquivo", () => {
  const pdf = decodificarArquivoFiscal(pdfHex, "pdf");
  assert.ok(pdf);
  assert.equal(bufferParecePdf(pdf), true);

  const jsonHex = Buffer.from('{"situacao":"erro"}').toString("hex");
  assert.equal(decodificarArquivoFiscal(jsonHex, "pdf"), null);
});

test("xmlParaEnvioGeranet só aceita XML autorizado", () => {
  const hex = paraHex(Buffer.from(xmlAutorizado, "utf8"));
  assert.ok(xmlParaEnvioGeranet(hex));
  assert.equal(xmlParaEnvioGeranet(paraHex(Buffer.from(xmlEvento, "utf8"))), null);
});

test("extrai chave de 44 dígitos do XML sem tratar como autorização", () => {
  const xml = `<?xml version="1.0"?><NFe><infNFe Id="NFe51260842741754000142650010000000201973762457"></infNFe></NFe>`;
  assert.equal(
    extrairChaveAcessoXml(paraHex(Buffer.from(xml, "utf8"))),
    "51260842741754000142650010000000201973762457"
  );
});

test("placeholder da Geranet não é documento fiscal persistível", () => {
  const placeholder =
    "conteúdo omitido; consulte os anexos do log quando disponíveis";
  assert.equal(documentoFiscalEhPlaceholder(placeholder), true);
  assert.equal(hexDocumentoFiscalPersistivel(placeholder, "xml"), null);
  assert.equal(hexDocumentoFiscalPersistivel(placeholder, "pdf"), null);
  assert.ok(hexDocumentoFiscalPersistivel(xmlAutorizado, "xml"));
});
