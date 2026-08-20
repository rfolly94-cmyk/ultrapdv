import assert from "node:assert/strict";
import { test } from "node:test";

import { garantirEmpresa, montarPayloadCobrancaPix } from "./montar-payload";
import { normalizarRespostaPix } from "./normalizar-resposta";
import { payloadSemCredenciais, sanitizarRespostaPix } from "./sanitizar";
import { podeCancelarLocalmente, statusAposRespostaHttp } from "./status";

const credenciais = {
  chavePix: "chave-publica",
  clienteId: "cli",
  clienteSegredo: "segredo-super-secreto",
  certificadoPfxHexadecimal: "aabbcc",
  senhaCertificadoPfx: "senha-pfx",
};

test("1. empresa A não lê recurso da empresa B", () => {
  assert.throws(
    () => garantirEmpresa("empresa-a", "empresa-b"),
    /outra empresa/
  );
  assert.doesNotThrow(() => garantirEmpresa("empresa-a", "empresa-a"));
});

test("2. payload e resposta não expõem secrets", () => {
  const payload = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "efibank",
    cnpj: "12.345.678/0001-90",
    credenciais,
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000-000",
      cidade: "Cuiabá",
      uf: "mt",
    },
    cobranca: { valor: 1 },
  });

  const publico = JSON.stringify(
    payloadSemCredenciais(payload as unknown as Record<string, unknown>)
  );
  const sanitizado = JSON.stringify(
    sanitizarRespostaPix({
      credenciais,
      Authorization: "Bearer gn_abc",
      clienteSegredo: "segredo-super-secreto",
      senhaCertificadoPfx: "senha-pfx",
    })
  );

  assert.equal(publico.includes("segredo-super-secreto"), false);
  assert.equal(publico.includes("senha-pfx"), false);
  assert.equal(sanitizado.includes("segredo-super-secreto"), false);
  assert.equal(sanitizado.includes("Bearer gn_abc"), false);
  assert.match(publico, /\[oculto\]/);
});

test("3. emissão usa ambiente correto", () => {
  const homolog = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "efibank",
    cnpj: "12345678000190",
    credenciais,
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    cobranca: { valor: 1 },
  });
  const producao = montarPayloadCobrancaPix({
    ambiente: "1",
    provedor: "inter",
    cnpj: "12345678000190",
    credenciais,
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    cobranca: { valor: 1 },
  });

  assert.equal(homolog.ambiente, "2");
  assert.equal(producao.ambiente, "1");
  assert.equal(homolog.provedor, "efibank");
  assert.equal(homolog.cnpjcpf, "12345678000190");
});

test("4. emissão persiste TXID extraído da resposta", () => {
  const normalizada = normalizarRespostaPix({
    situacao: "sucesso",
    dados: { txid: "TXID123456", status: "ATIVA" },
  });

  assert.equal(normalizada.txid, "TXID123456");
  assert.equal(normalizada.pago, false);
});

test("5. consulta reutiliza o mesmo TXID", () => {
  const payload = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "efibank",
    cnpj: "12345678000190",
    credenciais,
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    txid: "TXID123456",
  });

  assert.equal(payload.txid, "TXID123456");
  assert.equal(payload.cobranca, undefined);
});

test("6. cancelamento reutiliza o mesmo TXID", () => {
  const payload = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "efibank",
    cnpj: "12345678000190",
    credenciais,
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    txid: "TXID123456",
  });

  assert.equal(payload.txid, "TXID123456");
});

test("7. resposta 4xx Geranet não marca cobrança como paga", () => {
  assert.equal(
    statusAposRespostaHttp({
      httpStatus: 422,
      situacao: "erro",
      pago: false,
      cancelado: false,
      statusAtual: "pendente",
      operacao: "emitir",
    }),
    "erro"
  );
  assert.equal(
    statusAposRespostaHttp({
      httpStatus: 422,
      situacao: "erro",
      pago: false,
      cancelado: false,
      statusAtual: "pendente",
      operacao: "consultar",
    }),
    "pendente"
  );
});

test("8. resposta 5xx não marca cobrança como paga", () => {
  assert.equal(
    statusAposRespostaHttp({
      httpStatus: 500,
      situacao: "erro",
      pago: false,
      cancelado: false,
      statusAtual: "pendente",
      operacao: "emitir",
    }),
    "pendente"
  );
});

test("9. consulta confirmando pagamento altera status para paga", () => {
  const normalizada = normalizarRespostaPix({
    situacao: "sucesso",
    dados: { txid: "TXID123456", status: "CONCLUIDA" },
  });

  assert.equal(normalizada.pago, true);
  assert.equal(
    statusAposRespostaHttp({
      httpStatus: 200,
      situacao: "sucesso",
      pago: true,
      cancelado: false,
      statusAtual: "pendente",
      operacao: "consultar",
    }),
    "paga"
  );
});

test("10. PIX pago não pode ser tratado como cancelado localmente", () => {
  assert.equal(podeCancelarLocalmente("paga"), false);
  assert.equal(
    statusAposRespostaHttp({
      httpStatus: 200,
      situacao: "sucesso",
      pago: false,
      cancelado: true,
      statusAtual: "paga",
      operacao: "cancelar",
    }),
    "paga"
  );
  assert.equal(
    statusAposRespostaHttp({
      httpStatus: 200,
      situacao: "sucesso",
      pago: true,
      cancelado: false,
      statusAtual: "pendente",
      operacao: "cancelar",
    }),
    "paga"
  );
});

test("copia e cola / QR são lidos só se existirem na resposta", () => {
  const normalizada = normalizarRespostaPix({
    dados: {
      pixCopiaECola: "00020126...",
      qrCode: "data:image/png;base64,aaa",
    },
  });

  assert.equal(normalizada.copiaECola, "00020126...");
  assert.equal(normalizada.qrCode, "data:image/png;base64,aaa");
});
