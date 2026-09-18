import assert from "node:assert/strict";
import { test } from "node:test";

import { ehArquivoUpload, metaArquivoFormData } from "../arquivo-formdata";
import { coletarNovosSegredosDoFormulario } from "../coletar-segredos";
import { mesclarSegredosProvedor } from "../credenciais";
import { formularioCredenciaisProvedor } from "../formulario-provedor";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  erroReadBackC6,
  flagsExistenciaCofreC6,
  MENSAGEM_C6_CERTIFICADO_NAO_SALVO,
  MENSAGEM_C6_CHAVE_NAO_SALVA,
  MENSAGEM_C6_CREDENCIAIS_SALVAS,
  respostaPublicaSalvarPixC6,
  salvarC6Confirmado,
  chavePixC6ParaVault,
} from "./persistencia";

const PEM_CERT = "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n";
const PEM_KEY = "-----BEGIN PRIVATE KEY-----\nY\n-----END PRIVATE KEY-----\n";

function injetarUploads(form: FormData, arquivos: Record<string, unknown>) {
  const originalGet = form.get.bind(form);
  form.get = ((nome: string) =>
    Object.prototype.hasOwnProperty.call(arquivos, nome)
      ? arquivos[nome]
      : originalGet(nome)) as FormData["get"];
  return form;
}

function uploadDuck(bytes: Buffer, nome: string) {
  return {
    name: nome,
    size: bytes.byteLength,
    type: "application/octet-stream",
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

test("1. File válido entra no coletor", async () => {
  const form = new FormData();
  form.set("certificadoPemHexadecimal", new File([PEM_CERT], "c6.crt"));
  form.set("chavePrivadaPemHexadecimal", new File([PEM_KEY], "c6.key"));
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.erro, undefined);
  assert.ok((coletado.novos.certificadoPemHexadecimal ?? "").length > 0);
  assert.ok((coletado.novos.chavePrivadaPemHexadecimal ?? "").length > 0);
});

test("2. Blob compatível com arrayBuffer é upload válido", async () => {
  const blob = new Blob([PEM_CERT], { type: "application/x-x509-ca-cert" });
  assert.equal(blob instanceof File, false);
  assert.equal(ehArquivoUpload(blob), true);

  const form = injetarUploads(new FormData(), {
    certificadoPemHexadecimal: blob,
    chavePrivadaPemHexadecimal: new Blob([PEM_KEY]),
  });
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.erro, undefined);
  assert.ok((coletado.novos.certificadoPemHexadecimal ?? "").length > 0);
  assert.ok((coletado.novos.chavePrivadaPemHexadecimal ?? "").length > 0);
});

test("3. upload válido que não é instanceof File entra em coletados.novos", async () => {
  const cert = Buffer.from(PEM_CERT);
  const chave = Buffer.from(PEM_KEY);
  const form = injetarUploads(new FormData(), {
    certificadoPemHexadecimal: uploadDuck(cert, "c6.crt"),
    chavePrivadaPemHexadecimal: uploadDuck(chave, "c6.key"),
  });
  assert.equal(form.get("certificadoPemHexadecimal") instanceof File, false);

  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.erro, undefined);
  assert.equal(
    coletado.diagnosticoArquivos.find(
      (item) => item.campo === "certificadoPemHexadecimal"
    )?.incluidoEmNovos,
    true
  );
  assert.equal(
    coletado.diagnosticoArquivos.find(
      (item) => item.campo === "chavePrivadaPemHexadecimal"
    )?.incluidoEmNovos,
    true
  );
});

test("4. size 0 não entra em coletados.novos", async () => {
  const form = new FormData();
  form.set("certificadoPemHexadecimal", new File([], "c6.crt"));
  form.set("chavePrivadaPemHexadecimal", new File([], "c6.key"));
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.novos.certificadoPemHexadecimal, undefined);
  assert.equal(coletado.novos.chavePrivadaPemHexadecimal, undefined);
  assert.equal(ehArquivoUpload(new File([], "c6.crt")), false);
  assert.equal(
    coletado.diagnosticoArquivos.find(
      (item) => item.campo === "certificadoPemHexadecimal"
    )?.motivoNaoIncluido,
    "size_zero"
  );
});

test("5. objeto sem arrayBuffer não é upload válido", async () => {
  const semBuffer = { name: "c6.crt", size: 2048 };
  assert.equal(ehArquivoUpload(semBuffer), false);
  assert.equal(metaArquivoFormData(semBuffer).temArrayBuffer, false);

  const form = injetarUploads(new FormData(), {
    certificadoPemHexadecimal: semBuffer,
    chavePrivadaPemHexadecimal: { name: "c6.key", size: 1024 },
  });
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.novos.certificadoPemHexadecimal, undefined);
  assert.equal(coletado.novos.chavePrivadaPemHexadecimal, undefined);
  assert.equal(
    coletado.diagnosticoArquivos.find(
      (item) => item.campo === "certificadoPemHexadecimal"
    )?.motivoNaoIncluido,
    "sem_array_buffer"
  );
});

test("upload com arrayBuffer só no get trap entra em coletados.novos", async () => {
  const cert = Buffer.from(PEM_CERT);
  const chave = Buffer.from(PEM_KEY);
  function proxyUpload(bytes: Buffer, nome: string) {
    return new Proxy(
      { size: bytes.byteLength, name: nome },
      {
        get(alvo, prop) {
          if (prop === "arrayBuffer") {
            return async () =>
              bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength
              );
          }
          return (alvo as Record<string, unknown>)[String(prop)];
        },
        has(_alvo, prop) {
          return prop === "size" || prop === "name";
        },
      }
    );
  }

  const certProxy = proxyUpload(cert, "c6.crt");
  assert.equal("arrayBuffer" in certProxy, false);
  assert.equal(ehArquivoUpload(certProxy), true);

  const form = injetarUploads(new FormData(), {
    certificadoPemHexadecimal: certProxy,
    chavePrivadaPemHexadecimal: proxyUpload(chave, "c6.key"),
  });
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.erro, undefined);
  assert.equal(
    coletado.diagnosticoArquivos.find(
      (item) => item.campo === "certificadoPemHexadecimal"
    )?.incluidoEmNovos,
    true
  );
  assert.equal(
    coletado.diagnosticoArquivos.find(
      (item) => item.campo === "chavePrivadaPemHexadecimal"
    )?.incluidoEmNovos,
    true
  );
  assert.ok((coletado.novos.certificadoPemHexadecimal ?? "").length > 0);
  assert.ok((coletado.novos.chavePrivadaPemHexadecimal ?? "").length > 0);
});

test("extensão do nome não impede inclusão quando os bytes existem", async () => {
  const form = new FormData();
  form.set(
    "certificadoPemHexadecimal",
    new File([PEM_CERT], "certificadoC6")
  );
  form.set("chavePrivadaPemHexadecimal", new File([PEM_KEY], "chave.pem"));
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.erro, undefined);
  assert.ok((coletado.novos.certificadoPemHexadecimal ?? "").length > 0);
  assert.ok((coletado.novos.chavePrivadaPemHexadecimal ?? "").length > 0);
});

test("C6 sandbox usa exatamente certificadoPemHexadecimal e chavePrivadaPemHexadecimal", () => {
  const chaves = formularioCredenciaisProvedor("c6bank", "2").campos
    .filter((campo) => campo.tipo === "file")
    .map((campo) => campo.chave);
  assert.deepEqual(chaves, [
    "certificadoPemHexadecimal",
    "chavePrivadaPemHexadecimal",
  ]);
  assert.equal(chaves.includes("certificadoPemHex"), false);
  assert.equal(chaves.includes("chavePrivadaPemHex"), false);
});

test("6. certificado existente é preservado quando o input vem vazio", async () => {
  const form = new FormData();
  form.set("certificadoPemHexadecimal", new File([], "c6.crt"));
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.novos.certificadoPemHexadecimal, undefined);

  const mesclado = mesclarSegredosProvedor({
    provedor: "c6bank",
    ambiente: "2",
    novos: coletado.novos,
    existentes: { certificadoPemHexadecimal: "aabbcc" },
  });
  assert.equal(mesclado.certificadoPemHexadecimal, "aabbcc");
});

test("7. chave existente é preservada quando o input vem vazio", async () => {
  const form = new FormData();
  form.set("chavePrivadaPemHexadecimal", new File([], "c6.key"));
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  assert.equal(coletado.novos.chavePrivadaPemHexadecimal, undefined);

  const mesclado = mesclarSegredosProvedor({
    provedor: "c6bank",
    ambiente: "2",
    novos: coletado.novos,
    existentes: { chavePrivadaPemHexadecimal: "ddeeff" },
  });
  assert.equal(mesclado.chavePrivadaPemHexadecimal, "ddeeff");
});

test("8. certificado novo entra em coletados.novos", async () => {
  const form = new FormData();
  form.set("certificadoPemHexadecimal", new File([PEM_CERT], "c6.pem"));
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  const diag = coletado.diagnosticoArquivos.find(
    (item) => item.campo === "certificadoPemHexadecimal"
  );
  assert.equal(diag?.incluidoEmNovos, true);
  assert.ok((diag?.hexLength ?? 0) > 0);
  assert.ok((coletado.novos.certificadoPemHexadecimal ?? "").length > 0);
});

test("9. chave nova entra em coletados.novos", async () => {
  const form = new FormData();
  form.set("chavePrivadaPemHexadecimal", new File([PEM_KEY], "c6.key"));
  const coletado = await coletarNovosSegredosDoFormulario(form, "c6bank", "2");
  const diag = coletado.diagnosticoArquivos.find(
    (item) => item.campo === "chavePrivadaPemHexadecimal"
  );
  assert.equal(diag?.incluidoEmNovos, true);
  assert.ok((diag?.hexLength ?? 0) > 0);
  assert.ok((coletado.novos.chavePrivadaPemHexadecimal ?? "").length > 0);
});

test("10. read-back C6 falha se certificado não existir", () => {
  const flags = flagsExistenciaCofreC6({
    clienteId: "id",
    clienteSegredo: "secret",
    chavePrivadaPemHexadecimal: "ddeeff",
  });
  assert.equal(erroReadBackC6(flags), MENSAGEM_C6_CERTIFICADO_NAO_SALVO);
  assert.equal(salvarC6Confirmado(flags), false);
});

test("11. read-back C6 falha se chave não existir", () => {
  const flags = flagsExistenciaCofreC6({
    clienteId: "id",
    clienteSegredo: "secret",
    certificadoPemHexadecimal: "aabbcc",
  });
  assert.equal(erroReadBackC6(flags), MENSAGEM_C6_CHAVE_NAO_SALVA);
  assert.equal(salvarC6Confirmado(flags), false);
});

test("12. sucesso somente quando todos os segredos existem", () => {
  const incompleto = flagsExistenciaCofreC6({
    clienteId: "id",
    certificadoPemHexadecimal: "aa",
    chavePrivadaPemHexadecimal: "bb",
  });
  assert.equal(salvarC6Confirmado(incompleto), false);

  const completo = flagsExistenciaCofreC6({
    clienteId: "id",
    clienteSegredo: "secret",
    certificadoPemHexadecimal: "aa",
    chavePrivadaPemHexadecimal: "bb",
    chavePix: "chave-pix",
  });
  assert.equal(erroReadBackC6(completo), null);
  assert.equal(salvarC6Confirmado(completo), true);

  const resposta = respostaPublicaSalvarPixC6({
    ok: true,
    certificadoConfigurado: true,
    chavePrivadaConfigurada: true,
    diagnostico: {
      certificado: {
        recebido: true,
        size: 12,
        temArrayBuffer: true,
        incluidoEmNovos: true,
        rpcExecutada: true,
        readBackEncontrou: true,
      },
      chave: {
        recebido: true,
        size: 10,
        temArrayBuffer: true,
        incluidoEmNovos: true,
        rpcExecutada: true,
        readBackEncontrou: true,
      },
    },
  });
  assert.equal(resposta.ok, true);
  assert.equal(resposta.mensagem, MENSAGEM_C6_CREDENCIAIS_SALVAS);
});

test("13. nenhum segredo aparece na resposta frontend", () => {
  const resposta = respostaPublicaSalvarPixC6({
    ok: true,
    certificadoConfigurado: true,
    chavePrivadaConfigurada: true,
    diagnostico: {
      certificado: {
        recebido: true,
        size: 2048,
        temArrayBuffer: true,
        incluidoEmNovos: true,
        rpcExecutada: true,
        readBackEncontrou: true,
      },
      chave: {
        recebido: true,
        size: 1700,
        temArrayBuffer: true,
        incluidoEmNovos: true,
        rpcExecutada: true,
        readBackEncontrou: true,
      },
    },
  });
  const json = JSON.stringify(resposta);
  assert.equal(json.includes(PEM_CERT), false);
  assert.equal(json.includes(PEM_KEY), false);
  assert.equal(json.includes("-----BEGIN"), false);
  assert.equal(json.includes("aabbcc"), false);
  assert.equal(json.includes("client_secret"), false);
  assert.equal(json.includes("clienteSegredo"), false);
  assert.equal(json.includes("access_token"), false);
  assert.equal("certificadoConfigurado" in resposta, true);
  assert.equal("chavePrivadaConfigurada" in resposta, true);
  assert.equal(resposta.diagnostico.certificado.recebido, true);
  assert.equal(resposta.diagnostico.chave.rpcExecutada, true);

  const action = fonte("app/configuracoes/financeiro/pix/actions.ts");
  assert.match(action, /respostaPublicaSalvarPixC6/);
  assert.match(action, /erroReadBackC6/);
  assert.doesNotMatch(
    fonte("lib/pagamentos/pix/coletar-segredos.ts"),
    /instanceof File/
  );
});

test("chave PIX C6 do formulário nunca herda a chave pública de outro ambiente", () => {
  assert.equal(chavePixC6ParaVault(""), null);
  assert.equal(chavePixC6ParaVault("chave-sandbox"), "chave-sandbox");
  const action = fonte("app/configuracoes/financeiro/pix/actions.ts");
  assert.match(action, /chavePixC6ParaVault/);
  assert.doesNotMatch(action, /chavePix \|\| texto\(atual\?\.chave_pix\)/);
});
