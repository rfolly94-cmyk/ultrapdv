import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAMPOS_PIX_LOCAL,
  validarConfiguracaoPixLocal,
} from "../local-config";
import { garantirEmpresa, montarPayloadCobrancaPix } from "../montar-payload";
import {
  crc16CcittFalse,
  ehTxidPixValido,
  gerarPixEstatico,
  gerarTxidPixLocal,
  montarPayloadPixEstatico,
  sanitizarTxidPix,
  validarCrcBrCode,
} from "./index";

const EXEMPLO_BCB_SEM_CRC =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";

const DADOS = {
  chave: "123e4567-e12b-12d1-a456-426655440000",
  nomeRecebedor: "Empresa Teste",
  cidadeRecebedor: "Cuiabá",
};

function campoEmv(payload: string, id: string) {
  let i = 0;
  while (i + 4 <= payload.length) {
    const campoId = payload.slice(i, i + 2);
    const tamanho = Number(payload.slice(i + 2, i + 4));
    const valor = payload.slice(i + 4, i + 4 + tamanho);
    if (campoId === id) {
      return valor;
    }
    i += 4 + tamanho;
  }
  return null;
}

function chaveDoPayload(payload: string) {
  const merchant = campoEmv(payload, "26");
  assert.ok(merchant);
  return campoEmv(merchant, "01");
}

test("CRC BR Code do exemplo do Banco Central", () => {
  assert.equal(crc16CcittFalse(EXEMPLO_BCB_SEM_CRC), "1D3D");
  assert.equal(validarCrcBrCode(`${EXEMPLO_BCB_SEM_CRC}1D3D`), true);
});

test("1. QR de R$ 1,00", () => {
  const payload = montarPayloadPixEstatico({
    ...DADOS,
    valor: 1,
    txid: "TESTE1",
  });
  assert.equal(campoEmv(payload, "54"), "1.00");
  assert.equal(validarCrcBrCode(payload), true);
});

test("2. QR de R$ 150,45", () => {
  const payload = montarPayloadPixEstatico({
    ...DADOS,
    valor: 150.45,
    txid: "TESTE150",
  });
  assert.equal(campoEmv(payload, "54"), "150.45");
  assert.equal(validarCrcBrCode(payload), true);
});

test("3. chave Pix entra corretamente no BR Code", () => {
  const payload = montarPayloadPixEstatico({
    ...DADOS,
    valor: 1,
    txid: "CHAVEOK",
  });
  assert.equal(chaveDoPayload(payload), DADOS.chave);
  assert.match(payload, /br\.gov\.bcb\.pix/);
});

test("4. TXID válido", () => {
  const porNumero = gerarTxidPixLocal({ numeroVenda: "1042" });
  const porUuid = gerarTxidPixLocal({
    vendaId: "550e8400-e29b-41d4-a716-446655440000",
  });
  const livre = gerarTxidPixLocal();

  assert.equal(porNumero, "V1042");
  assert.equal(ehTxidPixValido(porNumero), true);
  assert.equal(ehTxidPixValido(porUuid), true);
  assert.equal(ehTxidPixValido(livre), true);
  assert.ok(porUuid.startsWith("U"));
  assert.ok(!porUuid.includes("-"));
  assert.ok(porUuid.length <= 25);
  assert.equal(sanitizarTxidPix("ab-cd_12"), "abcd12");
  assert.throws(() => sanitizarTxidPix("---"), /TXID PIX inválido/);
});

test("5. CRC válido no payload gerado", () => {
  const payload = montarPayloadPixEstatico({
    ...DADOS,
    valor: 1,
    txid: "CRCVALIDO",
  });
  assert.equal(validarCrcBrCode(payload), true);
  assert.equal(payload.slice(-8, -4), "6304");
});

test("6. payload Copia e Cola é o conteúdo do QR", async () => {
  const montado = montarPayloadPixEstatico({
    ...DADOS,
    valor: 1,
    txid: "COPIA1",
  });
  const gerado = await gerarPixEstatico({
    ...DADOS,
    valor: 1,
    txid: "COPIA1",
  });

  assert.equal(gerado.payload, montado);
  assert.ok(gerado.qrCode.startsWith("data:image/png;base64,"));
  assert.equal(gerado.payload.includes(gerado.txid), true);
});

test("7. empresa A não acessa chave da empresa B", () => {
  assert.throws(
    () => garantirEmpresa("empresa-a", "empresa-b"),
    /outra empresa/
  );
});

test("8. modo local não busca secrets", () => {
  const fonte = [
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../local.ts"),
      "utf8"
    ),
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../local-config.ts"),
      "utf8"
    ),
  ].join("\n");
  assert.match(fonte, /CAMPOS_PIX_LOCAL/);
  assert.equal(fonte.includes("obter_segredos"), false);
  assert.equal(fonte.includes("salvar_segredo"), false);
  assert.equal(fonte.includes("carregarApiKeyGeranet"), false);
  assert.deepEqual([...CAMPOS_PIX_LOCAL], [
    "id",
    "empresa_id",
    "modo",
    "ativo",
    "chave_pix",
    "recebedor_nome",
    "recebedor_cidade",
  ]);
});

test("9. modo local não chama Geranet", () => {
  const brcodeDir = dirname(fileURLToPath(import.meta.url));
  const fontes = [
    readFileSync(join(brcodeDir, "gerar.ts"), "utf8"),
    readFileSync(join(brcodeDir, "payload.ts"), "utf8"),
    readFileSync(join(brcodeDir, "../local.ts"), "utf8"),
    readFileSync(join(brcodeDir, "../local-config.ts"), "utf8"),
  ].join("\n");

  assert.equal(fontes.includes("chamarGeranetBanking"), false);
  assert.equal(fontes.includes("lib/geranet"), false);

  const acaoLocal = readFileSync(
    join(brcodeDir, "../../../../app/configuracoes/financeiro/pix/actions.ts"),
    "utf8"
  );
  const blocoTeste = acaoLocal.slice(
    acaoLocal.indexOf("export async function gerarQrPixLocalTeste"),
    acaoLocal.indexOf("export async function salvarConfiguracaoPix(")
  );
  assert.ok(blocoTeste.includes("gerarPixEstatico"));
  assert.equal(blocoTeste.includes("cobrancas_pix"), false);
  assert.equal(blocoTeste.includes("chamarGeranetBanking"), false);
});

test("10. gerar QR não marca pagamento", async () => {
  const gerado = await gerarPixEstatico({
    ...DADOS,
    valor: 1,
    txid: "NAOPAGO",
  });
  assert.equal(gerado.pago, false);
  assert.equal("status" in gerado, false);
});

test("11. Geranet existente continua montando payload", () => {
  const payload = montarPayloadCobrancaPix({
    ambiente: "2",
    provedor: "efibank",
    cnpj: "12345678000190",
    credenciais: {
      chavePix: "chave-publica",
      clienteId: "cli",
      clienteSegredo: "segredo",
    },
    recebedor: {
      nome: "Empresa Teste",
      cep: "78000000",
      cidade: "Cuiabá",
      uf: "MT",
    },
    cobranca: { valor: 1 },
  });

  assert.equal(payload.provedor, "efibank");
  assert.equal(payload.ambiente, "2");
  assert.equal(payload.credenciais.clienteId, "cli");
});

test("12. PIX Local não exige provedor", () => {
  const resultado = validarConfiguracaoPixLocal({
    chave_pix: DADOS.chave,
    recebedor_nome: DADOS.nomeRecebedor,
    recebedor_cidade: DADOS.cidadeRecebedor,
  });
  assert.equal(resultado.ok, true);
});

test("13. PIX Local não exige Client ID", () => {
  const resultado = validarConfiguracaoPixLocal({
    chave_pix: DADOS.chave,
    recebedor_nome: DADOS.nomeRecebedor,
    recebedor_cidade: DADOS.cidadeRecebedor,
    client_id: null,
  });
  assert.equal(resultado.ok, true);
});

test("14. PIX Local não exige certificado", () => {
  const resultado = validarConfiguracaoPixLocal({
    chave_pix: DADOS.chave,
    recebedor_nome: DADOS.nomeRecebedor,
    recebedor_cidade: DADOS.cidadeRecebedor,
    certificado: null,
  });
  assert.equal(resultado.ok, true);
});

test("valor zero ou negativo é recusado", () => {
  assert.throws(
    () =>
      montarPayloadPixEstatico({
        ...DADOS,
        valor: 0,
        txid: "ZERO",
      }),
    /maior que zero/
  );
  assert.throws(
    () =>
      montarPayloadPixEstatico({
        ...DADOS,
        valor: -1,
        txid: "NEG",
      }),
    /maior que zero/
  );
});

test("payload estático usa ponto de iniciação 11", () => {
  const payload = montarPayloadPixEstatico({
    ...DADOS,
    valor: 1,
    txid: "ESTATICO",
  });
  assert.equal(campoEmv(payload, "01"), "11");
  assert.equal(campoEmv(payload, "53"), "986");
  assert.equal(campoEmv(payload, "58"), "BR");
  assert.equal(campoEmv(payload, "59"), "EMPRESA TESTE");
  assert.equal(campoEmv(payload, "60"), "CUIABA");
});
