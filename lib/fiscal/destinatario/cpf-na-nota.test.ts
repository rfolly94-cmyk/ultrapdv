import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import {
  cnpjValido,
  cpfValido,
  mascararCpfDigitando,
  resolverDocumentoDestinatarioPdv,
  somenteDigitosDocumento,
} from "@/lib/fiscal/destinatario/documento";
import {
  camposClienteNfceGeranet,
  lerSnapshotDestinatarioFiscal,
  origemSnapshotAInicializar,
  snapshotDestinatarioParaPersistir,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import { montarPayloadNfceGeranet } from "@/lib/fiscal/geranet/montar-payload-nfce";

const CPF_VALIDO = "39053344705";
const CPF_INVALIDO = "11111111111";
const CNPJ_VALIDO = "04252011000110";

function payloadNfce(snapshot: unknown) {
  return montarPayloadNfceGeranet({
    emitente: {
      cnpj: "00000000000191",
      inscricaoEstadual: "123",
      razaoSocial: "Empresa",
      nomeFantasia: "Empresa",
      logradouro: "Rua",
      numero: "1",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
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
      dataEmissao: "2026-08-24T12:00:00-04:00",
      dataSaida: "2026-08-24T12:00:00-04:00",
      fusoHorario: "America/Cuiaba",
    },
    segredos: {
      certificado_a1: "CERT",
      senha_certificado: "SENHA",
      csc: "CSC",
    },
    item: { ncmProduto: "85171231", icmsCsosn: "102" } as never,
    pagamento: { tipo: "01", valor: 10, indicadorPagamento: "0" },
    codigoNumerico: "12345678",
    snapshotFiscal: snapshot,
  });
}

test("consumidor final sem CPF permanece não identificado", () => {
  const resolvido = resolverDocumentoDestinatarioPdv({
    cpfNaNota: "",
    usarDocumentoClienteNaNota: false,
  });
  assert.equal(resolvido.ok, true);
  if (!resolvido.ok) {
    return;
  }
  assert.equal(resolvido.documento, null);

  const snap = snapshotDestinatarioParaPersistir({
    consumidorFinal: true,
    origem: origemSnapshotAInicializar({ origemVenda: "pdv" }),
    indicadorIe: "9",
    documento: null,
  });
  const cliente = camposClienteNfceGeranet(snap);
  assert.equal(cliente.cpf, "");
  assert.equal(cliente.cnpj, "");
  assert.equal(cliente.consumidorFinal, "1");
  assert.equal(payloadNfce(snap).nfe.cliente.cpf, "");
  assert.equal(payloadNfce(undefined).nfe.cliente.cpf, "");
});

test("consumidor final com CPF válido congela no snapshot e no payload Geranet", () => {
  assert.equal(cpfValido(CPF_VALIDO), true);
  const resolvido = resolverDocumentoDestinatarioPdv({
    cpfNaNota: mascararCpfDigitando(CPF_VALIDO),
  });
  assert.equal(resolvido.ok, true);
  if (!resolvido.ok || !resolvido.documento) {
    assert.fail("deveria resolver CPF");
    return;
  }
  assert.equal(resolvido.documento.tipo, "cpf");
  assert.equal(resolvido.documento.origem, "cpf_na_nota");

  const snap = snapshotDestinatarioParaPersistir({
    consumidorFinal: true,
    origem: "origem_pdv",
    indicadorIe: "9",
    documento: resolvido.documento,
  });
  const lido = lerSnapshotDestinatarioFiscal(snap);
  assert.equal(lido.documentoNumero, CPF_VALIDO);
  assert.equal(lido.documentoTipo, "cpf");
  assert.equal(lido.documentoOrigem, "cpf_na_nota");
  assert.equal(lido.documentoDefinido, true);

  const payload = payloadNfce(snap);
  assert.equal(payload.nfe.cliente.cpf, CPF_VALIDO);
  assert.equal(payload.nfe.cliente.cnpj, "");
  assert.equal(payload.nfe.cliente.consumidorFinal, "1");
});

test("CPF inválido é recusado e não vira destinatário", () => {
  assert.equal(cpfValido(CPF_INVALIDO), false);
  assert.equal(cpfValido("12345678900"), false);
  const resolvido = resolverDocumentoDestinatarioPdv({
    cpfNaNota: "123.456.789-00",
  });
  assert.equal(resolvido.ok, false);
});

test("cliente selecionado com CPF usa o documento do cadastro no snapshot", () => {
  const resolvido = resolverDocumentoDestinatarioPdv({
    usarDocumentoClienteNaNota: true,
    documentoCliente: CPF_VALIDO,
    cpfNaNota: "00000000000",
  });
  assert.equal(resolvido.ok, true);
  if (!resolvido.ok || !resolvido.documento) {
    assert.fail("deveria usar CPF do cliente");
    return;
  }
  assert.equal(resolvido.documento.origem, "cliente");
  assert.equal(resolvido.documento.tipo, "cpf");
  assert.equal(resolvido.documento.numero, CPF_VALIDO);
});

test("cliente selecionado com CNPJ preenche nfe.cliente.cnpj", () => {
  assert.equal(cnpjValido(CNPJ_VALIDO), true);
  const resolvido = resolverDocumentoDestinatarioPdv({
    usarDocumentoClienteNaNota: true,
    documentoCliente: CNPJ_VALIDO,
  });
  assert.equal(resolvido.ok, true);
  if (!resolvido.ok || !resolvido.documento) {
    assert.fail("deveria usar CNPJ do cliente");
    return;
  }
  const snap = snapshotDestinatarioParaPersistir({
    consumidorFinal: true,
    origem: "origem_pdv",
    indicadorIe: "9",
    documento: resolvido.documento,
  });
  const payload = payloadNfce(snap);
  assert.equal(payload.nfe.cliente.cnpj, CNPJ_VALIDO);
  assert.equal(payload.nfe.cliente.cpf, "");
});

test("CPF digitado não cria cliente e snapshot ignora cadastro posterior", () => {
  const snap = snapshotDestinatarioParaPersistir({
    consumidorFinal: true,
    origem: "origem_pdv",
    indicadorIe: "9",
    documento: {
      numero: CPF_VALIDO,
      tipo: "cpf",
      origem: "cpf_na_nota",
    },
  });
  const cadastroAlterado = "04252011000110";
  const cliente = camposClienteNfceGeranet(snap);
  assert.equal(cliente.cpf, CPF_VALIDO);
  assert.notEqual(cliente.cpf, cadastroAlterado);
  assert.equal(cliente.cnpj, "");

  const actions = fonte("app/pdv/actions.ts");
  assert.match(actions, /resolverDocumentoDestinatarioPdv/);
  assert.match(actions, /snapshotDestinatarioParaPersistir/);
  assert.match(actions, /documento: documentoFiscal\.documento/);
  assert.doesNotMatch(actions, /\.from\("clientes"\)\s*\.insert/);
  assert.doesNotMatch(actions, /rpc_abrir_caixa/);
});

test("emissão NFC-e usa documento do snapshot e isola empresa", () => {
  const emitir = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
  const contingencia = fonte(
    "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts"
  );
  const builder = fonte("lib/fiscal/geranet/montar-payload-nfce.ts");
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const consumidor = fonte("components/pdv/pdv-consumidor-nota.tsx");
  const nfe = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const mobile = fonte("app/api/pdv/finalizar/route.ts");

  assert.match(builder, /camposClienteNfceGeranet/);
  assert.match(emitir, /snapshot_fiscal/);
  assert.match(emitir, /snapshotFiscal: venda\.snapshot_fiscal/);
  assert.match(emitir, /\.eq\("empresa_id", empresaId\)/);
  assert.match(contingencia, /snapshotFiscal: venda\.snapshot_fiscal/);
  assert.match(shell, /PdvConsumidorNota/);
  assert.match(shell, /cpfNaNota/);
  assert.match(consumidor, /Usar CPF\/CNPJ do cliente na nota/);
  assert.match(consumidor, /CPF na nota/);
  assert.doesNotMatch(nfe, /camposClienteNfceGeranet/);
  assert.match(nfe, /cliente\.cpf_cnpj/);
  assert.doesNotMatch(mobile, /cpfNaNota|usarDocumentoClienteNaNota/);
  assert.equal(somenteDigitosDocumento("390.533.447-05"), CPF_VALIDO);
});
