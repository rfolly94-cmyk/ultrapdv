import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  enderecoEntregaDoSnapshotParaGeranet,
  lerEnderecoEntregaDoSnapshot,
  MENSAGEM_ENTREGA_CNPJ_INVALIDO,
  MENSAGEM_ENTREGA_CPF_E_CNPJ,
  MENSAGEM_ENTREGA_CPF_INVALIDO,
  MENSAGEM_ENTREGA_INCOMPLETO,
  snapshotParaPersistirEnderecoEntrega,
  validarEnderecoEntrega,
} from "./endereco-entrega";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const entregaOk = {
  nome: "Deposito Central",
  telefone: "6533334444",
  cpf: "52998224725",
  cnpj: "",
  inscricaoEstadual: "",
  logradouro: "Av. das Industrias",
  numero: "100",
  complemento: "Galpao 2",
  bairro: "Distrito",
  codigoMunicipio: "5103403",
  municipio: "Cuiaba",
  codigoPais: "1058",
  nomePais: "Brasil",
  uf: "mt",
  cep: "78010-000",
  email: "entrega@exemplo.com",
};

test("snapshot sem entrega fica desligada por padrão", () => {
  const lido = lerEnderecoEntregaDoSnapshot({});
  assert.equal(lido.diferente, false);
  assert.equal(lido.entrega.logradouro, "");
  assert.equal(enderecoEntregaDoSnapshotParaGeranet({}), null);
});

test("persistência no snapshot_fiscal reutiliza JSONB existente", () => {
  const persistido = snapshotParaPersistirEnderecoEntrega({
    diferente: true,
    entrega: entregaOk,
  });
  assert.equal(persistido.entrega_diferente, true);
  assert.equal(persistido.entrega.uf, "MT");
  assert.equal(persistido.entrega.cep, "78010000");
  assert.equal(persistido.entrega.cpf, "52998224725");
  const lido = lerEnderecoEntregaDoSnapshot(persistido);
  assert.equal(lido.diferente, true);
  assert.equal(lido.entrega.municipio, "Cuiaba");
});

test("CPF/CNPJ da entrega validam só o que foi preenchido", () => {
  assert.equal(validarEnderecoEntrega({ diferente: false, entrega: entregaOk }), null);
  assert.equal(
    validarEnderecoEntrega({ diferente: true, entrega: { ...entregaOk, cpf: "123" } }),
    MENSAGEM_ENTREGA_CPF_INVALIDO
  );
  assert.equal(
    validarEnderecoEntrega({
      diferente: true,
      entrega: { ...entregaOk, cpf: "", cnpj: "123" },
    }),
    MENSAGEM_ENTREGA_CNPJ_INVALIDO
  );
  assert.equal(
    validarEnderecoEntrega({
      diferente: true,
      entrega: { ...entregaOk, cpf: "52998224725", cnpj: "42741754000142" },
    }),
    MENSAGEM_ENTREGA_CPF_E_CNPJ
  );
  assert.equal(
    validarEnderecoEntrega({ diferente: true, entrega: { ...entregaOk, logradouro: "" } }),
    MENSAGEM_ENTREGA_INCOMPLETO
  );
  assert.equal(validarEnderecoEntrega({ diferente: true, entrega: entregaOk }), null);
});

test("payload Geranet usa nfe.cliente.entrega só com a opção ligada", () => {
  const payloadSem = montarPayloadNfeGeranet({
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
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  });
  const nfeSem = (payloadSem as { nfe: { cliente: Record<string, unknown> } }).nfe;
  assert.equal("entrega" in nfeSem.cliente, false);

  const payloadCom = montarPayloadNfeGeranet({
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
      entrega: snapshotParaPersistirEnderecoEntrega({
        diferente: true,
        entrega: entregaOk,
      }).entrega,
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
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  });
  const nfeCom = (
    payloadCom as {
      nfe: { cliente: { entrega: Record<string, string> } };
    }
  ).nfe;
  assert.equal(nfeCom.cliente.entrega.nome, "Deposito Central");
  assert.equal(nfeCom.cliente.entrega.cpf, "52998224725");
  assert.equal(nfeCom.cliente.entrega.logradouro, "Av. das Industrias");
  assert.equal(nfeCom.cliente.entrega.codigoMunicipio, "5103403");
  assert.equal(nfeCom.cliente.entrega.uf, "MT");
  assert.equal(nfeCom.cliente.entrega.cep, "78010000");
  assert.equal(nfeCom.cliente.entrega.codigoPais, "1058");
  assert.equal("cnpj" in nfeCom.cliente.entrega, false);
});

test("form, action e emissão isolam por empresa e não alteram o cadastro do cliente", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const action = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const emitirOp = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const payload = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  assert.match(form, /Endereço de entrega diferente do destinatário/);
  assert.match(form, /salvarEnderecoEntregaOperacaoFiscal/);
  assert.match(form, /buscaCepEntrega/);
  assert.match(action, /salvarEnderecoEntregaOperacaoFiscal/);
  assert.match(action, /\.eq\("empresa_id", empresaId\)/);
  const bloco = action.slice(action.indexOf("salvarEnderecoEntregaOperacaoFiscal"));
  assert.doesNotMatch(bloco.slice(0, 1800), /\.from\("clientes"\)/);
  assert.match(emitirOp, /enderecoEntregaDoSnapshotParaGeranet/);
  assert.match(emitirVenda, /enderecoEntregaDoSnapshotParaGeranet/);
  assert.match(payload, /entrega: entregaGeranet/);
});
