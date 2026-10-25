import assert from "node:assert/strict";
import test from "node:test";

import { continuarCaptura, diretorioEmpresaTef, diretorioProducaoEmpresaTef, normalizarRespostaMotor, pedidoLocalDoMotor } from "./tef-csharp-ponte.mjs";

test("vínculo de produção não autoriza nova venda", () => {
  const empresa = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const terminal = "11111111-1111-4111-8111-111111111111";
  const vinculo = pedidoLocalDoMotor({
    comando: "vincular",
    ambiente: 0,
    finalidade: "vinculo_producao",
    empresaId: empresa,
    terminalId: terminal,
    chave: "11111111-1111-4111-8111-111111111111:debito:100",
  }, { raiz: "C:\\temp\\ultrapdv-tef" });
  assert.equal(vinculo.bloqueado, false);
  assert.equal(vinculo.pedido.autorizaVendaProducao, false);
  assert.match(vinculo.pedido.diretorio, /\\producao\\Data$/i);
  const venda = pedidoLocalDoMotor({ comando: "vender", ambiente: 0, empresaId: empresa, terminalId: terminal }, { raiz: "C:\\temp\\ultrapdv-tef" });
  assert.equal(venda.bloqueado, true);
});

test("simulação e produção não viram pagamento", () => {
  const simulada = normalizarRespostaMotor({
    tipo: "resultado",
    pagamentoRecebido: true,
    nativo: false,
    confirmada: true,
    codigo: "aprovada",
  });
  assert.equal(simulada.pagamentoRecebido, false);

  const producao = pedidoLocalDoMotor({ comando: "vender", ambiente: "producao", empresaId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }, { raiz: "C:\\temp\\ultrapdv-tef" });
  assert.equal(producao.bloqueado, true);
});

test("confirmação nativa libera o recebimento e o diretório fica por empresa", () => {
  const confirmada = normalizarRespostaMotor({
    tipo: "resultado",
    pagamentoRecebido: true,
    nativo: true,
    confirmada: true,
    codigo: "confirmada",
    chave: "venda-1",
  });
  assert.equal(confirmada.pagamentoRecebido, true);
  assert.equal(confirmada.ok, true);
  assert.equal(normalizarRespostaMotor({ vendaId: "22222222-2222-4222-8222-222222222222" }).vendaId, "22222222-2222-4222-8222-222222222222");
  assert.equal(normalizarRespostaMotor({ vendaId: "nao-e-venda" }).vendaId, null);

  const empresa = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const terminal = "11111111-1111-1111-1111-111111111111";
  const caminhos = diretorioEmpresaTef("C:\\temp\\ultrapdv-tef-empresas", empresa, terminal);
  assert.match(caminhos.diretorio, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(caminhos.diretorio, /11111111111111111111111111111111/);
  assert.equal(caminhos.diretorio.includes("PGWebLib"), false);
});

test("captura não recebe pagamento e remove autorização do pedido", () => {
  const captura = normalizarRespostaMotor({
    tipo: "captura",
    pagamentoRecebido: true,
    nativo: true,
    confirmada: true,
    prompt: "Informe o ponto",
    opcoes: [{ texto: "Crédito", valor: "1" }],
  }, "sessao-1");
  assert.equal(captura.fase, "captura");
  assert.equal(captura.pagamentoRecebido, false);
  assert.equal(captura.sessao, "sessao-1");
  assert.equal(captura.opcoes[0].valor, "1");

  const pedido = pedidoLocalDoMotor({
    comando: "status",
    autorizacao: "nao-enviar",
    ponto: "nao-enviar",
  }, { raiz: "C:\\temp\\ultrapdv-tef-empresas" });
  assert.equal(pedido.pedido.autorizacao, undefined);
  assert.equal(pedido.pedido.ponto, undefined);
});

test("instalação de produção fica isolada e venda continua bloqueada", () => {
  const empresa = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const terminal = "11111111-1111-1111-1111-111111111111";
  const raiz = "C:\\temp\\ultrapdv-tef-empresas";
  const venda = pedidoLocalDoMotor({ comando: "vender", ambiente: 0, finalidade: "instalacao_producao", empresaId: empresa, terminalId: terminal }, { raiz });
  assert.equal(venda.bloqueado, true);

  const instalar = pedidoLocalDoMotor({ comando: "instalar", ambiente: 0, finalidade: "instalacao_producao", empresaId: empresa, terminalId: terminal, ponto: "segredo", chave: "ins:ponto", operacaoNativa: "PWOPER_INSTALL" }, { raiz });
  assert.equal(instalar.bloqueado, false);
  assert.equal(instalar.pedido.comando, "instalar");
  assert.equal(instalar.pedido.operacaoNativa, "PWOPER_INSTALL");
  assert.equal(instalar.pedido.ambiente, 0);
  assert.equal(instalar.pedido.ponto, "");
  assert.match(instalar.pedido.diretorio, /\\producao\\Data$/);
  assert.match(instalar.pedido.raizJournals, /\\producao$/);
  const locais = diretorioProducaoEmpresaTef(raiz, empresa, terminal);
  assert.notEqual(locais.diretorio, locais.homologacao);
  assert.equal(locais.diretorio.startsWith(locais.homologacao), false);
  assert.match(locais.raizJournals, /\\producao$/);

  const configurar = pedidoLocalDoMotor({ comando: "configurar", ambiente: 0, finalidade: "configuracao_producao", empresaId: empresa, terminalId: terminal, servidor: "nao-enviar", chave: "cfg:ponto", operacaoNativa: "PWOPER_CONFIG" }, { raiz });
  assert.equal(configurar.bloqueado, false);
  assert.equal(configurar.pedido.comando, "configurar");
  assert.equal(configurar.pedido.operacaoNativa, "PWOPER_CONFIG");
  assert.equal(configurar.pedido.ambiente, 0);
  assert.equal(configurar.pedido.servidor, "");
  assert.match(configurar.pedido.diretorio, /\\producao\\Data$/);
  assert.match(configurar.pedido.raizJournals, /\\producao\\configuracao$/);
  assert.equal(configurar.pedido.raizJournals.startsWith(locais.homologacao), false);
  assert.notEqual(configurar.pedido.raizJournals, instalar.pedido.raizJournals);
  const configurarSemFinalidade = pedidoLocalDoMotor({ comando: "configurar", ambiente: 0, empresaId: empresa, terminalId: terminal, chave: "cfg:ponto" }, { raiz });
  assert.equal(configurarSemFinalidade.bloqueado, true);
  const chaveDeInstalacao = pedidoLocalDoMotor({ comando: "configurar", ambiente: 0, finalidade: "configuracao_producao", empresaId: empresa, terminalId: terminal, chave: "ins:ponto", operacaoNativa: "PWOPER_CONFIG" }, { raiz });
  assert.equal(chaveDeInstalacao.bloqueado, true);
  const operacaoTrocada = pedidoLocalDoMotor({ comando: "configurar", ambiente: 0, finalidade: "configuracao_producao", empresaId: empresa, terminalId: terminal, chave: "cfg:ponto", operacaoNativa: "PWOPER_INSTALL" }, { raiz });
  assert.equal(operacaoTrocada.bloqueado, true);
  const vendaProducao = pedidoLocalDoMotor({ comando: "vender", ambiente: 0, finalidade: "venda_producao", empresaId: empresa, terminalId: terminal, chave: "venda-1" }, { raiz });
  assert.equal(vendaProducao.bloqueado, false);
  assert.equal(vendaProducao.pedido.comando, "vender");
  assert.equal(vendaProducao.pedido.autorizaVendaProducao, true);
  assert.match(vendaProducao.pedido.diretorio, /\\producao\\Data$/);
  const cancelamento = pedidoLocalDoMotor({ comando: "cancelar", ambiente: 0, finalidade: "venda_producao", empresaId: empresa, terminalId: terminal }, { raiz });
  assert.equal(cancelamento.bloqueado, true);
  const continuacao = continuarCaptura({ operacaoNativa: "PWOPER_CONFIG", chave: "cfg:ponto" }, { comando: "responder", operacaoNativa: "PWOPER_INSTALL", chave: "cfg:ponto", valor: "lab.exemplo:31735" });
  assert.equal(continuacao.continuar, false);
  assert.equal(continuacao.codigo, "OPERACAO_DIVERGENTE");

  const pinpad = pedidoLocalDoMotor({
    comando: "pinpad",
    ambiente: 0,
    finalidade: "pinpad_producao",
    empresaId: empresa,
    terminalId: terminal,
    operacaoNativa: "PWOPER_INSTALL",
  }, { raiz });
  assert.equal(pinpad.bloqueado, false);
  assert.equal(pinpad.pedido.comando, "pinpad");
  assert.equal(pinpad.pedido.operacaoNativa, "");
  assert.equal(pinpad.pedido.autorizaPinPadProducao, true);
  assert.match(pinpad.pedido.diretorio, /\\producao\\Data$/);
  assert.equal(pedidoLocalDoMotor({ comando: "pinpad", ambiente: 0, empresaId: empresa, terminalId: terminal }, { raiz }).bloqueado, true);
});

test("situação encaminha somente os campos fiscais da transação", () => {
  const resposta = normalizarRespostaMotor({
    tipo: "resultado",
    codigo: "venda_confirmada",
    fiscal: {
      autorizacao: "A1B2C3",
      bandeiraNome: "Maestro",
      rede: "REDE",
      instituicao: "PRODUTO",
      cnpjCredenciadora: "01.027.058/0001-91",
      cnpjRecebedor: "11222333000181",
      numeroRequisicao: "nao-encaminhar",
      comprovante: "nao-encaminhar",
    },
  });
  assert.equal(resposta.fiscal.autorizacao, "A1B2C3");
  assert.equal(resposta.fiscal.bandeiraNome, "Maestro");
  assert.equal(resposta.fiscal.cnpjCredenciadora, "01027058000191");
  assert.equal(resposta.fiscal.cnpjRecebedor, "11222333000181");
  assert.equal(Object.hasOwn(resposta.fiscal, "numeroRequisicao"), false);
  assert.equal(Object.hasOwn(resposta.fiscal, "comprovante"), false);
  const pan = normalizarRespostaMotor({
    tipo: "resultado",
    fiscal: { autorizacao: "4111111111111111", bandeiraNome: "Maestro" },
  });
  assert.equal(pan.fiscal.autorizacao, null);
  assert.equal(pan.fiscal.bandeiraNome, "Maestro");
});
