import assert from "node:assert/strict";
import test from "node:test";
import { classificarAmbienteDaConclusao, decidirEmissaoAposConfirmacao, decidirFalhaFiscalMotor, decidirRetomadaMotor, type TentativaMotorConfirmada } from "./retomada-motor";

const tentativa: TentativaMotorConfirmada = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  chave: "11111111-1111-4111-8111-111111111111:debito:100",
  valorCentavos: 100,
  modalidade: "debito",
  origem: "http://127.0.0.1:18181",
  producao: true,
};

test("erro do Supabase depois da autorização retoma a mesma chave", () => {
  const retomada = decidirRetomadaMotor({
    tentativa,
    modalidade: "debito",
    valorCentavos: 100,
    ocupado: false,
  });
  assert.equal(retomada.acao, "finalizar");
  if (retomada.acao === "finalizar") {
    assert.equal(retomada.tentativa.chave, tentativa.chave);
  }
});

test("duplo clique não abre outra cobrança", () => {
  assert.equal(decidirRetomadaMotor({
    tentativa,
    modalidade: "debito",
    valorCentavos: 100,
    ocupado: true,
  }).acao, "aguardar");
});

test("falha de NFC-e preserva o pagamento e deixa a emissão recuperável", () => {
  const fiscal = decidirFalhaFiscalMotor();
  assert.equal(fiscal.preservarPagamento, true);
  assert.equal(fiscal.repetirCobranca, false);
  assert.equal(fiscal.emissaoRecuperavel, true);
});

test("servidor de produção emite mesmo se o checkout começou em falso", () => {
  const emissao = decidirEmissaoAposConfirmacao({
    emitirAutomatico: true,
    temMotor: true,
    supressaoLocal: true,
    ambienteLocal: "pendente",
    supressaoServidor: false,
    ambienteServidor: "producao",
  });
  assert.equal(emissao.emitir, true);
  assert.equal(emissao.avisoHomologacao, false);
});

test("homologação confirmada pelo servidor não emite NFC-e comercial", () => {
  const emissao = decidirEmissaoAposConfirmacao({
    emitirAutomatico: true,
    temMotor: true,
    supressaoLocal: false,
    ambienteLocal: "producao",
    supressaoServidor: true,
    ambienteServidor: "homologacao",
  });
  assert.equal(emissao.emitir, false);
  assert.equal(emissao.avisoHomologacao, true);
});

test("venda sem TEF continua emitindo quando a configuração pede", () => {
  const emissao = decidirEmissaoAposConfirmacao({
    emitirAutomatico: true,
    temMotor: false,
    supressaoLocal: false,
    ambienteLocal: "pendente",
    supressaoServidor: false,
    ambienteServidor: "",
  });
  assert.equal(emissao.emitir, true);
  assert.equal(emissao.avisoHomologacao, false);
});

test("pagamento de produção já confirmado não volta para homologação", () => {
  assert.equal(classificarAmbienteDaConclusao({
    pagamentoJaConfirmado: true,
    producaoDaCobranca: true,
  }), "producao");
  assert.equal(classificarAmbienteDaConclusao({
    pagamentoJaConfirmado: true,
    producaoDaCobranca: false,
  }), "homologacao");
  assert.equal(classificarAmbienteDaConclusao({
    pagamentoJaConfirmado: false,
    producaoDaCobranca: true,
  }), "pendente");
});

test("valor diferente não reutiliza a chave confirmada", () => {
  assert.equal(decidirRetomadaMotor({
    tentativa,
    modalidade: "credito",
    valorCentavos: 2500,
    ocupado: false,
  }).acao, "cobrar");
});
