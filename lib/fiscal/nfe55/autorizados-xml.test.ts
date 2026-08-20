import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  autorizadosXmlDoSnapshotParaGeranet,
  lerAutorizadosXmlDoSnapshot,
  LIMITE_AUTORIZADOS_XML_NFE,
  MENSAGEM_AUTORIZADO_XML_CNPJ_INVALIDO,
  MENSAGEM_AUTORIZADO_XML_CPF_E_CNPJ,
  MENSAGEM_AUTORIZADO_XML_CPF_INVALIDO,
  MENSAGEM_AUTORIZADO_XML_DUPLICADO,
  MENSAGEM_AUTORIZADO_XML_LIMITE,
  snapshotParaPersistirAutorizadosXml,
  validarAutorizadosXml,
} from "./autorizados-xml";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

function payloadBase(autorizadosXml?: Array<{ cpf?: string; cnpj?: string }>) {
  return montarPayloadNfeGeranet({
    ambiente: "2",
    ufEmitente: "MT",
    certificadoDigital: "CERT",
    senhaCertificadoDigital: "SENHA",
    emitente: {
      cnpj: "42741754000142",
      inscricaoEstadual: "138856729",
      razaoSocial: "EMPRESA TESTE",
      logradouro: "Rua A",
      numero: "1",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
      codigoRegimeTributario: 1,
    },
    destinatario: {
      cpf: "52998224725",
      consumidorFinal: "1",
      indicadorIEdestinatario: "9",
      logradouro: "Rua B",
      numero: "2",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
    },
    config: {
      serie: 1,
      numeroNota: 1,
      codigoNumerico: "12345678",
      dataSaida: "2026-08-19 12:00:00",
      dataEmissao: "2026-08-19 12:00:00",
      fusoHorario: "America/Cuiaba",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      tipo: "1",
      finalidade: "1",
    },
    pagamento: {
      troco: 0,
      detalhamento: [{ tipo: "01", valor: 10, indicadorPagamento: "0" }],
    },
    autorizadosXml,
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  });
}

test("snapshot sem autorizadosXml fica vazio e não vai para a Geranet", () => {
  assert.deepEqual(lerAutorizadosXmlDoSnapshot({}), []);
  assert.equal(autorizadosXmlDoSnapshotParaGeranet({}), null);
  assert.equal(autorizadosXmlDoSnapshotParaGeranet({ autorizadosXml: [] }), null);
});

test("persistência no snapshot_fiscal reutiliza JSONB existente", () => {
  const persistido = snapshotParaPersistirAutorizadosXml([
    { cpf: "529.982.247-25", cnpj: "" },
    { cnpj: "42.741.754/0001-42", cpf: " " },
    { cpf: "", cnpj: "" },
  ]);
  assert.deepEqual(persistido.autorizadosXml, [
    { cnpj: "", cpf: "52998224725" },
    { cnpj: "42741754000142", cpf: "" },
  ]);
  const lido = lerAutorizadosXmlDoSnapshot(persistido);
  assert.equal(lido.length, 2);
  assert.equal(lido[0]?.cpf, "52998224725");
  assert.equal(lido[1]?.cnpj, "42741754000142");
});

test("CPF/CNPJ dos autorizados validam somente números, um documento por item e no máximo 10", () => {
  assert.equal(validarAutorizadosXml([]), null);
  assert.equal(
    validarAutorizadosXml([{ cpf: "123", cnpj: "" }]),
    MENSAGEM_AUTORIZADO_XML_CPF_INVALIDO
  );
  assert.equal(
    validarAutorizadosXml([{ cpf: "", cnpj: "123" }]),
    MENSAGEM_AUTORIZADO_XML_CNPJ_INVALIDO
  );
  assert.equal(
    validarAutorizadosXml([{ cpf: "52998224725", cnpj: "42741754000142" }]),
    MENSAGEM_AUTORIZADO_XML_CPF_E_CNPJ
  );
  assert.equal(
    validarAutorizadosXml([{ cpf: "", cnpj: "" }, { cpf: "52998224725", cnpj: "" }]),
    null
  );
  assert.equal(
    validarAutorizadosXml([
      { cpf: "52998224725", cnpj: "" },
      { cpf: "52998224725", cnpj: "" },
    ]),
    MENSAGEM_AUTORIZADO_XML_DUPLICADO
  );
  const acimaDoLimite = Array.from({ length: LIMITE_AUTORIZADOS_XML_NFE + 1 }, (_, i) => ({
    cpf: "",
    cnpj: String(i + 1).padStart(14, "0"),
  }));
  assert.equal(validarAutorizadosXml(acimaDoLimite), MENSAGEM_AUTORIZADO_XML_LIMITE);
});

test("payload Geranet usa nfe.autorizadosXml só quando há registros", () => {
  const nfeSem = (
    payloadBase() as { nfe: Record<string, unknown> }
  ).nfe;
  assert.equal("autorizadosXml" in nfeSem, false);

  const nfeVazio = (
    payloadBase([]) as { nfe: Record<string, unknown> }
  ).nfe;
  assert.equal("autorizadosXml" in nfeVazio, false);

  const nfeCom = (
    payloadBase([
      { cpf: "52998224725", cnpj: "" },
      { cnpj: "42741754000142", cpf: "" },
    ]) as {
      nfe: { autorizadosXml: Array<Record<string, string>> };
    }
  ).nfe;
  assert.deepEqual(nfeCom.autorizadosXml, [
    { cpf: "52998224725" },
    { cnpj: "42741754000142" },
  ]);
  assert.equal("cnpj" in nfeCom.autorizadosXml[0]!, false);
  assert.equal("cpf" in nfeCom.autorizadosXml[1]!, false);
});

test("form, action e emissão isolam por empresa e não alteram destinatário, entrega ou transporte", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const action = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const emitirOp = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const payload = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  assert.match(form, /Autorizados a acessar o XML/);
  assert.match(form, /salvarAutorizadosXmlOperacaoFiscal/);
  assert.match(form, /Adicionar autorizado/);
  assert.match(form, /Remover/);
  assert.match(action, /salvarAutorizadosXmlOperacaoFiscal/);
  assert.match(action, /\.eq\("empresa_id", empresaId\)/);
  const bloco = action.slice(action.indexOf("salvarAutorizadosXmlOperacaoFiscal"));
  assert.doesNotMatch(bloco.slice(0, 2200), /\.from\("clientes"\)/);
  assert.doesNotMatch(bloco.slice(0, 2200), /dados_transporte/);
  assert.doesNotMatch(bloco.slice(0, 2200), /entrega_diferente/);
  assert.match(emitirOp, /autorizadosXmlDoSnapshotParaGeranet/);
  assert.match(emitirVenda, /autorizadosXmlDoSnapshotParaGeranet/);
  assert.match(payload, /autorizadosXml:\s*\n\s*autorizadosXmlGeranet/);
});
