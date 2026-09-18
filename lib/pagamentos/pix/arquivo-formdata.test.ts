import assert from "node:assert/strict";
import { test } from "node:test";

import { ehArquivoUpload, metaArquivoFormData } from "./arquivo-formdata";

test("instanceof File sozinho descartaria upload duck-typed válido", () => {
  const valor = {
    name: "c6.crt",
    size: 2048,
    type: "application/x-x509-ca-cert",
    arrayBuffer: async () => new ArrayBuffer(2048),
  };

  assert.equal(valor instanceof File, false);
  assert.equal(ehArquivoUpload(valor), true);
  assert.equal(metaArquivoFormData(valor).duckTypeValido, true);
  assert.equal(metaArquivoFormData(valor).instanceofFile, false);
});

test("File real é válido por duck type e instanceof", () => {
  const arquivo = new File(["pem"], "c6.crt", {
    type: "application/x-x509-ca-cert",
  });
  assert.equal(arquivo instanceof File, true);
  assert.equal(ehArquivoUpload(arquivo), true);
  assert.equal(metaArquivoFormData(arquivo).constructorName, "File");
  assert.equal(metaArquivoFormData(arquivo).size, 3);
});

test("objeto sem arrayBuffer não é upload válido", () => {
  const semBuffer = { name: "c6.crt", size: 2048 };
  assert.equal(ehArquivoUpload(semBuffer), false);
  assert.equal(metaArquivoFormData(semBuffer).temArrayBuffer, false);
  assert.equal(metaArquivoFormData(semBuffer).duckTypeValido, false);
});

test("Blob com size e arrayBuffer é upload válido sem ser File", () => {
  const blob = new Blob(["pem-certificado"], { type: "application/pkix-cert" });
  assert.equal(blob instanceof File, false);
  assert.equal(ehArquivoUpload(blob), true);
  assert.equal(metaArquivoFormData(blob).temArrayBuffer, true);
});

test("File vazio e string não são upload válido", () => {
  const vazio = new File([], "c6.crt");
  assert.equal(ehArquivoUpload(vazio), false);
  assert.equal(ehArquivoUpload(""), false);
  assert.equal(ehArquivoUpload(null), false);
  assert.equal(metaArquivoFormData(null).existe, false);
  assert.equal(metaArquivoFormData(vazio).existe, true);
  assert.equal(metaArquivoFormData(vazio).duckTypeValido, false);
});

test("Proxy sem 'arrayBuffer' in valor ainda é upload válido por typeof", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const proxy = new Proxy(
    { size: bytes.byteLength },
    {
      get(alvo, prop) {
        if (prop === "arrayBuffer") {
          return async () => bytes.buffer;
        }
        return (alvo as Record<string, unknown>)[prop as string];
      },
      has(_alvo, prop) {
        return prop === "size";
      },
    }
  );

  assert.equal("arrayBuffer" in proxy, false);
  assert.equal(typeof (proxy as { arrayBuffer?: unknown }).arrayBuffer, "function");
  assert.equal(ehArquivoUpload(proxy), true);
});


