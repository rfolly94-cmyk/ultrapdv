import assert from "node:assert/strict";
import { test } from "node:test";

import { paraHex } from "./documento-fiscal";
import { resolverDocumentoFiscal } from "./obter-documento-fiscal";

const xmlAutorizado = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe5126"></infNFe></NFe></nfeProc>`;
const xmlEvento = `<?xml version="1.0"?><procEventoNFe><infEvento>cancelamento</infEvento></procEventoNFe>`;
const pdfBuffer = Buffer.from("%PDF-1.4 recuperado");
const xmlHex = paraHex(Buffer.from(xmlAutorizado, "utf8"));
const pdfHex = paraHex(pdfBuffer);
const eventoHex = paraHex(Buffer.from(xmlEvento, "utf8"));

async function resolver(
  parcial: Parameters<typeof resolverDocumentoFiscal>[0]
) {
  return resolverDocumentoFiscal(parcial);
}

test("A. autorizada com pdf_hex abre local e não chama Geranet", async () => {
  let anexos = 0;
  let geracoes = 0;
  const persistidos: Record<string, string>[] = [];

  const resultado = await resolver({
    status: "autorizada",
    modelo: "65",
    xmlHex,
    pdfHex,
    tipo: "pdf",
    recuperarAnexos: async () => {
      anexos += 1;
      return { xml: null, pdf: null };
    },
    gerarPdf: async () => {
      geracoes += 1;
      return pdfBuffer;
    },
    persistir: async (patch) => {
      persistidos.push(patch);
    },
  });

  assert.equal(resultado.fonte, "local");
  assert.equal(resultado.geranetChamado, false);
  assert.equal(anexos, 0);
  assert.equal(geracoes, 0);
  assert.equal(persistidos.length, 0);
  assert.equal(resultado.buffer.equals(pdfBuffer), true);
});

test("B. autorizada sem PDF, com XML: chama gerar-pdf, salva e abre", async () => {
  let anexos = 0;
  let geracoes = 0;
  const persistidos: Record<string, string>[] = [];

  const resultado = await resolver({
    status: "autorizada",
    modelo: "55",
    xmlHex,
    pdfHex: "",
    tipo: "pdf",
    recuperarAnexos: async () => {
      anexos += 1;
      return { xml: null, pdf: null };
    },
    gerarPdf: async (xml) => {
      geracoes += 1;
      assert.match(xml.toString("utf8"), /nfeProc/);
      return pdfBuffer;
    },
    persistir: async (patch) => {
      persistidos.push(patch);
    },
  });

  assert.equal(resultado.fonte, "gerar-pdf");
  assert.equal(resultado.geranetChamado, true);
  assert.equal(anexos, 0);
  assert.equal(geracoes, 1);
  assert.deepEqual(persistidos, [{ pdf_hex: pdfHex }]);
});

test("C. sem XML/PDF local, log possui PDF: recupera anexo e não gera", async () => {
  let geracoes = 0;
  const persistidos: Record<string, string>[] = [];

  const resultado = await resolver({
    status: "autorizada",
    modelo: "65",
    xmlHex: "",
    pdfHex: "",
    tipo: "pdf",
    recuperarAnexos: async () => ({ xml: null, pdf: pdfHex }),
    gerarPdf: async () => {
      geracoes += 1;
      return pdfBuffer;
    },
    persistir: async (patch) => {
      persistidos.push(patch);
    },
  });

  assert.equal(resultado.fonte, "anexo");
  assert.equal(geracoes, 0);
  assert.equal(persistidos[0]?.pdf_hex, pdfHex);
});

test("D. sem arquivos locais, log possui somente XML: recupera, gera PDF e salva os dois", async () => {
  const persistidos: Record<string, string>[] = [];

  const resultado = await resolver({
    status: "autorizada",
    modelo: "65",
    xmlHex: "",
    pdfHex: "",
    tipo: "pdf",
    recuperarAnexos: async () => ({ xml: xmlHex, pdf: null }),
    gerarPdf: async () => pdfBuffer,
    persistir: async (patch) => {
      persistidos.push(patch);
    },
  });

  assert.equal(resultado.fonte, "gerar-pdf");
  assert.deepEqual(persistidos, [
    { xml_hex: xmlHex },
    { pdf_hex: pdfHex },
  ]);
});

test("E. sem arquivos locais e Geranet sem anexo: erro controlado, sem gerar nota", async () => {
  let geracoes = 0;

  await assert.rejects(
    () =>
      resolver({
        status: "autorizada",
        modelo: "55",
        xmlHex: "",
        pdfHex: "",
        tipo: "pdf",
        recuperarAnexos: async () => ({ xml: null, pdf: null }),
        gerarPdf: async () => {
          geracoes += 1;
          return pdfBuffer;
        },
        persistir: async () => {},
      }),
    /XML autorizado também não está disponível/
  );

  assert.equal(geracoes, 0);
});

test("F. rejeitada não gera DANFE mesmo com arquivos", async () => {
  let anexos = 0;
  let geracoes = 0;

  await assert.rejects(
    () =>
      resolver({
        status: "rejeitada",
        modelo: "65",
        xmlHex,
        pdfHex,
        tipo: "pdf",
        recuperarAnexos: async () => {
          anexos += 1;
          return { xml: xmlHex, pdf: pdfHex };
        },
        gerarPdf: async () => {
          geracoes += 1;
          return pdfBuffer;
        },
        persistir: async () => {},
      }),
    /documento rejeitado/
  );

  assert.equal(anexos, 0);
  assert.equal(geracoes, 0);
});

test("G. cancelada abre DANFE da nota original e ignora XML de evento", async () => {
  const persistidos: Record<string, string>[] = [];

  const resultado = await resolver({
    status: "cancelada",
    modelo: "55",
    xmlHex: eventoHex,
    pdfHex: "",
    tipo: "pdf",
    recuperarAnexos: async () => ({ xml: xmlHex, pdf: null }),
    gerarPdf: async (xml) => {
      assert.match(xml.toString("utf8"), /nfeProc/);
      assert.doesNotMatch(xml.toString("utf8"), /procEventoNFe/);
      return pdfBuffer;
    },
    persistir: async (patch) => {
      persistidos.push(patch);
    },
  });

  assert.equal(resultado.fonte, "gerar-pdf");
  assert.deepEqual(persistidos, [
    { xml_hex: xmlHex },
    { pdf_hex: pdfHex },
  ]);
});

test("H. segunda abertura após recuperação usa banco e não chama Geranet", async () => {
  let anexos = 0;
  let geracoes = 0;

  const resultado = await resolver({
    status: "autorizada",
    modelo: "65",
    xmlHex,
    pdfHex,
    tipo: "pdf",
    recuperarAnexos: async () => {
      anexos += 1;
      return { xml: null, pdf: null };
    },
    gerarPdf: async () => {
      geracoes += 1;
      return pdfBuffer;
    },
    persistir: async () => {},
  });

  assert.equal(resultado.fonte, "local");
  assert.equal(resultado.geranetChamado, false);
  assert.equal(anexos, 0);
  assert.equal(geracoes, 0);
});

test("XML local autorizado é baixado sem Geranet", async () => {
  let anexos = 0;

  const resultado = await resolver({
    status: "autorizada",
    modelo: "65",
    xmlHex,
    pdfHex: "",
    tipo: "xml",
    recuperarAnexos: async () => {
      anexos += 1;
      return { xml: null, pdf: null };
    },
    gerarPdf: async () => pdfBuffer,
    persistir: async () => {},
  });

  assert.equal(resultado.fonte, "local");
  assert.equal(anexos, 0);
});

test("XML ausente é recuperado do anexo e persistido", async () => {
  const persistidos: Record<string, string>[] = [];

  const resultado = await resolver({
    status: "cancelada",
    modelo: "55",
    xmlHex: "",
    pdfHex: "",
    tipo: "xml",
    recuperarAnexos: async () => ({ xml: xmlHex, pdf: pdfHex }),
    gerarPdf: async () => pdfBuffer,
    persistir: async (patch) => {
      persistidos.push(patch);
    },
  });

  assert.equal(resultado.fonte, "anexo");
  assert.deepEqual(persistidos, [{ xml_hex: xmlHex }]);
});
