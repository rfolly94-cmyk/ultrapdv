import assert from "node:assert/strict";
import test from "node:test";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./tef-pgweb.mjs";
import {
  atenderMenuConector,
  avaliarJournalMenu,
  classificarCancelamentoSdk,
  completarInstanciaResidente,
  concluirInterrupcaoCaptura,
  esquecerMenuConector,
  executarDecisaoFinanceira,
  execucaoFisicaPermitida,
  FRASE_MENU_CONECTOR,
  MENSAGEM_CANCELAMENTO_IMPEDIDO,
  prepararConfirmacaoMenu,
  prepararLigacaoResidente,
  recuperarPosQueda,
  avaliarOperacaoResidente,
  bibliotecaResidenteDoConector,
  concederAutorizacaoOperacao,
  consultarAutorizacaoOperacao,
  consumirAutorizacaoOperacao,
  decidirNaSessaoResidente,
  encerrarReservaCom7,
  exclusivaCom7,
  marcarCapturaCom7,
  reconciliarReservaCom7,
  registrarCancelamentoCom7,
  registrarResultadoDesconhecidoCom7,
  reservarOperacaoCom7,
  resolverTransporteMenu,
  transporteMenuSimulado,
  transporteNativoHomologacao,
} from "./tef-menu-conector.mjs";

function transporteDll() {
  const params = [];
  let etapa = 0;
  const transporte = {
    real: false,
    novas: 0,
    params,
    chamadas: [],
    async newTransac() {
      transporte.chamadas.push("PW_iNewTransac");
      transporte.novas += 1;
      return transporte.novas === 1 ? 0 : -2494;
    },
    async addParam(info, valor) {
      transporte.chamadas.push("PW_iAddParam");
      params.push([info, valor]);
      return 0;
    },
    async execTransac() {
      transporte.chamadas.push("PW_iExecTransac");
      if (etapa === 0) {
        etapa = 1;
        return {
          codigo: -2497,
          captura: [
            {
              wIdentificador: 0x36,
              bTipoDeDado: 1,
              bNumOpcoesMenu: 3,
              szPrompt: "SELECIONE O PROVEDOR",
              vszTextoMenu: ["C6 PAY", "REDE", "PIX C6 BANK"],
              vszValorMenu: ["9691", "9692", "9693"],
            },
          ],
        };
      }
      if (etapa === 1) {
        etapa = 2;
        return {
          codigo: -2497,
          captura: [
            {
              wIdentificador: 0x29,
              bTipoDeDado: 1,
              bNumOpcoesMenu: 2,
              szPrompt: "ESCOLHA A FORMA DE PAGAMENTO",
              vszTextoMenu: ["Débito", "Crédito"],
              vszValorMenu: ["02", "01"],
            },
          ],
        };
      }
      etapa = 3;
      return {
        codigo: -2497,
        captura: [
          {
            wIdentificador: 0x2f,
            bTipoDeDado: 3,
            szPrompt: "Insira ou passe o cartão",
            vszTextoMenu: [],
            vszValorMenu: [],
          },
        ],
      };
    },
  };
  return transporte;
}

const base = {
  ambiente: "homologacao",
  empresaId: "empresa-a",
  terminalCodigo: "caixa-1",
  frase: FRASE_MENU_CONECTOR,
  journal: { seguir: true },
};

test("a simulação preserva a sessão e usa vszValorMenu da captura", async () => {
  esquecerMenuConector();
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(execucaoFisicaPermitida(), false);
  const transporte = transporteDll();
  const aberto = await atenderMenuConector({ ...base, acao: "iniciar", simulacao: true, transporte });
  assert.equal(aberto.ok, true);
  assert.equal(aberto.novas, 1);
  assert.equal(aberto.menu.wIdentificador, 0x36);
  assert.deepEqual(
    aberto.menu.opcoes.map((item) => item.valor),
    ["9691", "9692", "9693"]
  );
  const texto = await atenderMenuConector({
    ...base,
    acao: "responder",
    simulacao: true,
    capturaId: aberto.menu.capturaId,
    valor: "C6 PAY",
  });
  assert.equal(texto.ok, false);
  assert.equal(texto.codigo, "OPCAO");
  assert.equal(transporte.novas, 1);
  const repetido = await atenderMenuConector({ ...base, acao: "iniciar", simulacao: true, transporte: transporteDll() });
  assert.equal(repetido.novas, 1);
  assert.equal(transporte.novas, 1);
  const forma = await atenderMenuConector({
    ...base,
    acao: "responder",
    simulacao: true,
    capturaId: aberto.menu.capturaId,
    valor: "9691",
  });
  assert.equal(forma.menu.wIdentificador, 0x29);
  assert.equal(forma.valorEnviado, "9691");
  const pinpad = await atenderMenuConector({
    ...base,
    acao: "responder",
    simulacao: true,
    capturaId: forma.menu.capturaId,
    valor: "02",
  });
  assert.equal(pinpad.fase, "pinpad");
  assert.equal(pinpad.pinpad.prompt, "Insira ou passe o cartão");
  assert.equal(pinpad.pinpad.wIdentificador, 0x2f);
  assert.equal(pinpad.novas, 1);
  assert.equal(pinpad.pagamentoRecebido, false);
  esquecerMenuConector();
});

test("execução física, outra empresa, porta e journal não chamam a DLL", async () => {
  esquecerMenuConector();
  const transporte = transporteDll();
  transporte.real = true;
  const fisico = await atenderMenuConector({ ...base, acao: "iniciar", simulacao: true, transporte });
  assert.equal(fisico.codigo, "execucao_fisica_bloqueada");
  assert.equal(transporte.chamadas.length, 0);
  const semSimulacao = await atenderMenuConector({ ...base, acao: "iniciar", transporte: transporteDll() });
  assert.equal(semSimulacao.comandoEnviado, false);
  assert.equal(semSimulacao.pagamentoRecebido, false);
  const journal = await atenderMenuConector({
    ...base,
    acao: "iniciar",
    simulacao: false,
    transporte: transporteDll(),
    journal: { seguir: false, codigo: "recuperar", mensagem: "Recupere antes de cobrar." },
  });
  assert.equal(journal.codigo, "recuperar");
  assert.equal(journal.comandoEnviado, false);
  const porta = await atenderMenuConector({
    ...base,
    acao: "iniciar",
    simulacao: true,
    transporte: transporteDll(),
    portaPinpadOcupada: true,
  });
  assert.equal(porta.codigo, "porta");
  const aberto = await atenderMenuConector({ ...base, acao: "iniciar", simulacao: true, transporte: transporteDll() });
  const outra = await atenderMenuConector({
    ...base,
    empresaId: "empresa-b",
    acao: "iniciar",
    simulacao: true,
    transporte: transporteDll(),
  });
  assert.equal(outra.codigo, "isolada");
  assert.equal(aberto.novas, 1);
  const cancelada = await atenderMenuConector({ ...base, acao: "cancelar" });
  assert.equal(cancelada.codigo, "FECHAMENTO_IMPEDIDO");
  assert.equal(cancelada.sessaoMantida, true);
  assert.equal(cancelada.mensagem, MENSAGEM_CANCELAMENTO_IMPEDIDO);
  assert.equal(cancelada.pagamentoRecebido, false);
  const estado = await atenderMenuConector({ ...base, acao: "estado" });
  assert.equal(estado.fase, "menu");
  assert.equal(estado.novas, 1);
  esquecerMenuConector();
});

test("o transporte simulado do Connector mantém uma sessão e o cancelamento segue o SDK", async () => {
  esquecerMenuConector();
  const transporte = transporteMenuSimulado();
  const aberto = await atenderMenuConector({
    ...base,
    acao: "iniciar",
    simulacao: true,
    transporte,
    journal: { seguir: false, codigo: "recuperar", mensagem: "Journal fechado." },
  });
  assert.equal(aberto.fase, "menu");
  assert.equal(aberto.simulado, true);
  assert.equal(aberto.comandoDll, false);
  assert.deepEqual(aberto.menu.opcoes.map((item) => item.valor), ["9691", "9692", "9693"]);
  assert.equal(transporte.chamadas.every((item) => item === "simulado"), true);
  const deNovo = await atenderMenuConector({ ...base, acao: "iniciar", simulacao: true, transporte: transporteMenuSimulado() });
  assert.equal(deNovo.novas, 1);
  assert.equal(transporte.novas, 1);
  assert.equal(classificarCancelamentoSdk("antes").chamar, false);
  assert.equal(classificarCancelamentoSdk("captura").procedimento, "PW_iPPAbort");
  assert.equal(classificarCancelamentoSdk("captura").chamar, false);
  assert.equal(classificarCancelamentoSdk("desconhecido").procedimento, "bloquear");
  assert.equal(classificarCancelamentoSdk("autorizada").procedimento, "PW_iConfirmation");
  assert.equal(classificarCancelamentoSdk("autorizada").chamar, false);
  const cancelada = await atenderMenuConector({ ...base, acao: "cancelar" });
  assert.equal(cancelada.sessaoMantida, true);
  assert.equal(cancelada.comandoDll, false);
  esquecerMenuConector();
});

function bibliotecaEnsaio(eventos) {
  let etapa = 0;
  const biblioteca = {
    real: false,
    chamadas: [],
    async newTransac() {
      biblioteca.chamadas.push("PW_iNewTransac");
      return 0;
    },
    async addParam(info, valor) {
      biblioteca.chamadas.push(["PW_iAddParam", info, valor]);
      return 0;
    },
    async execTransac() {
      const evento = eventos[etapa] ?? { codigo: -2596, captura: [] };
      etapa += 1;
      return evento;
    },
    async ppAbort() {
      biblioteca.chamadas.push("PW_iPPAbort");
      return 0;
    },
    async ppEventLoop() {
      biblioteca.chamadas.push("PW_iPPEventLoop");
      return { codigo: -2491, display: "" };
    },
    async confirmation() {
      biblioteca.chamadas.push("PW_iConfirmation");
      return -2494;
    },
  };
  return biblioteca;
}

const menuProvedor = {
  codigo: -2497,
  captura: [{ wIdentificador: 0x36, bTipoDeDado: 1, bNumOpcoesMenu: 1, szPrompt: "PROVEDOR", vszTextoMenu: ["C6 PAY"], vszValorMenu: ["9691"] }],
};
const menuForma = {
  codigo: -2497,
  captura: [{ wIdentificador: 0x29, bTipoDeDado: 1, bNumOpcoesMenu: 1, szPrompt: "FORMA", vszTextoMenu: ["Débito"], vszValorMenu: ["02"] }],
};
const capturaCartao = {
  codigo: -2497,
  captura: [{ wIdentificador: 0x2f, bTipoDeDado: 3, szPrompt: "Insira ou passe o cartão", vszTextoMenu: [], vszValorMenu: [] }],
};

test("o transporte nativo atravessa várias requisições sem segunda transação nem DLL real", async () => {
  esquecerMenuConector();
  const biblioteca = bibliotecaEnsaio([menuProvedor, menuForma, capturaCartao]);
  const transporte = transporteNativoHomologacao(biblioteca);
  const aberto = await atenderMenuConector({
    ...base,
    acao: "iniciar",
    ensaioNativo: true,
    transporte,
    journal: { seguir: true },
  });
  assert.equal(aberto.nativo, true);
  assert.equal(aberto.simulado, false);
  assert.equal(aberto.comandoDll, false);
  assert.equal(aberto.novas, 1);
  assert.equal(aberto.menu.wIdentificador, 0x36);
  assert.equal(aberto.menu.opcoes[0].valor, "9691");
  const repetido = await atenderMenuConector({ ...base, acao: "iniciar", ensaioNativo: true, transporte: transporteNativoHomologacao(bibliotecaEnsaio([])) });
  assert.equal(repetido.novas, 1);
  assert.equal(biblioteca.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  const [primeira, segunda] = await Promise.all([
    atenderMenuConector({ ...base, acao: "responder", capturaId: aberto.menu.capturaId, valor: "9691" }),
    atenderMenuConector({ ...base, acao: "responder", capturaId: aberto.menu.capturaId, valor: "9691" }),
  ]);
  const aceitas = [primeira, segunda].filter((item) => item.ok && item.valorEnviado === "9691");
  assert.equal(aceitas.length, 1);
  assert.equal(aceitas[0].menu.wIdentificador, 0x29);
  const pinpad = await atenderMenuConector({ ...base, acao: "responder", capturaId: aceitas[0].menu.capturaId, valor: "02" });
  assert.equal(pinpad.fase, "pinpad");
  assert.equal(pinpad.pinpad.wIdentificador, 0x2f);
  assert.equal(pinpad.pagamentoRecebido, false);
  const rotulo = biblioteca.chamadas.find((item) => Array.isArray(item) && item[2] === "C6 PAY");
  assert.equal(rotulo, undefined);
  const outra = await atenderMenuConector({
    ...base,
    empresaId: "empresa-b",
    acao: "iniciar",
    ensaioNativo: true,
    transporte: transporteNativoHomologacao(bibliotecaEnsaio([menuProvedor])),
  });
  assert.equal(outra.codigo, "isolada");
  const producao = await atenderMenuConector({ ...base, ambiente: "producao", acao: "iniciar", ensaioNativo: true, transporte });
  assert.equal(producao.pagamentoRecebido, false);
  assert.notEqual(producao.codigo, "executada");
  const cancelada = await atenderMenuConector({ ...base, acao: "cancelar" });
  assert.equal(cancelada.codigo, "CAPTURA_INTERROMPIDA");
  assert.equal(cancelada.sessaoMantida, true);
  assert.equal(cancelada.pagamentoRecebido, false);
  assert.equal(cancelada.confirmacao.chamar, false);
  assert.equal(cancelada.confirmacao.journalApagado, false);
  assert.equal(biblioteca.chamadas.includes("PW_iConfirmation"), false);
  const estado = await atenderMenuConector({ ...base, acao: "estado" });
  assert.equal(estado.fase, "pinpad");
  assert.equal(estado.novas, 1);
  esquecerMenuConector();
});

test("resultado desconhecido, confirmação e resolver não liberam venda física", async () => {
  esquecerMenuConector();
  const biblioteca = bibliotecaEnsaio([menuProvedor, { codigo: -2596, captura: [] }]);
  const transporte = transporteNativoHomologacao(biblioteca);
  const aberto = await atenderMenuConector({ ...base, acao: "iniciar", ensaioNativo: true, transporte, journal: { seguir: true } });
  const erro = await atenderMenuConector({ ...base, acao: "responder", capturaId: aberto.menu.capturaId, valor: "9691" });
  assert.equal(erro.codigo, "desconhecido");
  assert.equal(erro.pagamentoRecebido, false);
  assert.equal(erro.journalApagado, false);
  assert.equal(erro.confirmacao.chamar, false);
  const deNovo = await atenderMenuConector({ ...base, acao: "iniciar", ensaioNativo: true, transporte: transporteNativoHomologacao(bibliotecaEnsaio([menuProvedor])) });
  assert.equal(deNovo.codigo, "desconhecido");
  assert.equal(deNovo.pagamentoRecebido, false);
  assert.equal(biblioteca.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  const confirmacao = prepararConfirmacaoMenu({ referencias: {}, autorizacaoFinanceira: false });
  assert.equal(confirmacao.chamar, false);
  assert.equal(confirmacao.journalApagado, false);
  const oficial = { real: true, async newTransac() { throw new Error("DLL"); } };
  const escolha = resolverTransporteMenu({
    journal: { seguir: true },
    servidor: "homologacao",
    autorizacaoServidor: true,
    biblioteca: oficial,
  });
  assert.equal(escolha.simulacao, true);
  assert.equal(escolha.execucaoFisica, false);
  const ligacao = prepararLigacaoResidente({
    journal: { seguir: true },
    servidor: "homologacao",
    autorizacaoServidor: true,
    biblioteca: oficial,
  });
  assert.equal(ligacao.ligado, false);
  assert.equal(ligacao.ponto, "transporteNativoHomologacao.newTransac");
  assert.equal(prepararLigacaoResidente({ autorizacaoServidor: false }).ligado, false);
  assert.equal(prepararLigacaoResidente({ payloadNavegador: true, autorizacaoServidor: true }).ligado, false);
  assert.equal(escolha.nativo, false);
  assert.equal(escolha.pendencias.some((item) => item.includes("LAYOUT_HOMOLOGADO")), false);
  assert.equal(execucaoFisicaPermitida({ autorizacaoServidor: true, servidor: "homologacao", journal: { seguir: true } }), false);
  assert.equal(classificarCancelamentoSdk("desconhecido").chamar, false);
  esquecerMenuConector();
});

test("cancelamento, confirmação, desfazimento e queda não concluem sem o retorno documentado", async () => {
  const continuo = {
    chamadas: [],
    async ppAbort() {
      this.chamadas.push("PW_iPPAbort");
      return 0;
    },
    async ppEventLoop() {
      this.chamadas.push("PW_iPPEventLoop");
      return { codigo: this.chamadas.filter((item) => item === "PW_iPPEventLoop").length === 1 ? -2493 : -2491 };
    },
  };
  const interrompida = await concluirInterrupcaoCaptura(continuo);
  assert.equal(interrompida.confirmado, true);
  assert.equal(interrompida.resultado, "captura_cancelada");
  assert.equal(interrompida.sessaoMantida, true);
  assert.equal(interrompida.pagamentoRecebido, false);
  assert.deepEqual(interrompida.eventos, [-2493, -2491]);

  const incompleto = {
    async ppAbort() {
      return 0;
    },
    async ppEventLoop() {
      return { codigo: -2494 };
    },
  };
  const mantida = await concluirInterrupcaoCaptura(incompleto);
  assert.equal(mantida.confirmado, false);
  assert.equal(mantida.sessaoMantida, true);
  assert.equal(mantida.resultado, "cancelamento_nao_confirmado");

  const refs = { reqNum: "1", locRef: "2", extRef: "3", virtMerch: "4", authSyst: "5" };
  const registro = { persistido: true, autorizacaoFinanceira: true, referencias: refs };
  const financeiro = {
    real: false,
    chamadas: [],
    async confirmation(status) {
      this.chamadas.push(status);
      return 0;
    },
    async waitConfirmation() {
      this.chamadas.push("espera");
      return 0;
    },
  };
  const confirmada = await executarDecisaoFinanceira(financeiro, registro, "confirmar");
  assert.equal(confirmada.codigo, "confirmada");
  assert.equal(confirmada.pagamentoRecebido, true);
  assert.equal(confirmada.journalApagado, false);
  const desfeita = await executarDecisaoFinanceira(financeiro, registro, "desfazer");
  assert.equal(desfeita.codigo, "desfeita");
  assert.equal(desfeita.pagamentoRecebido, false);
  assert.deepEqual(financeiro.chamadas, [0x00003221, "espera", 0x00003231, "espera"]);
  const semResposta = await executarDecisaoFinanceira(
    { real: false, async confirmation() { return 0; }, async waitConfirmation() { return -2490; } },
    registro,
    "confirmar"
  );
  assert.equal(semResposta.codigo, "SEM_RESPOSTA");
  assert.equal(semResposta.recusa, false);
  assert.equal(semResposta.pendente, true);
  assert.equal(semResposta.pagamentoRecebido, false);
  const real = await executarDecisaoFinanceira({ real: true, async confirmation() { throw new Error("DLL"); } }, registro, "confirmar");
  assert.equal(real.codigo, "DLL");
  assert.equal(real.executado, false);

  const queda = recuperarPosQueda({ respostaAusente: true, idempotencyKey: "chave-1", chavesUsadas: ["chave-0"] });
  assert.equal(queda.acao, "intervir");
  assert.equal(queda.recusa, false);
  assert.equal(queda.novaCobranca, false);
  assert.equal(queda.reutilizarChave, false);
  const repetida = recuperarPosQueda({ comprovado: true, idempotencyKey: "chave-1", chavesUsadas: ["chave-1"] });
  assert.equal(repetida.motivo, "chave");
  assert.equal(repetida.reutilizarChave, false);
  const remoto = recuperarPosQueda({ serverPnd: "1", comprovado: true });
  assert.equal(remoto.motivo, "pendencia_remota");
  assert.equal(remoto.novaCobranca, false);
});

test("a sessão residente exige autorização única e não chama biblioteca real sem ela", async () => {
  esquecerMenuConector();
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(concederAutorizacaoOperacao({ ambiente: "homologacao", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-1" }).codigo, "confianca");
  assert.equal(concederAutorizacaoOperacao({ ambiente: "laboratorio", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-lab" }, { servidor: true }).codigo, "producao");
  assert.equal(concederAutorizacaoOperacao({ ambiente: "producao", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-prod" }, { servidor: true }).codigo, "concedida");
  assert.equal(concederAutorizacaoOperacao({ ambiente: "homologacao", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-1" }, { servidor: true }).codigo, "concedida");
  assert.equal(concederAutorizacaoOperacao({ ambiente: "homologacao", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-1" }, { servidor: true }).codigo, "repetida");
  const biblioteca = bibliotecaEnsaio([menuProvedor, { codigo: -2596, captura: [] }]);
  biblioteca.real = true;
  biblioteca.residente = true;
  biblioteca.homologacao = true;
  biblioteca.origem = "conector";
  const pedido = { ambiente: "homologacao", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-1" };
  const previa = consultarAutorizacaoOperacao(pedido);
  assert.equal(previa.ok, true);
  const semCom = resolverTransporteMenu({
    ambiente: "homologacao",
    servidor: "homologacao",
    journal: { seguir: true },
    pontoInstalado: true,
    dllOk: true,
    com7Exclusiva: false,
    sessaoNativaDisponivel: true,
    biblioteca,
    autorizacaoOperacao: previa.autorizacao,
  });
  assert.equal(semCom.nativo, false);
  assert.equal(avaliarOperacaoResidente({ ...semCom, com7Exclusiva: false, portaPinpadOcupada: true, biblioteca, autorizacaoOperacao: previa.autorizacao, ambiente: "homologacao", servidor: "homologacao", journal: { seguir: false }, pontoInstalado: true, dllOk: true, sessaoNativaDisponivel: true }).includes("journal"), true);
  assert.equal(avaliarOperacaoResidente({ ambiente: "homologacao", servidor: "homologacao", journal: { seguir: true }, pontoInstalado: true, dllOk: true, com7Exclusiva: false, sessaoNativaDisponivel: true, biblioteca, autorizacaoOperacao: previa.autorizacao }).includes("com7"), true);
  const escolha = resolverTransporteMenu({
    ambiente: "homologacao",
    servidor: "homologacao",
    journal: { seguir: true },
    pontoInstalado: true,
    dllOk: true,
    com7Exclusiva: true,
    sessaoNativaDisponivel: true,
    biblioteca,
    autorizacaoOperacao: previa.autorizacao,
  });
  assert.equal(escolha.nativo, true);
  assert.equal(escolha.execucaoFisica, false);
  assert.equal(escolha.simulacao, false);
  const semReserva = await atenderMenuConector({
    ...base,
    acao: "iniciar",
    transporte: escolha.transporte,
    simulacao: false,
    sessaoResidenteAutorizada: true,
    journal: { seguir: true },
  });
  assert.equal(semReserva.codigo, "com7");
  assert.equal(biblioteca.chamadas.includes("PW_iNewTransac"), false);
  const consumo = reservarOperacaoCom7(pedido);
  assert.equal(consumo.codigo, "reservada");
  assert.equal(exclusivaCom7("empresa-a", "caixa-1"), true);
  assert.equal(consumirAutorizacaoOperacao(pedido).codigo, "consumida");
  const aberto = await atenderMenuConector({
    ...base,
    acao: "iniciar",
    transporte: escolha.transporte,
    simulacao: false,
    sessaoResidenteAutorizada: true,
    journal: { seguir: true },
  });
  assert.equal(aberto.ok, true);
  assert.equal(aberto.novas, 1);
  assert.equal(aberto.pagamentoRecebido, false);
  assert.equal(aberto.menu.opcoes[0].valor, "9691");
  const outraEmpresa = await atenderMenuConector({ ...base, empresaId: "empresa-b", acao: "iniciar", transporte: escolha.transporte, simulacao: false, sessaoResidenteAutorizada: true });
  assert.equal(outraEmpresa.codigo, "isolada");
  assert.equal(biblioteca.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  const seguida = await atenderMenuConector({ ...base, acao: "responder", capturaId: aberto.menu.capturaId, valor: "9691", transporte: escolha.transporte, sessaoResidenteAutorizada: true });
  assert.equal(seguida.codigo, "desconhecido");
  assert.equal(seguida.pagamentoRecebido, false);
  assert.equal(seguida.journalApagado, false);
  const decisao = await decidirNaSessaoResidente("empresa-a", "caixa-1", "desfazer");
  assert.equal(decisao.mesmaSessao, true);
  assert.equal(decisao.pagamentoRecebido, false);
  assert.equal(decisao.journalApagado, false);
  assert.equal(encerrarReservaCom7({ ...pedido, comprovada: true, sessaoEncerrada: true, capturaAtiva: false }).codigo, "nao_comprovada");
  const repetida = await atenderMenuConector({ ...base, acao: "iniciar", transporte: escolha.transporte, simulacao: false, sessaoResidenteAutorizada: true });
  assert.equal(repetida.codigo, "desconhecido");
  assert.equal(repetida.pagamentoRecebido, false);
  assert.equal(biblioteca.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  const producao = resolverTransporteMenu({ ambiente: "producao", servidor: "producao", biblioteca, autorizacaoOperacao: consumo.autorizacao });
  assert.equal(producao.nativo, false);
  assert.equal(producao.execucaoFisica, false);
  const semAutorizacao = resolverTransporteMenu({ ambiente: "homologacao", servidor: "homologacao", biblioteca, autorizacaoServidor: true });
  assert.equal(semAutorizacao.nativo, false);
  const incompleta = {
    homologacao: true,
    bibliotecaNativa: { func(assinatura) { return assinatura; } },
  };
  const ligada = completarInstanciaResidente(incompleta, () => ({ newTransac() {} }));
  assert.equal(ligada, null);
  assert.equal(incompleta.residente, false);
  assert.equal(incompleta.origem, undefined);
  assert.equal(incompleta.causaSessao, "inicializacao");
  esquecerMenuConector();
});

test("falha antes de PW_iNewTransac libera a reserva e acesso externo não abre a COM7", async () => {
  esquecerMenuConector();
  const { reservarHomologacao, ocupacaoHomologacao } = await import("./tef-homologacao-ocupacao.mjs");
  const { executarDiagnosticoHomologacao } = await import("./tef-diagnostico-homologacao.mjs");
  concederAutorizacaoOperacao(
    { ambiente: "homologacao", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-falha" },
    { servidor: true }
  );
  const reserva = reservarOperacaoCom7({
    ambiente: "homologacao",
    empresaId: "empresa-a",
    terminalCodigo: "caixa-1",
    valorCentavos: 100,
    idempotencyKey: "op-falha",
  });
  assert.equal(reserva.codigo, "reservada");
  assert.equal(reservarHomologacao("diagnostico").ok, false);
  assert.equal(ocupacaoHomologacao()?.origem, "com7");
  let abriu = false;
  const externo = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    { executar: true, raiz: "C:\\UltraPDV\\homologacao", abrir() { abriu = true; }, verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true }) }
  );
  assert.equal(externo.codigo, "COM7_RESERVADA");
  assert.equal(abriu, false);
  const biblioteca = bibliotecaEnsaio([menuProvedor]);
  biblioteca.real = true;
  biblioteca.residente = true;
  biblioteca.homologacao = true;
  biblioteca.origem = "conector";
  biblioteca.newTransac = async () => 9;
  const falha = await atenderMenuConector({
    ...base,
    acao: "iniciar",
    transporte: transporteNativoHomologacao(biblioteca, reserva.autorizacao),
    simulacao: false,
    sessaoResidenteAutorizada: true,
  });
  assert.equal(falha.codigo, "recusa");
  assert.equal(falha.pagamentoRecebido, false);
  assert.equal(exclusivaCom7("empresa-a", "caixa-1"), false);
  assert.equal(ocupacaoHomologacao(), null);
  assert.equal(consumirAutorizacaoOperacao({ ambiente: "homologacao", empresaId: "empresa-a", terminalCodigo: "caixa-1", valorCentavos: 100, idempotencyKey: "op-falha" }).codigo, "consumida");
  esquecerMenuConector();
});

test("a COM7 fica exclusiva só pela reserva da sessão e não pelo navegador", () => {
  esquecerMenuConector();
  const conceder = (chave, empresaId = "empresa-a", terminalCodigo = "caixa-1") =>
    concederAutorizacaoOperacao(
      { ambiente: "homologacao", empresaId, terminalCodigo, valorCentavos: 100, idempotencyKey: chave },
      { servidor: true }
    );
  const pedido = (chave, empresaId = "empresa-a", terminalCodigo = "caixa-1") => ({
    ambiente: "homologacao",
    empresaId,
    terminalCodigo,
    valorCentavos: 100,
    idempotencyKey: chave,
  });
  assert.equal(conceder("op-a").codigo, "concedida");
  assert.equal(conceder("op-b", "empresa-b", "caixa-2").codigo, "concedida");
  assert.equal(conceder("op-c", "empresa-a", "caixa-9").codigo, "concedida");
  assert.equal(reservarOperacaoCom7({ ...pedido("op-a"), com7Exclusiva: true, origemNavegador: true }).codigo, "navegador");
  assert.equal(reservarOperacaoCom7({ ...pedido("op-a"), ambiente: "producao" }).codigo, "producao");
  assert.equal(reservarOperacaoCom7({ ...pedido("sem-grant"), com7Exclusiva: true }).codigo, "ausente");
  assert.equal(exclusivaCom7("empresa-a", "caixa-1"), false);
  const simultaneas = [reservarOperacaoCom7(pedido("op-a")), reservarOperacaoCom7(pedido("op-b", "empresa-b", "caixa-2"))];
  assert.equal(simultaneas[0].ok, true);
  assert.equal(simultaneas[0].exclusiva, true);
  assert.equal(simultaneas[0].pagamentoRecebido, false);
  assert.equal(simultaneas[1].codigo, "empresa");
  assert.equal(exclusivaCom7("empresa-a", "caixa-1"), true);
  assert.equal(marcarCapturaCom7("empresa-a", "caixa-1").exclusiva, true);
  assert.equal(reservarOperacaoCom7(pedido("op-c", "empresa-a", "caixa-9")).codigo, "captura");
  const cancelado = registrarCancelamentoCom7({ confirmado: false });
  assert.equal(cancelado.liberada, false);
  assert.equal(cancelado.exclusiva, true);
  assert.equal(
    encerrarReservaCom7({ ...pedido("op-a"), comprovada: true, sessaoEncerrada: true, capturaAtiva: false }).codigo,
    "nao_comprovada"
  );
  assert.equal(registrarResultadoDesconhecidoCom7({ queda: true }).novaCobranca, false);
  assert.equal(reservarOperacaoCom7(pedido("op-b", "empresa-b", "caixa-2")).codigo, "reconciliacao");
  assert.equal(reconciliarReservaCom7({ origemNavegador: true, comprovada: true }).codigo, "navegador");
  const reconciliada = reconciliarReservaCom7({ comprovada: true });
  assert.equal(reconciliada.pagamentoRecebido, false);
  assert.equal(reconciliada.journalApagado, false);
  assert.equal(reconciliada.novaCobranca, false);
  assert.equal(conceder("op-d").codigo, "concedida");
  assert.equal(reservarOperacaoCom7(pedido("op-d")).codigo, "reservada");
  assert.equal(registrarCancelamentoCom7({ confirmado: true }).liberada, false);
  const liberada = encerrarReservaCom7({
    ...pedido("op-d"),
    comprovada: true,
    sessaoEncerrada: true,
    capturaAtiva: false,
    resultadoDesconhecido: false,
    autorizacaoFinanceira: false,
    cancelamentoNaoConfirmado: false,
  });
  assert.equal(liberada.liberada, true);
  assert.equal(liberada.pagamentoRecebido, false);
  assert.equal(liberada.journalApagado, false);
  assert.equal(exclusivaCom7("empresa-a", "caixa-1"), false);
  esquecerMenuConector();
});

test("o journal ilegível impede o menu sem apagar arquivo", async () => {
  const lidos = [];
  const avaliacao = await avaliarJournalMenu(["journal-a.json"], async (arquivo) => {
    lidos.push(arquivo);
    return { ok: false, codigo: "leitura", registro: null };
  });
  assert.deepEqual(lidos, ["journal-a.json"]);
  assert.equal(avaliacao.seguir, false);
  assert.equal(avaliacao.codigo, "leitura");
});
