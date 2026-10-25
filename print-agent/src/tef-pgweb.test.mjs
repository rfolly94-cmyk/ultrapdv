import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { criarSimuladorPgWeb } from "./tef-pgweb-simulador.mjs";
import {
  PWCNF,
  PWINFO,
  PWRET,
  SessaoPgWeb,
  criarBibliotecaRealBloqueada,
  nomeRetorno,
} from "./tef-pgweb.mjs";

function sessao(roteiro, extras = {}) {
  return new SessaoPgWeb({
    biblioteca: criarSimuladorPgWeb(roteiro),
    dispositivoId: "disp-1",
    capacidades: "1",
    ...extras,
  });
}

async function pronta(alvo, roteiro = "aprovada") {
  const criada = alvo ?? sessao(roteiro);
  const inicio = await criada.inicializar({
    ambiente: "homologacao",
    diretorio: "C:\\ProgramData\\UltraPDV\\TEF\\Producao",
    dispositivoId: "disp-1",
  });
  assert.equal(inicio.ok, true);
  assert.equal(inicio.warsaw, false);
  assert.equal(inicio.pago, false);
  return criada;
}

test("constantes do header e bloqueio da DLL real", () => {
  assert.equal(nomeRetorno(PWRET.MOREDATA), "PWRET_MOREDATA");
  assert.equal(PWRET.WRITERR, -2485);
  assert.equal(PWRET.INVCALL, -2494);
  assert.equal(PWCNF.CNF_MANU_AUT, 0x00003221);
  assert.throws(() => new SessaoPgWeb({ biblioteca: criarBibliotecaRealBloqueada(), dispositivoId: "d" }));
});

test("venda aprovada só fica paga depois de PW_iConfirmation e PW_iWaitConfirmation", async () => {
  const tef = await pronta();
  const venda = await tef.vender({
    dispositivoId: "disp-1",
    identificador: "VENDA-1",
    valorCentavos: 1500,
    modalidade: "credito",
    parcelas: 2,
  });
  assert.equal(venda.codigo, PWRET.MOREDATA);
  assert.equal(venda.pago, false);
  const menu = tef.consultarCaptura();
  assert.equal(menu.opcoes.length, 2);
  const seguida = await tef.responderCaptura({
    dispositivoId: "disp-1",
    solicitacaoId: menu.solicitacaoId,
    indice: 0,
  });
  assert.equal(seguida.estado, "aguardando_confirmacao");
  assert.equal(seguida.resultado.sucessoTransacao, true);
  assert.equal(seguida.resultado.tipoCartao, null);
  assert.equal(seguida.pago, false);
  assert.equal(tef.journal.reqNum, "1001");
  const outra = await tef.vender({
    dispositivoId: "disp-1",
    identificador: "VENDA-2",
    valorCentavos: 100,
    modalidade: "debito",
  });
  assert.equal(outra.codigo, "PENDENTE");
  const paga = await tef.confirmar({ dispositivoId: "disp-1" });
  assert.equal(paga.pago, true);
  assert.equal(paga.codigo, PWRET.OK);
  assert.equal(tef.eventos.some((evento) => evento.funcao === "PW_iWaitConfirmation"), true);
  assert.equal(tef.eventos.some((evento) => evento.funcao === "PW_iIdleProc" && evento.extra), false);
});

test("recusa, timeout, dispositivo estranho e impressão não desfazem com código errado", async () => {
  const recusa = await pronta(undefined, "recusada");
  const negada = await recusa.vender({
    dispositivoId: "disp-1",
    identificador: "VENDA-R",
    valorCentavos: 500,
    modalidade: "debito",
  });
  assert.equal(negada.resultado.sucessoTransacao, false);
  assert.equal(negada.pago, false);
  assert.equal(recusa.journal, null);

  const estourou = await pronta(undefined, "timeout");
  const timeout = await estourou.vender({
    dispositivoId: "disp-1",
    identificador: "VENDA-T",
    valorCentavos: 500,
    modalidade: "debito",
  });
  assert.equal(timeout.codigo, PWRET.TIMEOUT);
  assert.match(timeout.mensagem, /PW_iExecTransac/);

  const alheia = await pronta().then((alvo) =>
    alvo.vender({
      dispositivoId: "outro",
      identificador: "VENDA-X",
      valorCentavos: 500,
      modalidade: "debito",
    })
  );
  assert.equal(alheia.codigo, "DISPOSITIVO");

  const impressao = await pronta();
  await impressao.vender({
    dispositivoId: "disp-1",
    identificador: "VENDA-I",
    valorCentavos: 500,
    modalidade: "debito",
  });
  const menu = impressao.consultarCaptura();
  await impressao.responderCaptura({
    dispositivoId: "disp-1",
    solicitacaoId: menu.solicitacaoId,
    indice: 0,
  });
  const desfaz = await impressao.desfazer({ dispositivoId: "disp-1", motivo: "impressao" });
  assert.equal(desfaz.ok, false);
  assert.match(desfaz.mensagem, /reimpressão/);
  const queda = await impressao.desfazer({ dispositivoId: "disp-1", motivo: "queda" });
  assert.equal(queda.desfeita, true);
  assert.equal(queda.pago, false);
  assert.equal(queda.status, PWCNF.REV_PWR_AUT);
});

test("pinpad não cobra e AUTCAP enviado é só o valor fixo da especificação", async () => {
  const tef = await pronta(undefined, "pinpad_ausente");
  const ausente = await tef.pinpad({ dispositivoId: "disp-1", porta: 1 });
  assert.equal(ausente.codigo, PWRET.PPNOTFOUND);
  assert.equal(ausente.cobranca, false);
  assert.equal(ausente.pago, false);

  const enviados = [];
  const biblioteca = criarSimuladorPgWeb("aprovada");
  const original = biblioteca.addParam.bind(biblioteca);
  biblioteca.addParam = async (info, valor) => {
    enviados.push([info, valor]);
    return original(info, valor);
  };
  const presumido = new SessaoPgWeb({
    biblioteca,
    dispositivoId: "disp-1",
    capacidades: "1",
  });
  await presumido.inicializar({
    ambiente: "homologacao",
    diretorio: "C:\\ProgramData\\UltraPDV\\TEF\\Producao",
    dispositivoId: "disp-1",
  });
  const venda = await presumido.vender({
    dispositivoId: "disp-1",
    identificador: "VENDA-C",
    valorCentavos: 100,
    modalidade: "credito",
    capacidades: "512",
  });
  assert.equal(venda.codigo, PWRET.MOREDATA);
  assert.deepEqual(
    enviados.filter(([info]) => info === PWINFO.AUTCAP).map(([, valor]) => valor),
    ["4"]
  );
});

test("journal em disco recupera a confirmação sem gravar dado sensível", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-pgweb-"));
  const arquivo = path.join(pasta, "tef-pgweb-journal.json");
  try {
    const origem = new SessaoPgWeb({
      biblioteca: criarSimuladorPgWeb("aprovada"),
      dispositivoId: "disp-1",
      capacidades: "1",
      arquivo,
    });
    await origem.inicializar({
      ambiente: "homologacao",
      diretorio: "C:\\ProgramData\\UltraPDV\\TEF\\Producao",
      dispositivoId: "disp-1",
    });
    await origem.vender({
      dispositivoId: "disp-1",
      identificador: "VENDA-J",
      valorCentavos: 900,
      modalidade: "debito",
    });
    const durante = JSON.parse(await readFile(arquivo, "utf8"));
    assert.equal(durante.status, "aguardando_captura");
    assert.equal(durante.identificador, "VENDA-J");
    const menu = origem.consultarCaptura();
    await origem.responderCaptura({
      dispositivoId: "disp-1",
      solicitacaoId: menu.solicitacaoId,
      indice: 0,
    });
    const gravado = await readFile(arquivo, "utf8");
    assert.match(gravado, /1001/);
    assert.doesNotMatch(gravado, /PAN|senha|42741754000142/i);
    const retomada = new SessaoPgWeb({
      biblioteca: criarSimuladorPgWeb("aprovada"),
      dispositivoId: "disp-1",
      capacidades: "1",
      arquivo,
    });
    const inicio = await retomada.inicializar({
      ambiente: "homologacao",
      diretorio: "C:\\ProgramData\\UltraPDV\\TEF\\Producao",
      dispositivoId: "disp-1",
    });
    assert.equal(inicio.estado, "aguardando_confirmacao");
    const paga = await retomada.confirmar({ dispositivoId: "disp-1" });
    assert.equal(paga.pago, true);
    assert.equal(await readFile(arquivo, "utf8"), "null");
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test("PWRET_NOTHING repete a execução e a instalação usa o mesmo ciclo", async () => {
  const tef = await pronta(undefined, "nothing");
  const venda = await tef.vender({
    dispositivoId: "disp-1",
    identificador: "VENDA-N",
    valorCentavos: 100,
    modalidade: "debito",
  });
  assert.equal(venda.codigo, PWRET.MOREDATA);
  assert.equal(tef.eventos.filter((evento) => evento.nome === "PWRET_NOTHING").length, 1);

  const instala = await pronta();
  const ponto = await instala.instalar({
    dispositivoId: "disp-1",
    ponto: "6696546",
    cnpj: "42741754000142",
  });
  assert.equal(ponto.codigo, PWRET.MOREDATA);
});

test("PW_iPPCommTest com PWRET_OK repete o event loop até sair de NOTHING e DISPLAY", async () => {
  const biblioteca = criarSimuladorPgWeb("aprovada");
  const mensagens = [];
  biblioteca.ppCommTest = async () => ({
    codigo: PWRET.OK,
    mensagem: "m".repeat(120),
    porta: 7,
  });
  biblioteca.ppEventLoop = async () => {
    mensagens.push("volta");
    if (mensagens.length === 1) return { codigo: PWRET.NOTHING, display: "" };
    if (mensagens.length === 2) return { codigo: PWRET.DISPLAY, display: "Aguardando o pinpad" };
    return { codigo: PWRET.OK, display: "" };
  };
  const tef = new SessaoPgWeb({
    biblioteca,
    dispositivoId: "disp-1",
    capacidades: "1",
  });
  await tef.inicializar({
    ambiente: "homologacao",
    diretorio: "C:\\ProgramData\\UltraPDV\\TEF\\Producao",
    dispositivoId: "disp-1",
  });
  const resultado = await tef.pinpad({ dispositivoId: "disp-1" });
  assert.equal(mensagens.length, 3);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.pago, false);
  assert.equal(resultado.cobranca, false);
  assert.equal(resultado.mensagem.length, 120);
  assert.equal(tef.eventos.filter((evento) => evento.funcao === "PW_iPPEventLoop").length, 3);
});
