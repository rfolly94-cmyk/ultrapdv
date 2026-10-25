import assert from "node:assert/strict";
import test from "node:test";

import { executarDiagnosticoHomologacao } from "./tef-diagnostico-homologacao.mjs";
import { horarioIdle, PWINFO, PWRET, SessaoPgWeb } from "./tef-pgweb.mjs";
import { criarSimuladorPgWeb } from "./tef-pgweb-simulador.mjs";

const depsDll = {
  executar: true,
  raiz: "C:\\UltraPDV",
  criarDiretorio: async () => {},
  verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
};

test("biblioteca já inicializada não chama SetEnvironment, Init nem End", async () => {
  const chamadas = [];
  const instancia = {
    inicializada: true,
    async setEnvironment() {
      chamadas.push("PW_iSetEnvironment");
      return -2494;
    },
    async init() {
      chamadas.push("PW_iInit");
      return -2494;
    },
    async ppCommTest() {
      chamadas.push("PW_iPPCommTest");
      return { codigo: 0, porta: 7, mensagem: "" };
    },
    async end() {
      chamadas.push("PW_End");
    },
  };
  let abriu = false;
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      ...depsDll,
      instancia,
      abrir: async () => {
        abriu = true;
        throw new Error("não deveria abrir outra instância");
      },
    }
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.dllInicializada, true);
  assert.equal(resultado.pinpadConectado, true);
  assert.equal(abriu, false);
  assert.deepEqual(chamadas, ["PW_iPPCommTest"]);
});

test("processo residente ocupado e transação ativa não chamam a DLL", async () => {
  const ocupado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      ...depsDll,
      instancia: { inicializada: true, ocupada: true },
      abrir: async () => {
        throw new Error("não deveria abrir");
      },
    }
  );
  assert.equal(ocupado.mensagem, "Transação em andamento");
  assert.equal(ocupado.fase, "transacao");

  const ativa = await executarDiagnosticoHomologacao(
    { acao: "identificar" },
    {
      ...depsDll,
      transacaoAtiva: true,
      abrir: async () => {
        throw new Error("não deveria abrir");
      },
    }
  );
  assert.equal(ativa.mensagem, "Transação em andamento");
  assert.equal(ativa.dllInicializada, false);
});

test("PinPad não encontrado distingue descoberta de biblioteca não inicializada", async () => {
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      ...depsDll,
      abrir: async () => ({
        async setEnvironment() {
          return 0;
        },
        async init() {
          return 0;
        },
        async ppCommTest() {
          return { codigo: PWRET.PPNOTFOUND, porta: 255, mensagem: "" };
        },
        async end() {
          throw new Error("PW_End não deve encerrar o diagnóstico");
        },
      }),
    }
  );
  assert.equal(resultado.codigoBiblioteca, PWRET.PPNOTFOUND);
  assert.equal(resultado.fase, "descoberta");
  assert.equal(resultado.dllInicializada, true);
  assert.equal(resultado.pinpadConectado, false);
  assert.match(resultado.mensagem, /PWRET_PPNOTFOUND/);
});

test("PW_iPPCommTest com porta identificada não chama PW_iPPEventLoop", async () => {
  const chamadas = [];
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      ...depsDll,
      pontoInstalado: true,
      abrir: async () => ({
        async init() {
          chamadas.push("PW_iInit");
          return 0;
        },
        async ppCommTest() {
          chamadas.push("PW_iPPCommTest");
          return { codigo: 0, porta: 7, mensagem: "PPC-930" };
        },
        async ppEventLoop() {
          chamadas.push("PW_iPPEventLoop");
          return { codigo: PWRET.TRNNOTINIT, display: "" };
        },
      }),
    }
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.codigoBiblioteca, 0);
  assert.equal(resultado.porta, 7);
  assert.equal(resultado.portaNome, "COM7");
  assert.equal(resultado.pinpadConectado, true);
  assert.equal(resultado.identificacao, "PPC-930");
  assert.deepEqual(chamadas, ["PW_iInit", "PW_iPPCommTest"]);
});

test("captura sem porta percorre PW_iPPEventLoop e não confirma a comunicação", async () => {
  const eventos = [PWRET.NOTHING, PWRET.DISPLAY, PWRET.OK];
  const chamadas = [];
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      ...depsDll,
      pontoInstalado: true,
      abrir: async () => ({
        async init() {
          chamadas.push("PW_iInit");
          return 0;
        },
        async ppCommTest() {
          chamadas.push("PW_iPPCommTest");
          return { codigo: 0, porta: null, mensagem: "" };
        },
        async ppEventLoop() {
          chamadas.push("PW_iPPEventLoop");
          return { codigo: eventos.shift(), display: "" };
        },
      }),
    }
  );
  assert.equal(resultado.ok, false);
  assert.equal(resultado.pinpadConectado, false);
  assert.match(resultado.mensagem, /sem informar a COM/);
  assert.deepEqual(chamadas, ["PW_iInit", "PW_iPPCommTest", "PW_iPPEventLoop", "PW_iPPEventLoop", "PW_iPPEventLoop"]);
});

test("menus, falha de host e confirmação simulada preservam valor, RESULTID e a sessão", async () => {
  const tef = new SessaoPgWeb({
    biblioteca: criarSimuladorPgWeb("aprovada"),
    dispositivoId: "disp-lab",
    capacidades: "1",
  });
  const inicio = await tef.inicializar({
    ambiente: "homologacao",
    diretorio: "C:\\nao-existe-ultrapdv\\ensaio",
    dispositivoId: "disp-lab",
  });
  assert.equal(inicio.ok, true);
  assert.equal(tef.eventos[0].funcao, "PW_iSetEnvironment");
  assert.equal(tef.eventos[1].funcao, "PW_iInit");
  const venda = await tef.vender({
    dispositivoId: "disp-lab",
    identificador: "VENDA-LAB",
    valorCentavos: 100,
    modalidade: "debito",
  });
  assert.equal(venda.codigo, PWRET.MOREDATA);
  assert.deepEqual(venda.captura.valores, ["1", "2"]);
  assert.deepEqual(venda.captura.opcoes, ["A vista", "Parcelado"]);
  assert.notEqual(venda.captura.valores[0], venda.captura.opcoes[0]);

  const host = new SessaoPgWeb({
    biblioteca: bibliotecaHost(),
    dispositivoId: "disp-lab",
    capacidades: "1",
  });
  await host.inicializar({
    ambiente: "homologacao",
    diretorio: "C:\\nao-existe-ultrapdv\\ensaio",
    dispositivoId: "disp-lab",
  });
  const recusa = await host.vender({
    dispositivoId: "disp-lab",
    identificador: "VENDA-HOST",
    valorCentavos: 100,
    modalidade: "debito",
  });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.mensagemHost, "ERRO INTERNO");
  assert.equal(recusa.resultadoId, "258");
  assert.equal(recusa.confirmacaoChamada, false);
  assert.equal(recusa.pago, false);

  const menu = tef.consultarCaptura();
  const seguida = await tef.responderCaptura({
    dispositivoId: "disp-lab",
    solicitacaoId: menu.solicitacaoId,
    indice: 0,
  });
  assert.equal(seguida.estado, "aguardando_confirmacao");
  assert.equal(seguida.pago, false);
  const paga = await tef.confirmar({ dispositivoId: "disp-lab" });
  assert.equal(paga.pago, true);
  assert.equal(tef.eventos.some((evento) => evento.funcao === "PW_iConfirmation"), true);
  assert.equal(tef.eventos.some((evento) => evento.funcao === "PW_iWaitConfirmation"), true);
  assert.equal(tef.eventos.some((evento) => evento.funcao === "PW_End"), false);
});

test("PW_iAddParam recusa texto fora de ASCII e o idle usa o horário de 12 dígitos", async () => {
  const biblioteca = criarSimuladorPgWeb("aprovada");
  assert.equal(await biblioteca.addParam(1, "ok"), PWRET.TRNNOTINIT);
  await biblioteca.newTransac(0x21);
  assert.equal(await biblioteca.addParam(1, "ok"), PWRET.OK);
  assert.equal(await biblioteca.addParam(1, "não"), PWRET.INVPARAM);
  assert.equal(horarioIdle("30"), null);
  assert.ok(horarioIdle("261018130000") instanceof Date);
  const tef = new SessaoPgWeb({ biblioteca, dispositivoId: "disp-lab", capacidades: "1" });
  const cedo = await tef.ocioso();
  assert.equal(cedo.executou, false);
});

test("a sessão residente agenda o idle, suspende na transação e retoma sem PW_End", async () => {
  const modulo = await import("./tef-teste-nativo-homologacao.mjs");
  const chamadas = [];
  let quando = "261018140000";
  const sessao = modulo.criarSessaoContinua();
  sessao.inicializada = true;
  sessao.agendarOciosidade = (fn, ms) => {
    chamadas.push(["agendar", ms]);
    return fn;
  };
  sessao.transporte = {
    async idleProc() {
      chamadas.push("PW_iIdleProc");
      quando = "261018160000";
      return 0;
    },
    async getResult() {
      chamadas.push("PW_iGetResult");
      return { codigo: 0, valor: quando };
    },
    async end() {
      chamadas.push("PW_End");
    },
  };
  await modulo.sincronizarOciosidadeResidente(sessao);
  assert.ok(sessao.proximaOciosidade instanceof Date);
  assert.equal(chamadas.some((item) => Array.isArray(item) && item[0] === "agendar"), true);
  sessao.viva = true;
  const durante = await modulo.pulsoOciosidadeResidente(sessao, new Date(2026, 9, 18, 15, 0, 0));
  assert.equal(durante.motivo, "transacao");
  assert.equal(chamadas.includes("PW_iIdleProc"), false);
  sessao.viva = false;
  const depois = await modulo.pulsoOciosidadeResidente(sessao, new Date(2026, 9, 18, 15, 0, 0));
  assert.equal(depois.executou, true);
  assert.equal(chamadas.filter((item) => item === "PW_iIdleProc").length, 1);
  assert.equal(chamadas.includes("PW_End"), false);
});

test("o agendador do conector não chama idle com transação ou diagnóstico aberto", async () => {
  const { criarAgendadorOciosidadeHomologacao } = await import("./tef-diagnostico-homologacao.mjs");
  const chamadas = [];
  let bloqueia = true;
  const biblioteca = {
    inicializada: true,
    async idleProc() {
      chamadas.push("PW_iIdleProc");
      return 0;
    },
    async getResult() {
      return { codigo: 0, valor: "261018180000" };
    },
  };
  const agendador = criarAgendadorOciosidadeHomologacao({
    lerBiblioteca: () => biblioteca,
    bloqueado: async () => bloqueia,
    agendar(fn) {
      chamadas.push("agendar");
      return fn;
    },
  });
  await agendador.sincronizar("261018130000");
  const parado = await agendador.pulsar(new Date(2026, 9, 18, 14, 0, 0));
  assert.equal(parado.motivo, "transacao");
  assert.equal(chamadas.includes("PW_iIdleProc"), false);
  bloqueia = false;
  const feito = await agendador.pulsar(new Date(2026, 9, 18, 14, 0, 0));
  assert.equal(feito.executou, true);
});

test("reinício do conector exige sessão ociosa e preserva o journal", async () => {
  const { avaliarReinicioHomologacao } = await import("./homologacao-servidor.mjs");
  const bloqueado = avaliarReinicioHomologacao({
    journal: { sessaoNativa: "residente", status: "iniciada" },
  });
  assert.equal(bloqueado.permitido, false);
  assert.equal(bloqueado.preservarJournal, true);
  const ocupado = avaliarReinicioHomologacao({ ocupacao: "diagnostico", journal: { status: "sem_autorizacao" } });
  assert.equal(ocupado.permitido, false);
  const livre = avaliarReinicioHomologacao({
    journal: { sessaoNativa: "encerrada", status: "sem_autorizacao" },
  });
  assert.equal(livre.permitido, true);
  assert.equal(livre.preservarJournal, true);
});

function bibliotecaHost() {
  const base = criarSimuladorPgWeb("aprovada");
  return {
    ...base,
    async execTransac() {
      return { codigo: -2596, captura: [] };
    },
    async getResult(info) {
      if (info === PWINFO.RESULTMSG) return { codigo: PWRET.OK, valor: "ERRO INTERNO" };
      if (info === PWINFO.RESULTID) return { codigo: PWRET.OK, valor: "258" };
      if (info === PWINFO.CNFREQ) return { codigo: PWRET.OK, valor: "0" };
      return { codigo: PWRET.NODATA, valor: "" };
    },
  };
}
