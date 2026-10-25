import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { decidirAmbienteCobranca } from "./habilitacao-producao";
import { classificarPendenciaSituacao, decidirComprovanteMotor, decidirProximaCobranca, decidirRegistroVendaMotor, faseDaCaptura, haPendenciaFinanceiraNativa, interpretarRespostaMotor, podeRetomarConfirmacao, pontoInstaladoNaSituacao } from "./motor-csharp";

test("uma resposta simulada não vira pagamento recebido", () => {
  const resultado = interpretarRespostaMotor({
    fase: "resultado",
    pagamentoRecebido: true,
    nativo: false,
    confirmada: true,
    codigo: "aprovada",
  });
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.ok, false);
});

test("confirmação nativa da biblioteca libera o recebimento no PDV", () => {
  const resultado = interpretarRespostaMotor({
    fase: "resultado",
    pagamentoRecebido: true,
    nativo: true,
    confirmada: true,
    codigo: "confirmada",
  });
  assert.equal(resultado.pagamentoRecebido, true);
  assert.equal(resultado.ok, true);
});

test("captura da biblioteca não recebe pagamento", () => {
  const resultado = interpretarRespostaMotor({
    fase: "captura",
    pagamentoRecebido: true,
    nativo: true,
    confirmada: true,
    prompt: "Selecione",
    sessao: "s1",
    opcoes: [{ texto: "Débito", valor: "2" }],
  });
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.fase, "captura");
  assert.equal(resultado.opcoes[0]?.valor, "2");
});

test("situação do ponto não vira pagamento e produção continua bloqueada", () => {
  assert.equal(pontoInstaladoNaSituacao("ponto_instalado"), true);
  assert.equal(pontoInstaladoNaSituacao("ponto_nao_instalado"), false);
  assert.equal(decidirComprovanteMotor({ ambienteGravado: "homologacao", codigo: "venda_confirmada" }), "aceitar");
  assert.equal(decidirComprovanteMotor({ ambienteGravado: "producao", codigo: "venda_confirmada" }), "aceitar");
  assert.equal(decidirComprovanteMotor({ ambienteGravado: "producao", codigo: "ponto_instalado" }), "producao_bloqueada");
  assert.equal(decidirComprovanteMotor({ ambienteGravado: "homologacao", codigo: "ponto_instalado" }), "legado");
  const situacao = interpretarRespostaMotor({
    fase: "resultado",
    codigo: "ponto_instalado",
    nativo: false,
    confirmada: false,
    pagamentoRecebido: false,
  });
  assert.equal(situacao.pagamentoRecebido, false);
});

test("pagamento confirmado de produção registra a venda e a homologação não emite NFC-e", () => {
  const empresa = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const debito = decidirRegistroVendaMotor({
    ambiente: "producao",
    codigo: "venda_confirmada",
    chave: "11111111-1111-4111-8111-111111111111:debito:100",
    modalidade: "debito",
    valorCentavos: 100,
    empresaSessao: empresa,
    empresaJournal: empresa,
  });
  assert.equal(debito.acao, "registrar_producao");
  assert.equal(debito.suprimirNfce, false);
  const credito = decidirRegistroVendaMotor({
    ambiente: "producao",
    codigo: "venda_confirmada",
    chave: "11111111-1111-4111-8111-111111111111:credito:2500",
    modalidade: "credito",
    valorCentavos: 2500,
    empresaSessao: empresa,
    empresaJournal: empresa,
  });
  assert.equal(credito.acao, "registrar_producao");
  const falha = decidirRegistroVendaMotor({
    ambiente: "producao",
    codigo: "venda_nao_confirmada",
    chave: "11111111-1111-4111-8111-111111111111:debito:100",
    modalidade: "debito",
    valorCentavos: 100,
    empresaSessao: empresa,
    empresaJournal: empresa,
  });
  assert.equal(falha.acao, "recusar");
  const homologacao = decidirRegistroVendaMotor({
    ambiente: "homologacao",
    codigo: "venda_confirmada",
    chave: "11111111-1111-4111-8111-111111111111:debito:100",
    modalidade: "debito",
    valorCentavos: 100,
    empresaSessao: empresa,
    empresaJournal: empresa,
  });
  assert.equal(homologacao.acao, "registrar_homologacao");
  assert.equal(homologacao.suprimirNfce, true);
  const outra = decidirRegistroVendaMotor({
    ambiente: "producao",
    codigo: "venda_confirmada",
    chave: "11111111-1111-4111-8111-111111111111:debito:100",
    modalidade: "debito",
    valorCentavos: 100,
    empresaSessao: empresa,
    empresaJournal: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(outra.acao, "recusar");
  const reutilizada = decidirRegistroVendaMotor({
    ambiente: "producao",
    codigo: "venda_vinculada",
    chave: "11111111-1111-4111-8111-111111111111:debito:100",
    modalidade: "debito",
    valorCentavos: 100,
    empresaSessao: empresa,
    empresaJournal: empresa,
  });
  assert.equal(reutilizada.acao, "recusar");
  if (reutilizada.acao === "recusar") {
    assert.match(reutilizada.erro, /não pode ser usado em outra venda/);
  }
  const mesmaVenda = decidirRegistroVendaMotor({
    ambiente: "producao",
    codigo: "venda_vinculada",
    chave: "11111111-1111-4111-8111-111111111111:debito:100",
    modalidade: "debito",
    valorCentavos: 100,
    empresaSessao: empresa,
    empresaJournal: empresa,
    vendaId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(mesmaVenda.acao, "ja_registrada");
  if (mesmaVenda.acao === "ja_registrada") {
    assert.equal(mesmaVenda.vendaId, "22222222-2222-4222-8222-222222222222");
  }
  assert.equal(decidirAmbienteCobranca({ ambienteEmpresa: "producao", liberada: false, comando: "vender" }).ok, false);
  assert.equal(haPendenciaFinanceiraNativa("Há confirmação financeira pendente ou resultado desconhecido."), true);
  assert.equal(haPendenciaFinanceiraNativa("Há 1 pagamento(s) TEF confirmado(s) sem venda no PDV."), false);
});

test("nova cobrança de produção é recusada antes da biblioteca", () => {
  const raiz = fileURLToPath(new URL("../../..", import.meta.url));
  const rota = readFileSync(`${raiz}/app/api/pdv/tef/motor/route.ts`, "utf8");
  const finalizacao = readFileSync(`${raiz}/lib/pdv/tef/finalizacao.ts`, "utf8");
  const fetchMotor = rota.indexOf("new URL(\"/tef/csharp\"");
  assert.ok(rota.indexOf("haPendenciaFinanceiraNativa") < fetchMotor);
  assert.ok(rota.indexOf("decidirAmbienteCobranca") < fetchMotor);
  assert.equal(rota.includes("lerHabilitacaoTef"), false);
  assert.ok(finalizacao.indexOf("decidirRegistroVendaMotor") < finalizacao.indexOf("lerHabilitacaoTef"));
  assert.match(finalizacao, /consulta_producao/);
  assert.doesNotMatch(finalizacao, /operação de homologação não foi registrada/);
});

test("menu, pendência e ciclo aberto não viram outra cobrança nem pagamento", () => {
  assert.equal(faseDaCaptura(1, [
    { valor: "01" },
    { valor: "02" },
  ]), "menu");
  assert.equal(faseDaCaptura(1, []), "menu");
  assert.equal(faseDaCaptura(3, []), "pinpad");
  const moredata = interpretarRespostaMotor({
    fase: "resultado",
    codigoNativo: -2497,
    nativo: true,
    confirmada: true,
    pagamentoRecebido: true,
  });
  assert.equal(moredata.pagamentoRecebido, false);
  const display = interpretarRespostaMotor({
    fase: "resultado",
    codigoNativo: -2495,
    nativo: true,
    confirmada: true,
    pagamentoRecebido: true,
  });
  assert.equal(display.pagamentoRecebido, false);
  const situacao = classificarPendenciaSituacao(
    "Há autorização aguardando confirmação. Há confirmação financeira pendente. Nenhuma nova cobrança foi iniciada.",
    "11111111-1111-4111-8111-111111111111:debito:100",
  );
  assert.equal(situacao.pendencia, "aguardando_confirmacao");
  assert.equal(decidirProximaCobranca({
    pendencia: situacao.pendencia,
    chavePendente: situacao.chave,
    modalidade: "debito",
    valorCentavos: 100,
  }).acao, "confirmar");
  assert.equal(decidirProximaCobranca({
    pendencia: situacao.pendencia,
    chavePendente: situacao.chave,
    modalidade: "credito",
    valorCentavos: 100,
  }).acao, "aguardar");
  assert.equal(decidirProximaCobranca({
    pendencia: "executando",
    chavePendente: "",
    modalidade: "debito",
    valorCentavos: 100,
  }).acao, "aguardar");
  assert.equal(podeRetomarConfirmacao([
    { id: "aprovacao", ok: true },
    { id: "pendencia", ok: false },
  ], "aguardando_confirmacao"), true);
  assert.equal(podeRetomarConfirmacao([
    { id: "aprovacao", ok: false },
    { id: "pendencia", ok: false },
  ], "aguardando_confirmacao"), false);
});

test("instalação confirmada pela biblioteca não vira pagamento", () => {
  const resultado = interpretarRespostaMotor({
    fase: "resultado",
    codigo: "instalada",
    nativo: true,
    confirmada: true,
    pagamentoRecebido: false,
    erro: "A biblioteca confirmou a instalação.",
  });
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "instalada");
});
