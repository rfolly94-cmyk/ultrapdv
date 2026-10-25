import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { accessSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ABI_COMPROVADO, assinaturaNativa, ASSINATURAS_NATIVAS, LAYOUT_HOMOLOGADO, PGWEB2_PRODUCAO, PWINFO, PWRET, SEQUENCIA_REFERENCIAS_PENDENTES } from "./tef-pgweb.mjs";
import { classificarSituacaoJournal, encerramentoCapturaValido, gravarEtapaAntesDaExecucao, lerPendenciaTef, lerProvaEtapaVenda, persistirResultadoTerminal, registrarEncerramentoCaptura } from "./tef-pendencia.mjs";
import { escreverMenuPwGetData, TAMANHO_PW_GETDATA } from "./tef-getdata.mjs";
import { classificarPendenciaNativa } from "./tef-venda-nativa.mjs";
import {
  acompanharCapturaPinpad,
  atenderMenuConector,
  seguirCapturaPinpad,
  assinarAutorizacaoOperacao,
  decidirNaSessaoResidente,
  esquecerMenuConector,
  avaliarJournalMenu,
  executarDecisaoFinanceira,
  executarTransacaoHomologacao,
  execucaoFisicaPermitida,
  FRASE_MENU_CONECTOR,
  listarPendenciasFisicas,
  prepararTransporteHomologacao,
  recuperarSessaoAbertaSemExecucao,
  transporteNativoHomologacao,
} from "./tef-menu-conector.mjs";

const par = generateKeyPairSync("ed25519");
const publica = par.publicKey.export({ type: "spki", format: "pem" });
const privada = par.privateKey.export({ type: "pkcs8", format: "pem" });
const agora = 1_800_000_000_000;
const dispositivo = "33333333-3333-4333-8333-333333333333";

const menu = {
  codigo: PWRET.MOREDATA,
  captura: [{
    wIdentificador: 0x36,
    bTipoDeDado: 1,
    bNumOpcoesMenu: 1,
    szPrompt: "PROVEDOR",
    vszTextoMenu: ["C6 PAY"],
    vszValorMenu: ["9691"],
  }],
};

function pedido(extra = {}) {
  return {
    ambiente: "homologacao",
    empresaId: "empresa-a",
    dispositivoId: dispositivo,
    terminalCodigo: "caixa-lab",
    posid: "ponto-lab",
    valorCentavos: 100,
    idempotencyKey: "op-exec-1",
    expiraEm: agora + 60_000,
    ...extra,
  };
}

function biblioteca(eventos, extras = {}) {
  let etapa = 0;
  const chamadas = [];
  const refs = {
    [PWINFO.REQNUM]: "11",
    [PWINFO.AUTLOCREF]: "22",
    [PWINFO.AUTEXTREF]: "33",
    [PWINFO.VIRTMERCH]: "44",
    [PWINFO.AUTHSYST]: "SETIS",
    ...(extras.refs ?? {}),
  };
  return {
    chamadas,
    residente: true,
    homologacao: true,
    origem: "conector",
    real: true,
    async newTransac() {
      chamadas.push("PW_iNewTransac");
      return extras.nova ?? 0;
    },
    async addParam() {
      chamadas.push("PW_iAddParam");
      return 0;
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      const evento = eventos[etapa] ?? { codigo: PWRET.FROMHOST ?? -2596, captura: [] };
      etapa += 1;
      return evento;
    },
    async getResult(info) {
      chamadas.push("PW_iGetResult");
      return { codigo: 0, valor: refs[info] ?? "" };
    },
    async ppAbort() {
      chamadas.push("PW_iPPAbort");
      return 0;
    },
    async ppEventLoop() {
      chamadas.push("PW_iPPEventLoop");
      return { codigo: PWRET.CANCEL, display: "operacao cancelada" };
    },
    async confirmation(status) {
      chamadas.push(["PW_iConfirmation", status]);
      return extras.confirmation ?? 0;
    },
    async waitConfirmation() {
      chamadas.push("PW_iWaitConfirmation");
      return extras.wait ?? 0;
    },
  };
}

function entrada(lib, journal = { seguir: true }) {
  return { journal, pontoInstalado: true, dllOk: true, biblioteca: lib, portaPinpadOcupada: false };
}

async function preparar(base, lib) {
  return prepararTransporteHomologacao({
    pedido: base,
    assinatura: assinarAutorizacaoOperacao(privada, base),
    chavePublicaPem: publica,
    agora,
    entrada: entrada(lib),
  });
}

async function executar(base, lib, journal) {
  return executarTransacaoHomologacao({
    pedido: base,
    assinatura: assinarAutorizacaoOperacao(privada, base),
    chavePublicaPem: publica,
    agora,
    frase: FRASE_MENU_CONECTOR,
    entrada: entrada(lib, journal),
  });
}

test("a venda oficial não exige prova1817 nem um segundo acionamento", () => {
  const servidor = readFileSync(fileURLToPath(new URL("./server.mjs", import.meta.url)), "utf8");
  const inicio = servidor.indexOf('if (req.method === "POST" && url.pathname === "/tef/venda")');
  const fim = servidor.indexOf('if (req.method === "POST" && url.pathname === "/tef/homologacao/menu")');
  const venda = servidor.slice(inicio, fim);
  assert.equal(venda.includes("prova1817"), false);
  assert.equal(venda.includes("EVIDENCIA_SESSAO_1817"), false);
  assert.match(venda, /recuperarSessaoAbertaSemExecucao/);
  assert.match(venda, /executarTransacaoHomologacao/);
  assert.match(venda, /acao === "responder"/);
});

test("a execução física não depende de ABI_COMPROVADO nem de PWL_Type.h", () => {
  assert.equal(PGWEB2_PRODUCAO, false);
  const pendencias = listarPendenciasFisicas({
    servidor: "homologacao",
    journal: { seguir: true },
    autorizacaoServidor: true,
    portaPinpadOcupada: false,
  });
  assert.equal(pendencias.some((item) => item.includes("ABI_COMPROVADO")), false);
  assert.equal(pendencias.some((item) => item.includes("PWL_Type")), false);
  assert.equal(pendencias.some((item) => item.includes("PW_iPPAbort")), false);
  assert.equal(pendencias.some((item) => item.includes("PW_iConfirmation")), false);
  assert.equal(execucaoFisicaPermitida({
    servidor: "homologacao",
    journal: { seguir: true },
    autorizacaoServidor: true,
  }), true);
  assert.equal(execucaoFisicaPermitida({
    servidor: "homologacao",
    journal: { seguir: false },
    autorizacaoServidor: true,
  }), false);
});

test("o contrato nativo permanece fechado e as assinaturas conferem com o header", () => {
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  assert.equal(PGWEB2_PRODUCAO, false);
  assert.equal(TAMANHO_PW_GETDATA > 0, true);
  const header = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../20260923-Integracao-PGWebLib_v4.1.50.924/PGWebLib.h"),
    "latin1"
  );
  assert.match(header, /extern Int16 PW_EXPORT PW_iNewTransac \(Byte bOper\);/);
  assert.match(header, /extern Int16 PW_EXPORT PW_iExecTransac \(PW_GetData vstParam\[\], Int16 \*piNumParam\);/);
  assert.match(header, /extern Int16 PW_EXPORT PW_iGetResult \(Int16 iInfo, char \*pszData, Uint32 ulDataSize\);/);
  assert.match(header, /extern Int16 PW_EXPORT PW_iConfirmation \(Uint32 ulResult,/);
  assert.equal(ASSINATURAS_NATIVAS.PW_iNewTransac, "int16 __stdcall PW_iNewTransac(uint8)");
  assert.equal(ASSINATURAS_NATIVAS.PW_iExecTransac, "int16 __stdcall PW_iExecTransac(_Out_ uint8 *capturas, _Inout_ int16 *quantidade)");
  assert.equal(ASSINATURAS_NATIVAS.PW_iConfirmation, "int16 __stdcall PW_iConfirmation(uint32, str, str, str, str, str)");
});

test("preparação válida não chama PW_iNewTransac", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu]);
  const preparo = await preparar(pedido(), lib);
  assert.equal(preparo.codigo, "preparada");
  assert.equal(preparo.fase, "preparada");
  assert.equal(preparo.transacaoIniciada, false);
  assert.equal(preparo.pagamentoRecebido, false);
  assert.equal(preparo.comandoDll, false);
  assert.equal(lib.chamadas.includes("PW_iNewTransac"), false);
});

test("autorização inválida não inicia transação", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu]);
  const base = pedido({ idempotencyKey: "op-invalida" });
  await preparar(base, lib);
  const recusa = await executarTransacaoHomologacao({
    pedido: base,
    assinatura: "assinatura-invalida",
    chavePublicaPem: publica,
    agora,
    frase: FRASE_MENU_CONECTOR,
    entrada: entrada(lib),
  });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.codigo, "assinatura");
  assert.equal(recusa.transacaoIniciada, false);
  assert.equal(lib.chamadas.includes("PW_iNewTransac"), false);
});

test("a ação explícita inicia uma transação nativa sem receber pagamento", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu]);
  const base = pedido({ idempotencyKey: "op-inicio" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  assert.equal(inicio.ok, true);
  assert.equal(inicio.transacaoIniciada, true);
  assert.equal(inicio.simulado, false);
  assert.equal(inicio.nativo, true);
  assert.equal(inicio.comandoDll, true);
  assert.equal(inicio.execucaoFisica, false);
  assert.equal(inicio.pagamentoRecebido, false);
  assert.equal(inicio.podeFinalizar, false);
  assert.equal(inicio.nfcEEmitida, false);
  assert.equal(inicio.fase, "menu");
  assert.equal(inicio.menu.opcoes[0].valor, "9691");
  assert.equal(lib.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
});

test("menu e pinpad permanecem na mesma transação", async () => {
  esquecerMenuConector();
  const cartao = {
    codigo: PWRET.MOREDATA,
    captura: [{ wIdentificador: 0x2f, bTipoDeDado: 3, szPrompt: "Insira ou passe o cartão", vszTextoMenu: [], vszValorMenu: [] }],
  };
  const lib = biblioteca([menu, cartao]);
  const base = pedido({ idempotencyKey: "op-menu" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  const seguida = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  assert.equal(seguida.fase, "pinpad");
  assert.equal(seguida.pinpad.prompt, "Insira ou passe o cartão");
  assert.equal(seguida.pagamentoRecebido, false);
  assert.equal(lib.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
});

test("aprovação não recebe pagamento antes da confirmação e recusa não é sucesso", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu, { codigo: 0, captura: [] }]);
  const base = pedido({ idempotencyKey: "op-aprovada" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  const aprovada = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  assert.equal(aprovada.codigo, "aprovada");
  assert.equal(aprovada.pagamentoRecebido, false);
  assert.equal(aprovada.podeFinalizar, false);
  const confirmada = await decidirNaSessaoResidente(base.empresaId, base.terminalCodigo, "confirmar");
  assert.equal(confirmada.codigo, "confirmada");
  assert.equal(confirmada.pagamentoRecebido, true);
  assert.equal(confirmada.podeFinalizar, false);
  assert.equal(confirmada.nfcEEmitida, false);

  esquecerMenuConector();
  const recusaLib = biblioteca([menu, { codigo: -2598, captura: [] }]);
  const recusaBase = pedido({ idempotencyKey: "op-recusa" });
  await preparar(recusaBase, recusaLib);
  const aberta = await executar(recusaBase, recusaLib);
  const recusada = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: recusaBase.empresaId,
    terminalCodigo: recusaBase.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: aberta.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  assert.equal(recusada.ok, false);
  assert.equal(recusada.codigo, "recusa");
  assert.equal(recusada.pagamentoRecebido, false);
});

test("PWINFO_CNFREQ 1 confirma uma vez e leitura inválida não confirma nem desfaz", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu, { codigo: 0, captura: [] }], { refs: { [PWINFO.CNFREQ]: "1" } });
  const base = pedido({ idempotencyKey: "op-cnf" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  const aprovada = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  assert.equal(aprovada.pagamentoRecebido, true);
  assert.equal(aprovada.confirmacaoChamada, true);
  assert.equal(lib.chamadas.filter((item) => Array.isArray(item) && item[0] === "PW_iConfirmation").length, 1);

  esquecerMenuConector();
  const sem = biblioteca([menu, { codigo: 0, captura: [] }]);
  sem.getResult = async (info) => {
    sem.chamadas.push("PW_iGetResult");
    if (info === PWINFO.CNFREQ) return { codigo: PWRET.NODATA, valor: "0" };
    return { codigo: 0, valor: { [PWINFO.REQNUM]: "11", [PWINFO.AUTLOCREF]: "22", [PWINFO.AUTEXTREF]: "33", [PWINFO.VIRTMERCH]: "44", [PWINFO.AUTHSYST]: "SETIS" }[info] ?? "" };
  };
  const semBase = pedido({ idempotencyKey: "op-cnf-nodata" });
  await preparar(semBase, sem);
  const aberta = await executar(semBase, sem);
  const negada = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: semBase.empresaId,
    terminalCodigo: semBase.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: aberta.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  assert.equal(negada.pagamentoRecebido, false);
  assert.equal(negada.confirmacaoChamada, false);
  assert.equal(sem.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iConfirmation"), false);
  assert.equal(sem.chamadas.includes("PW_iPPAbort"), false);
});

test("cancelamento no pinpad não marca pagamento", async () => {
  esquecerMenuConector();
  const cartao = {
    codigo: PWRET.MOREDATA,
    captura: [{ wIdentificador: 0x2f, bTipoDeDado: 3, szPrompt: "Insira ou passe o cartão", vszTextoMenu: [], vszValorMenu: [] }],
  };
  const lib = biblioteca([menu, cartao]);
  const base = pedido({ idempotencyKey: "op-cancelar" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  const cancelada = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "cancelar",
    frase: FRASE_MENU_CONECTOR,
    journal: { seguir: true },
  });
  assert.equal(cancelada.codigo, "sem_captura");
  assert.equal(cancelada.pagamentoRecebido, false);
  assert.equal(lib.chamadas.includes("PW_iPPAbort"), false);
  let abortou = false;
  lib.ppGetCard = async () => {
    lib.chamadas.push("PW_iPPGetCard");
    return 0;
  };
  lib.ppAbort = async () => {
    lib.chamadas.push("PW_iPPAbort");
    abortou = true;
    return 0;
  };
  lib.ppEventLoop = async () => {
    lib.chamadas.push("PW_iPPEventLoop");
    return { codigo: abortou ? PWRET.CANCEL : PWRET.NOTHING, display: "operacao cancelada" };
  };
  const coleta = acompanharCapturaPinpad(base.empresaId, base.terminalCodigo);
  await new Promise((resolver) => setTimeout(resolver, 20));
  const interrupcao = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "cancelar",
    frase: FRASE_MENU_CONECTOR,
    journal: { seguir: true },
  });
  assert.equal(interrupcao.codigo, "interrupcao_solicitada");
  const resultado = await coleta;
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.podeFinalizar, false);
  assert.equal(resultado.nfcEEmitida, false);
  assert.equal(lib.chamadas.includes("PW_iPPAbort"), true);
  assert.equal(resultado.evento, PWRET.CANCEL);
  assert.equal(lib.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
});

test("PWRET_FROMHOST sem prova financeira permanece desconhecido e preserva o journal", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-fromhost-"));
  const arquivo = path.join(pasta, "tef-journal-resultado-desconhecido.json");
  const lib = biblioteca([menu, { codigo: -2596, captura: [] }]);
  const base = pedido({ idempotencyKey: "op-fromhost" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  const host = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
    arquivoJournal: arquivo,
    idempotencyKey: base.idempotencyKey,
    valorCentavos: base.valorCentavos,
  });
  assert.equal(host.codigo, "desconhecido");
  assert.equal(host.pagamentoRecebido, false);
  assert.equal(host.journalApagado, false);
  assert.equal(host.novaCobranca, false);
  assert.equal(host.journalGravado, true);
  const texto = await readFile(arquivo, "utf8");
  assert.match(texto, /resultado_desconhecido/);
  assert.match(texto, /op-fromhost/);
  const outra = biblioteca([menu]);
  const repetida = await executar(pedido({ idempotencyKey: "op-fromhost-2" }), outra);
  assert.equal(repetida.codigo, "desconhecido");
  assert.equal(outra.chamadas.includes("PW_iNewTransac"), false);
  esquecerMenuConector();
  const journal = await avaliarJournalMenu([arquivo]);
  assert.equal(journal.seguir, false);
  const depois = await executar(pedido({ idempotencyKey: "op-fromhost-3" }), biblioteca([menu]), journal);
  assert.equal(depois.ok, false);
  assert.equal(depois.pagamentoRecebido, false);
  accessSync(arquivo);
});

test("timeout não vira recusa e bloqueia nova cobrança", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu, { codigo: PWRET.TIMEOUT, captura: [] }]);
  const base = pedido({ idempotencyKey: "op-timeout" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  const queda = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  assert.equal(queda.codigo, "desconhecido");
  assert.equal(queda.pagamentoRecebido, false);
  const outra = biblioteca([menu]);
  const repetida = await executar(pedido({ idempotencyKey: "op-timeout-2" }), outra, { seguir: true });
  assert.equal(repetida.codigo, "desconhecido");
  assert.equal(outra.chamadas.includes("PW_iNewTransac"), false);
});

test("a mesma autorização não inicia duas transações", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu]);
  const base = pedido({ idempotencyKey: "op-idem" });
  await preparar(base, lib);
  const primeira = await executar(base, lib);
  assert.equal(primeira.transacaoIniciada, true);
  const segunda = await executar(base, lib);
  assert.equal(segunda.ok, false);
  assert.equal(segunda.transacaoIniciada, false);
  assert.equal(lib.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
});

test("reinício sem journal seguro não chama a DLL de novo", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu]);
  const base = pedido({ idempotencyKey: "op-restart" });
  const bloqueada = await executar(base, lib, {
    seguir: false,
    codigo: "desconhecido",
    mensagem: "Há resultado desconhecido no journal. Nenhuma nova cobrança foi iniciada.",
  });
  assert.equal(bloqueada.ok, false);
  assert.equal(lib.chamadas.includes("PW_iNewTransac"), false);
  esquecerMenuConector();
  const outra = biblioteca([menu]);
  const semMemoria = await executar(pedido({ idempotencyKey: "op-restart-2" }), outra);
  assert.equal(semMemoria.codigo, "ausente");
  assert.equal(outra.chamadas.includes("PW_iNewTransac"), false);
});

test("desfazimento confirmado não recebe pagamento", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu, { codigo: 0, captura: [] }]);
  const base = pedido({ idempotencyKey: "op-desfaz" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  const desfeita = await decidirNaSessaoResidente(base.empresaId, base.terminalCodigo, "desfazer");
  assert.equal(desfeita.codigo, "desfeita");
  assert.equal(desfeita.pagamentoRecebido, false);
  assert.equal(desfeita.journalApagado, false);
  assert.equal(lib.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iConfirmation"), true);
});

test("PW_iNewTransac 0 e PW_iExecTransac recebem o buffer oficial", async () => {
  esquecerMenuConector();
  const vistos = [];
  const ponteiro = (memoria, quantidade) => {
    vistos.push([Buffer.isBuffer(memoria), Array.isArray(quantidade), quantidade?.[0], memoria?.length]);
    escreverMenuPwGetData(memoria, 0, {
      identificador: 0x36,
      prompt: "PROVEDOR",
      textos: ["C6 PAY"],
      valores: ["9691"],
    });
    quantidade[0] = 1;
    return PWRET.MOREDATA;
  };
  const execTransac = (...argumentos) => ponteiro(...argumentos);
  Object.defineProperties(execTransac, {
    assinatura: { value: assinaturaNativa("PW_iExecTransac") },
    ponteiro: { value: ponteiro },
  });
  const lib = biblioteca([menu]);
  lib.execTransac = execTransac;
  const base = pedido({ idempotencyKey: "op-buffer" });
  await preparar(base, lib);
  const inicio = await executar(base, lib);
  assert.equal(lib.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(inicio.codigo, "captura");
  assert.equal(inicio.menu.opcoes[0].valor, "9691");
  assert.deepEqual(vistos[0], [true, true, 9, 9 * TAMANHO_PW_GETDATA]);
  assert.equal(lib.chamadas.includes("PW_iConfirmation"), false);
  esquecerMenuConector();
});

test("falha entre NewTransac e ExecTransac não vira resultado financeiro desconhecido", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-etapa-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const lib = biblioteca([menu]);
  lib.execTransac = async () => {
    throw new Error("assinatura");
  };
  const base = pedido({ idempotencyKey: "op-entre" });
  await preparar(base, lib);
  const falha = await executarTransacaoHomologacao({
    pedido: base,
    assinatura: assinarAutorizacaoOperacao(privada, base),
    chavePublicaPem: publica,
    agora,
    frase: FRASE_MENU_CONECTOR,
    entrada: { ...entrada(lib), arquivoEtapa: arquivo },
  });
  assert.equal(falha.codigo, "antes_da_execucao");
  assert.notEqual(falha.codigo, "desconhecido");
  assert.equal(falha.pagamentoRecebido, false);
  assert.equal(falha.journalApagado, false);
  assert.equal(lib.chamadas.includes("PW_iConfirmation"), false);
  assert.equal(lib.chamadas.includes("PW_iPPAbort"), false);
  const texto = await readFile(arquivo, "utf8");
  assert.match(texto, /op-entre/);
  assert.match(texto, /falha_antes_da_execucao|apos_PW_iNewTransac/);
  assert.equal(texto.includes("PW_iConfirmation"), false);
  const outra = biblioteca([menu]);
  const repetida = await executar(pedido({ idempotencyKey: "op-entre-2" }), outra);
  assert.equal(repetida.codigo, "sessao_aberta");
  assert.equal(outra.chamadas.includes("PW_iNewTransac"), false);
  const recuperacao = await recuperarSessaoAbertaSemExecucao({
    journal: { retornoNewTransac: 0, executada: false, identificador: "op-entre", correlationId: "op-entre" },
    transporte: outra,
    transacaoLocalAberta: true,
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
  });
  assert.equal(recuperacao.codigo, "sessao_local");
  assert.equal(recuperacao.bloqueioRemovido, false);
  assert.equal(recuperacao.confirmacaoChamada, false);
  assert.equal(recuperacao.ppAbortChamado, false);
  assert.equal(outra.chamadas.includes("PW_iConfirmation"), false);
  const ainda = await executar(pedido({ idempotencyKey: "op-entre-3" }), biblioteca([menu]));
  assert.equal(ainda.codigo, "sessao_aberta");
  esquecerMenuConector();
});

test("recuperação sem execução lê SERVERPND e não confirma", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-recuperacao-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const transporte = {
    chamadas: [],
    async getResult(info) {
      this.chamadas.push(["PW_iGetResult", info]);
      if (info === PWINFO.SERVERPND) return { codigo: PWRET.OK, valor: "0" };
      if (SEQUENCIA_REFERENCIAS_PENDENTES.some((tag) => tag.info === info)) return { codigo: PWRET.OK, valor: "" };
      return { codigo: PWRET.INVCALL, valor: "inesperada" };
    },
    async confirmation() {
      this.chamadas.push("PW_iConfirmation");
      return 0;
    },
    async ppAbort() {
      this.chamadas.push("PW_iPPAbort");
      return 0;
    },
    async newTransac() {
      this.chamadas.push("PW_iNewTransac");
      return 0;
    },
  };
  const recuperacao = await recuperarSessaoAbertaSemExecucao({
    journal: { retornoNewTransac: 0, executada: false, identificador: "sessao-1817-homologacao", correlationId: "sessao-1817-homologacao" },
    transporte,
    transacaoLocalAberta: false,
    arquivo,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(recuperacao.ok, true);
  assert.equal(recuperacao.codigo, "encerrada");
  assert.equal(recuperacao.confirmacaoChamada, false);
  assert.equal(recuperacao.novaCobranca, false);
  assert.equal(recuperacao.journalApagado, false);
  assert.equal(recuperacao.referenciasPresentes, false);
  assert.equal(transporte.chamadas.some((item) => item === "PW_iConfirmation" || item === "PW_iPPAbort" || item === "PW_iNewTransac"), false);
  assert.deepEqual(
    transporte.chamadas.map((item) => item[1]),
    [PWINFO.SERVERPND, ...SEQUENCIA_REFERENCIAS_PENDENTES.map((tag) => tag.info)],
  );
  const prova = await lerProvaEtapaVenda(arquivo);
  assert.equal(prova.prova1817, true);
  const texto = await readFile(arquivo, "utf8");
  assert.match(texto, /sessao_tecnica_incompleta/);
  assert.equal(texto.includes("9691"), false);
  const pendencia = classificarPendenciaNativa({ status: "sessao_aberta_sem_execucao", retornoNewTransac: 0, executada: false });
  assert.equal(pendencia.confirmar, false);
  assert.equal(pendencia.desfazer, false);
  assert.equal(pendencia.acao, "bloquear");
  esquecerMenuConector();
});

test("falha antes de PW_iNewTransac não bloqueia outra venda e o journal permanece", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-tecnica-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const gravado = await gravarEtapaAntesDaExecucao(arquivo, {
    identificador: "op-tecnica",
    correlationId: "op-tecnica",
    valor: 100,
    etapa: "antes_de_PW_iNewTransac",
    retornoNewTransac: null,
    executada: false,
  });
  assert.equal(gravado.gravado, true);
  assert.equal(gravado.journalApagado, false);
  const lido = await lerPendenciaTef(arquivo);
  assert.equal(lido.falhaTecnica, true);
  assert.equal(lido.abertaSemExecucao, undefined);
  const journal = await avaliarJournalMenu([arquivo]);
  assert.equal(journal.seguir, true);
  const texto = await readFile(arquivo, "utf8");
  assert.match(texto, /falha_tecnica_antes_da_transacao/);
  assert.equal(texto.includes("execucao_iniciada"), false);
  assert.equal(
    classificarPendenciaNativa({ status: "sessao_aberta_sem_execucao", retornoNewTransac: null, executada: false }).motivo,
    "falha_tecnica"
  );
  assert.equal(
    classificarPendenciaNativa({ status: "sessao_aberta_sem_execucao", retornoNewTransac: 0, executada: false }).acao,
    "bloquear"
  );
});

test("journal sem resultado terminal não é liberado por SERVERPND e não abre outra transação", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-captura-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const interrompida = {
    versao: 1,
    status: "execucao_iniciada",
    identificador: "captura-lab",
    correlationId: "captura-lab",
    valor: 1500,
    dataHoraInicio: "2026-10-21T03:56:53.547Z",
    etapa: "PW_iExecTransac",
    retornoNewTransac: 0,
    retornoExec: null,
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    perfil: "conector-homologacao",
    operacao: "PWOPER_SALE",
  };
  await writeFile(arquivo, `${JSON.stringify(interrompida)}\n`);
  const original = await readFile(arquivo, "utf8");
  const antes = await avaliarJournalMenu([arquivo]);
  assert.equal(antes.seguir, false);
  assert.equal(antes.codigo, "legado_sem_resultado");
  assert.equal(antes.recuperavel, false);
  assert.equal(classificarSituacaoJournal(interrompida), "legado_sem_resultado");
  const bloqueada = await recuperarSessaoAbertaSemExecucao({
    journal: interrompida,
    transporte: transporteReconciliacao(async (info) => {
      if (info === PWINFO.SERVERPND) return { codigo: PWRET.OK, valor: "0" };
      return { codigo: PWRET.OK, valor: "" };
    }),
    arquivo,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(bloqueada.ok, false);
  assert.equal(bloqueada.codigo, "legado_sem_resultado");
  assert.equal(bloqueada.journalApagado, false);
  assert.equal(bloqueada.confirmacaoChamada, false);
  assert.equal(bloqueada.novaCobranca, false);
  assert.equal(bloqueada.chamadas.includes("PW_iGetResult"), false);
  assert.equal(bloqueada.chamadas.includes("PW_iNewTransac"), false);
  assert.equal(bloqueada.chamadas.includes("PW_iConfirmation"), false);
  assert.equal(await readFile(arquivo, "utf8"), original);
  assert.equal(JSON.parse(original).host, undefined);
  const outra = await gravarEtapaAntesDaExecucao(arquivo, {
    identificador: "outra-venda",
    correlationId: "outra-venda",
    valor: 100,
    retornoNewTransac: 0,
    executada: false,
  });
  assert.equal(outra.gravado, false);
  assert.equal(await readFile(arquivo, "utf8"), original);
});

test("MOREDATA interrompido, reinício e referência pendente não liberam sem prova", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-moredata-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const interrompida = {
    versao: 1,
    status: "execucao_iniciada",
    identificador: "captura-moredata",
    correlationId: "captura-moredata",
    valor: 1500,
    dataHoraInicio: "2026-10-21T03:56:53.547Z",
    etapa: "PW_iExecTransac",
    retornoNewTransac: 0,
    retornoExec: PWRET.MOREDATA,
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
  };
  await writeFile(arquivo, `${JSON.stringify(interrompida)}\n`);
  assert.equal(classificarSituacaoJournal(interrompida), "captura_pendente");
  assert.equal(classificarSituacaoJournal({ ...interrompida, autorizacaoFinanceira: true }), "resultado_desconhecido");
  assert.equal(classificarSituacaoJournal({ status: "aguardando_decisao", precisaConfirmacao: true }), "aguardando_confirmacao");
  const lido = await lerPendenciaTef(arquivo);
  assert.equal(lido.recuperavel, true);
  assert.equal(lido.registro.retornoExec, PWRET.MOREDATA);
  const reinicio = await recuperarSessaoAbertaSemExecucao({
    journal: interrompida,
    transporte: transporteReconciliacao(() => ({ codigo: PWRET.TRNNOTINIT, valor: "" })),
    arquivo,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(reinicio.ok, false);
  assert.equal(reinicio.situacao, "captura_pendente");
  assert.match(reinicio.mensagem, /TRNNOTINIT/);
  assert.match(reinicio.mensagem, /não comprova ausência/);
  assert.match(reinicio.mensagem, /SETIS/);
  assert.equal(reinicio.confirmacaoChamada, false);
  assert.equal(reinicio.novaCobranca, false);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).status, "execucao_iniciada");
  const consulta = await readFile(`${arquivo}.consulta.jsonl`, "utf8");
  assert.match(consulta, /PWRET_TRNNOTINIT/);
  assert.match(consulta, /"liberaCaptura":false/);
  const nodata = await recuperarSessaoAbertaSemExecucao({
    journal: interrompida,
    transporte: transporteReconciliacao(() => ({ codigo: PWRET.NODATA, valor: "" })),
    arquivo,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(nodata.ok, false);
  assert.match(nodata.mensagem, /não comprova ausência/);
  const referencia = await recuperarSessaoAbertaSemExecucao({
    journal: interrompida,
    transporte: transporteReconciliacao(async (info) => {
      if (info === PWINFO.SERVERPND) return { codigo: PWRET.OK, valor: "0" };
      return { codigo: PWRET.OK, valor: "REF-OCULTA" };
    }),
    arquivo,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(referencia.ok, false);
  assert.equal(referencia.situacao, "aguardando_confirmacao");
  assert.equal(referencia.confirmacaoChamada, false);
  assert.equal(referencia.mensagem.includes("REF-OCULTA"), false);
  assert.equal((await readFile(`${arquivo}.consulta.jsonl`, "utf8")).includes("REF-OCULTA"), false);
  const desconhecido = await recuperarSessaoAbertaSemExecucao({
    journal: { ...interrompida, status: "resultado_desconhecido", autorizacaoFinanceira: true },
    transporte: transporteReconciliacao(() => ({ codigo: PWRET.OK, valor: "0" })),
    arquivo,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(desconhecido.ok, false);
  assert.equal(desconhecido.codigo, "financeiro");
  assert.equal(desconhecido.situacao, "resultado_desconhecido");
  assert.equal(desconhecido.chamadas.includes("PW_iGetResult"), false);
  assert.equal(desconhecido.confirmacaoChamada, false);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).retornoExec, PWRET.MOREDATA);
});

test("cancelamento durante MOREDATA, fechamento de sessão, reinício e recuperação", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-moredata-cancel-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const identificador = "80838062-1abd-4427-a284-08bf8acdeddd";
  await writeFile(arquivo, `${JSON.stringify({
    versao: 1,
    status: "execucao_iniciada",
    identificador,
    correlationId: identificador,
    valor: 100,
    dataHoraInicio: "2026-10-21T03:56:53.547Z",
    etapa: "PW_iExecTransac",
    retornoNewTransac: 0,
    retornoExec: PWRET.MOREDATA,
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    perfil: "conector-homologacao",
    historico: [],
  })}\n`);

  const semCaptura = await registrarEncerramentoCaptura(arquivo, {
    identificador,
    capturaEmCurso: false,
    evento: PWRET.CANCEL,
    aborto: PWRET.OK,
  });
  assert.equal(semCaptura.gravado, false);
  assert.equal(encerramentoCapturaValido({ identificador, capturaEmCurso: true, evento: PWRET.INVCALL, aborto: PWRET.OK }), false);
  assert.equal(encerramentoCapturaValido({
    identificador,
    capturaEmCurso: true,
    evento: PWRET.CANCEL,
    aborto: PWRET.OK,
    autorizacaoFinanceira: true,
  }), false);
  let bloqueio = await avaliarJournalMenu([arquivo], undefined, {
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(bloqueio.seguir, false);
  const outraEmpresa = await avaliarJournalMenu([arquivo], undefined, {
    empresaId: "empresa-b",
    terminalCodigo: "caixa-b",
    ambiente: "homologacao",
  });
  assert.equal(outraEmpresa.seguir, false);
  const producao = await avaliarJournalMenu([arquivo], undefined, {
    empresaId: "empresa-b",
    terminalCodigo: "caixa-b",
    ambiente: "producao",
  });
  assert.equal(producao.seguir, true);

  const chamadas = [];
  const reinicio = await recuperarSessaoAbertaSemExecucao({
    arquivo,
    idempotencyKey: identificador,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
    transporte: {
      chamadas,
      async ppAbort() {
        chamadas.push("PW_iPPAbort");
        return PWRET.OK;
      },
      async confirmation() {
        chamadas.push("PW_iConfirmation");
        return PWRET.OK;
      },
      async getResult() {
        chamadas.push("PW_iGetResult");
        return { codigo: PWRET.TRNNOTINIT, valor: "" };
      },
    },
  });
  assert.equal(reinicio.ok, false);
  assert.equal(chamadas.includes("PW_iPPAbort"), false);
  assert.equal(chamadas.includes("PW_iConfirmation"), false);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).status, "execucao_iniciada");

  const soCaptura = await registrarEncerramentoCaptura(arquivo, {
    identificador,
    correlationId: identificador,
    capturaEmCurso: true,
    aborto: PWRET.OK,
    evento: PWRET.CANCEL,
  });
  assert.equal(soCaptura.gravado, false);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).status, "execucao_iniciada");
  const encerrado = await registrarEncerramentoCaptura(arquivo, {
    identificador,
    correlationId: identificador,
    capturaEmCurso: true,
    aborto: PWRET.OK,
    evento: PWRET.CANCEL,
    retornoExec: PWRET.CANCEL,
  });
  assert.equal(encerrado.gravado, true);
  assert.equal(encerrado.journalApagado, false);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).status, "execucao_iniciada");
  const prova = await readFile(`${arquivo}.captura.jsonl`, "utf8");
  assert.match(prova, /PWRET_CANCEL|\"evento\":-2491/);
  assert.equal(prova.includes("PW_iConfirmation"), false);
  bloqueio = await avaliarJournalMenu([arquivo], undefined, {
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
  });
  assert.equal(bloqueio.seguir, false);
  assert.equal(bloqueio.codigo, "falha_host");
  assert.equal(bloqueio.recuperavel, false);
  assert.match(bloqueio.mensagem, /reconciliação permanece pendente/);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).status, "execucao_iniciada");
});

test("journal de outra empresa não bloqueia e operação encerrada não trava a venda", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-empresas-"));
  const dela = path.join(pasta, "tef-journal-etapa.empresa-a.json");
  const encerrado = path.join(pasta, "tef-journal-etapa-encerrado.json");
  await writeFile(dela, `${JSON.stringify({
    versao: 1,
    status: "execucao_iniciada",
    identificador: "captura-a",
    correlationId: "captura-a",
    valor: 100,
    dataHoraInicio: "2026-10-21T03:56:53.547Z",
    etapa: "PW_iExecTransac",
    retornoNewTransac: 0,
    executada: true,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-a",
    dispositivoId: "33333333-3333-4333-8333-333333333333",
    ambiente: "homologacao",
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
  })}\n`);
  await writeFile(encerrado, `${JSON.stringify({
    versao: 1,
    status: "sessao_tecnica_incompleta",
    identificador: "venda-confirmada",
    correlationId: "venda-confirmada",
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    encerramento: { evidencias: { serverPndValor: "0" } },
  })}\n`);
  const outra = await avaliarJournalMenu([dela, encerrado], undefined, {
    empresaId: "empresa-b",
    terminalCodigo: "caixa-b",
    dispositivoId: "44444444-4444-4444-8444-444444444444",
    ambiente: "homologacao",
  });
  assert.equal(outra.seguir, true);
  const mesma = await avaliarJournalMenu([dela], undefined, {
    empresaId: "empresa-a",
    terminalCodigo: "caixa-a",
    dispositivoId: "33333333-3333-4333-8333-333333333333",
    ambiente: "homologacao",
  });
  assert.equal(mesma.codigo, "legado_sem_resultado");
  assert.match(mesma.mensagem, /não contém o resultado terminal/);
  assert.equal(mesma.mensagem.includes("não libera nova captura"), false);
  const confirmada = await avaliarJournalMenu([encerrado]);
  assert.equal(confirmada.seguir, true);
  const lib = biblioteca([menu]);
  const recusa = await executar(pedido({ idempotencyKey: "op-motivo-real" }), lib, mesma);
  assert.equal(recusa.codigo, "legado_sem_resultado");
  assert.equal(recusa.mensagem.includes("não libera nova captura"), false);
  assert.equal(lib.chamadas.includes("PW_iNewTransac"), false);
  assert.equal(JSON.parse(await readFile(dela, "utf8")).status, "execucao_iniciada");
});

test("resultado financeiro desconhecido continua bloqueado sem apagar o journal", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-desconhecido-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const original = {
    versao: 1,
    status: "resultado_desconhecido",
    identificador: "resultado-lab",
    correlationId: "resultado-lab",
    valor: 1500,
    dataHoraInicio: "2026-10-21T03:56:53.547Z",
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
  };
  await writeFile(arquivo, `${JSON.stringify(original)}\n`);
  const journal = await avaliarJournalMenu([arquivo]);
  assert.equal(journal.seguir, false);
  assert.equal(journal.codigo, "pendencia");
  assert.equal(await readFile(arquivo, "utf8"), `${JSON.stringify(original)}\n`);
  const financeiro = await recuperarSessaoAbertaSemExecucao({
    journal: { ...original, retornoExec: 0, executada: true },
    transporte: transporteReconciliacao(),
    arquivo,
  });
  assert.equal(financeiro.codigo, "financeiro");
  assert.equal(financeiro.confirmacaoChamada, false);
  assert.match(await readFile(arquivo, "utf8"), /resultado_desconhecido/);
});

function journal1817() {
  return {
    retornoNewTransac: 0,
    executada: false,
    identificador: "sessao-1817-homologacao",
    correlationId: "sessao-1817-homologacao",
  };
}

function transporteReconciliacao(responder) {
  return {
    chamadas: [],
    async getResult(info) {
      this.chamadas.push(info);
      return responder(info);
    },
    async confirmation() {
      this.chamadas.push("confirmacao");
      return 0;
    },
    async ppAbort() {
      this.chamadas.push("ppAbort");
      return 0;
    },
    async newTransac() {
      this.chamadas.push("newTransac");
      return 0;
    },
  };
}

async function recuperarEm(arquivo, transporte, extra = {}) {
  return recuperarSessaoAbertaSemExecucao({
    journal: journal1817(),
    transporte,
    transacaoLocalAberta: false,
    arquivo,
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
    ...extra,
  });
}

test("TRNNOTINIT, NODATA e demais códigos não comprovam ausência de pendência", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-codigos-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const codigos = [...new Set([...Object.values(PWRET), -2596])].filter((codigo) => codigo !== PWRET.OK);
  for (const codigo of codigos) {
    const transporte = transporteReconciliacao(async () => ({ codigo, valor: "0" }));
    const recuperacao = await recuperarEm(arquivo, transporte);
    assert.equal(recuperacao.ok, false, String(codigo));
    assert.equal(recuperacao.prova1817, false, String(codigo));
    assert.equal(recuperacao.codigo, "serverpnd", String(codigo));
    assert.equal(recuperacao.novaCobranca, false, String(codigo));
    assert.match(recuperacao.mensagem, new RegExp(String(codigo)));
    assert.equal(transporte.chamadas.includes("confirmacao"), false);
    assert.equal(transporte.chamadas.includes("ppAbort"), false);
    assert.equal(transporte.chamadas.includes("newTransac"), false);
    assert.deepEqual(transporte.chamadas, [PWINFO.SERVERPND]);
  }
  const prova = await lerProvaEtapaVenda(arquivo);
  assert.equal(prova.prova1817, false);
  const texto = await readFile(arquivo, "utf8");
  assert.equal(texto.includes('"prova1817": true'), false);
  assert.equal(texto.includes('"serverPndValor": "0"'), false);
  const journal = await avaliarJournalMenu([arquivo]);
  assert.equal(journal.codigo, "reconciliacao");
  assert.equal(journal.seguir, false);
  esquecerMenuConector();
});

test("PWRET_OK com valor diferente de 0 não libera e não ecoa o valor", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-valor-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const transporte = transporteReconciliacao(async () => ({ codigo: PWRET.OK, valor: "1-PENDENTE" }));
  const recuperacao = await recuperarEm(arquivo, transporte);
  assert.equal(recuperacao.ok, false);
  assert.equal(recuperacao.prova1817, false);
  assert.match(recuperacao.mensagem, /não é 0/);
  assert.equal(recuperacao.mensagem.includes("1-PENDENTE"), false);
  const texto = await readFile(arquivo, "utf8");
  assert.equal(texto.includes("1-PENDENTE"), false);
  assert.equal((await lerProvaEtapaVenda(arquivo)).prova1817, false);
  esquecerMenuConector();
});

test("tag pendente com NODATA, TRNNOTINIT ou valor mantém o bloqueio", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-tags-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const primeira = SEQUENCIA_REFERENCIAS_PENDENTES[0];
  const nodata = transporteReconciliacao(async (info) => {
    if (info === PWINFO.SERVERPND) return { codigo: PWRET.OK, valor: "0" };
    return { codigo: PWRET.NODATA, valor: "" };
  });
  const leitura = await recuperarEm(arquivo, nodata);
  assert.equal(leitura.ok, false);
  assert.equal(leitura.codigo, "leitura");
  assert.equal(leitura.tag, primeira.nome);
  assert.match(leitura.mensagem, new RegExp(primeira.nome));
  assert.match(leitura.mensagem, /-2496/);
  assert.deepEqual(nodata.chamadas, [PWINFO.SERVERPND, primeira.info]);
  const trn = transporteReconciliacao(async (info) => {
    if (info === PWINFO.SERVERPND) return { codigo: PWRET.OK, valor: "0" };
    return { codigo: PWRET.TRNNOTINIT, valor: "" };
  });
  const semTransacao = await recuperarEm(arquivo, trn);
  assert.equal(semTransacao.ok, false);
  assert.match(semTransacao.mensagem, /-2488/);
  assert.equal(semTransacao.mensagem.includes("PWINFO_PNDREQNUM"), true);
  const ocupada = transporteReconciliacao(async (info) => {
    if (info === PWINFO.SERVERPND) return { codigo: PWRET.OK, valor: "0" };
    return { codigo: PWRET.OK, valor: "REF-NAO-ECOAR" };
  });
  const pendente = await recuperarEm(arquivo, ocupada);
  assert.equal(pendente.ok, false);
  assert.equal(pendente.codigo, "pendente");
  assert.equal(pendente.referenciasPresentes, true);
  assert.equal(pendente.mensagem.includes("REF-NAO-ECOAR"), false);
  const texto = await readFile(arquivo, "utf8");
  assert.equal(texto.includes("REF-NAO-ECOAR"), false);
  assert.equal((await lerProvaEtapaVenda(arquivo)).prova1817, false);
  esquecerMenuConector();
});

test("falha de consulta e reinício não inventam prova nem apagam o journal", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "tef-reinicio-"));
  const arquivo = path.join(pasta, "tef-journal-etapa-venda.json");
  const falha = transporteReconciliacao(async () => {
    throw new Error("dll recusou a tag");
  });
  const primeira = await recuperarEm(arquivo, falha);
  assert.equal(primeira.ok, false);
  assert.equal(primeira.codigo, "leitura");
  assert.match(primeira.mensagem, /PWINFO_SERVERPND/);
  assert.equal(falha.chamadas.includes("newTransac"), false);
  const semProva = await lerProvaEtapaVenda(arquivo);
  assert.equal(semProva.prova1817, false);
  const segunda = await recuperarEm(
    arquivo,
    transporteReconciliacao(async () => ({ codigo: PWRET.TRNNOTINIT, valor: "0" })),
  );
  assert.equal(segunda.ok, false);
  assert.equal(segunda.prova1817, false);
  const guardado = JSON.parse(await readFile(arquivo, "utf8"));
  assert.equal(guardado.status, "reconciliacao_pendente");
  assert.equal(guardado.historico.length >= 1, true);
  assert.equal(guardado.prova1817, false);
  const historico = await readFile(`${arquivo}.historico.jsonl`, "utf8");
  assert.match(historico, /reconciliacao_pendente/);
  const terceira = await recuperarEm(
    arquivo,
    transporteReconciliacao(async (info) => {
      if (info === PWINFO.SERVERPND) return { codigo: PWRET.OK, valor: "0" };
      if (SEQUENCIA_REFERENCIAS_PENDENTES.some((tag) => tag.info === info)) return { codigo: PWRET.OK, valor: "" };
      return { codigo: PWRET.INVCALL, valor: "" };
    }),
  );
  assert.equal(terceira.ok, true);
  assert.equal(terceira.prova1817, true);
  assert.equal(terceira.novaCobranca, false);
  const provada = await lerProvaEtapaVenda(arquivo);
  assert.equal(provada.prova1817, true);
  const final = JSON.parse(await readFile(arquivo, "utf8"));
  assert.equal(final.historico.length >= 2, true);
  const falso = path.join(pasta, "falso.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(falso, JSON.stringify({ prova1817: true, encerramento: { evidencias: { serverPndValor: "0" } } }));
  assert.equal((await lerProvaEtapaVenda(falso)).prova1817, false);
  const journal = await avaliarJournalMenu([arquivo]);
  assert.equal(journal.seguir, true);
  esquecerMenuConector();
});

test("F2 duplicado não abre segunda transação", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu]);
  const base = pedido({ idempotencyKey: "op-duplicada" });
  await preparar(base, lib);
  const [primeira, segunda] = await Promise.all([executar(base, lib), executar(base, lib)]);
  const novas = [primeira, segunda].filter((item) => item.transacaoIniciada === true);
  assert.equal(novas.length, 1);
  assert.equal(lib.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(primeira.pagamentoRecebido, false);
  assert.equal(segunda.pagamentoRecebido, false);
  esquecerMenuConector();
});

test("confirmação só ocorre depois de autorização com as cinco referências", async () => {
  esquecerMenuConector();
  const lib = biblioteca([menu]);
  const semAutorizacao = {
    real: false,
    chamadas: [],
    async confirmation() {
      this.chamadas.push("PW_iConfirmation");
      return 0;
    },
  };
  const semProva = await executarDecisaoFinanceira(
    semAutorizacao,
    { persistido: true, autorizacaoFinanceira: false, referencias: {} },
    "confirmar"
  );
  assert.equal(semProva.codigo, "REFERENCIAS");
  assert.equal(semProva.chamar, false);
  assert.equal(semAutorizacao.chamadas.includes("PW_iConfirmation"), false);
  const host = biblioteca([menu, { codigo: -2596, captura: [] }]);
  const base = pedido({ idempotencyKey: "op-host-sem-cnf" });
  await preparar(base, host);
  const inicio = await executar(base, host);
  const desconhecido = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
  });
  assert.equal(desconhecido.codigo, "desconhecido");
  assert.equal(desconhecido.confirmacao.chamar, false);
  assert.equal(host.chamadas.includes("PW_iConfirmation"), false);
  assert.equal(desconhecido.pagamentoRecebido, false);
  esquecerMenuConector();
});

function capturaPinpad(tipo) {
  return {
    codigo: PWRET.MOREDATA,
    captura: [{ wIdentificador: 0, bTipoDeDado: tipo, szPrompt: "", vszTextoMenu: [], vszValorMenu: [] }],
  };
}

function bibliotecaChip(eventos, falha = {}) {
  const lib = biblioteca(eventos);
  let fase = "";
  let avisou = false;
  lib.ppGetCard = async (indice) => {
    lib.chamadas.push(["PW_iPPGetCard", indice]);
    return falha.cartao ?? 0;
  };
  lib.ppGoOnChip = async (indice) => {
    lib.chamadas.push(["PW_iPPGoOnChip", indice]);
    return falha.chip ?? 0;
  };
  lib.ppFinishChip = async (indice) => {
    lib.chamadas.push(["PW_iPPFinishChip", indice]);
    return falha.finish ?? 0;
  };
  lib.ppRemoveCard = async (...args) => {
    lib.chamadas.push(["PW_iPPRemoveCard", args.length]);
    fase = "remove";
    return falha.remove ?? 0;
  };
  lib.ppEventLoop = async () => {
    lib.chamadas.push("PW_iPPEventLoop");
    if (fase === "remove" && !avisou) {
      avisou = true;
      return { codigo: PWRET.DISPLAY, display: "[NA A258] ERRO INTERNO" };
    }
    return { codigo: PWRET.OK, display: "" };
  };
  lib.getResult = async (info) => {
    lib.chamadas.push("PW_iGetResult");
    if (info === PWINFO.RESULTMSG) return { codigo: 0, valor: "[NA A258] ERRO INTERNO" };
    if (info === PWINFO.RESULTID) return { codigo: 0, valor: "258" };
    if (info === PWINFO.CNFREQ) return { codigo: 0, valor: "0" };
    return { codigo: PWRET.NODATA, valor: "" };
  };
  return lib;
}

async function venderAteMenu(lib, arquivo, chave) {
  const base = pedido({ idempotencyKey: chave, terminalCodigo: `caixa-${chave}` });
  await preparar(base, lib);
  const inicio = await executarTransacaoHomologacao({
    pedido: base,
    assinatura: assinarAutorizacaoOperacao(privada, base),
    chavePublicaPem: publica,
    agora,
    frase: FRASE_MENU_CONECTOR,
    entrada: { ...entrada(lib), arquivoEtapa: arquivo },
  });
  return { base, inicio };
}

test("A258 depois de PW_iPPRemoveCard grava resultado terminal e bloqueia outra cobrança", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-a258-"));
  const arquivo = path.join(pasta, "etapa.json");
  const lib = bibliotecaChip([
    menu,
    capturaPinpad(3),
    capturaPinpad(9),
    capturaPinpad(13),
    { codigo: -2596, captura: [] },
  ]);
  const { base, inicio } = await venderAteMenu(lib, arquivo, "a258-host");
  assert.equal(inicio.codigo, "captura");
  const resposta = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
    arquivoEtapa: arquivo,
    dispositivoId: base.dispositivoId,
  });
  const pinpad = await seguirCapturaPinpad(base.empresaId, base.terminalCodigo);
  const resultado = pinpad ?? resposta;
  assert.equal(resultado.pagamentoRecebido, false);
  assert.equal(resultado.nfcEEmitida, false);
  assert.match(resultado.mensagem, /\[NA A258\] ERRO INTERNO/);
  assert.equal(lib.chamadas.filter((item) => item === "PW_iNewTransac").length, 1);
  assert.equal(lib.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iPPFinishChip"), false);
  assert.equal(lib.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iPPRemoveCard" && item[1] === 0), true);
  assert.equal(lib.chamadas.includes("PW_iConfirmation"), false);
  const journal = JSON.parse(await readFile(arquivo, "utf8"));
  assert.equal(journal.status, "resultado_terminal");
  assert.equal(journal.retornoExec, -2596);
  assert.equal(journal.host.classe, "falha_informada_pelo_host");
  assert.equal(journal.host.resultadoId, "258");
  assert.equal(journal.host.cnfReq, "0");
  assert.match(journal.host.mensagem, /\[NA A258\] ERRO INTERNO/);
  assert.equal(journal.reconciliacao.situacao, "pendente");
  assert.equal(journal.reconciliacao.cancelamento, false);
  assert.equal(journal.reconciliacao.estorno, false);
  assert.equal(journal.reconciliacao.ausenciaDeCobrancaComprovada, false);
  assert.equal(journal.confirmacaoChamada, false);
  assert.equal(journal.pagamentoRecebido, false);
  assert.equal(journal.empresaId, base.empresaId);
  assert.equal(journal.terminalCodigo, base.terminalCodigo);
  assert.equal(journal.correlationId, "a258-host");
  assert.equal(journal.historico[0].status, "execucao_iniciada");
  assert.equal(JSON.stringify(journal).includes("reqNum"), false);
  assert.equal(classificarSituacaoJournal(journal), "falha_host");
  const auditoria = await readFile(`${arquivo}.auditoria.jsonl`, "utf8");
  assert.match(auditoria, /resultado_terminal/);
  assert.equal(auditoria.includes("reqNum"), false);
  const outra = bibliotecaChip([menu]);
  const repetida = await executar(pedido({ idempotencyKey: "a258-repetida", terminalCodigo: base.terminalCodigo }), outra);
  assert.equal(repetida.codigo, "desconhecido");
  assert.equal(outra.chamadas.includes("PW_iNewTransac"), false);
  esquecerMenuConector();
  const bloqueio = await avaliarJournalMenu([arquivo]);
  assert.equal(bloqueio.seguir, false);
  assert.equal(bloqueio.recuperavel, false);
  assert.equal(bloqueio.codigo, "falha_host");
  assert.match(bloqueio.mensagem, /\[NA A258\] ERRO INTERNO/);
  const reinicio = bibliotecaChip([menu]);
  const depois = await executar(
    pedido({ idempotencyKey: "a258-reinicio", terminalCodigo: base.terminalCodigo }),
    reinicio,
    bloqueio
  );
  assert.equal(depois.ok, false);
  assert.equal(depois.pagamentoRecebido, false);
  assert.equal(reinicio.chamadas.includes("PW_iNewTransac"), false);
  const relido = JSON.parse(await readFile(arquivo, "utf8"));
  assert.equal(relido.historico.length, 1);
  assert.equal(relido.host.retorno, -2596);
});

test("erro em cada etapa do chip não volta a tratar a venda como captura pendente", async () => {
  const etapas = [
    { nome: "cartao", falha: { cartao: PWRET.INVPARAM }, eventos: [menu, capturaPinpad(3)], presente: "PW_iPPGetCard", ausente: "PW_iPPGoOnChip" },
    { nome: "chip", falha: { chip: PWRET.INVPARAM }, eventos: [menu, capturaPinpad(3), capturaPinpad(9)], presente: "PW_iPPGoOnChip", ausente: "PW_iPPFinishChip" },
    { nome: "finish", falha: { finish: PWRET.PPCOMERR }, eventos: [menu, capturaPinpad(3), capturaPinpad(9), capturaPinpad(10)], presente: "PW_iPPFinishChip", ausente: "PW_iPPRemoveCard" },
  ];
  for (const etapa of etapas) {
    esquecerMenuConector();
    const pasta = await mkdtemp(path.join(tmpdir(), `ultrapdv-${etapa.nome}-`));
    const arquivo = path.join(pasta, "etapa.json");
    const lib = bibliotecaChip(etapa.eventos, etapa.falha);
    const { base, inicio } = await venderAteMenu(lib, arquivo, `chip-${etapa.nome}`);
    await atenderMenuConector({
      ambiente: "homologacao",
      empresaId: base.empresaId,
      terminalCodigo: base.terminalCodigo,
      acao: "responder",
      frase: FRASE_MENU_CONECTOR,
      capturaId: inicio.menu.capturaId,
      valor: "9691",
      journal: { seguir: true },
      arquivoEtapa: arquivo,
    });
    await seguirCapturaPinpad(base.empresaId, base.terminalCodigo);
    const nomesChamadas = lib.chamadas.map((item) => (Array.isArray(item) ? item[0] : item));
    assert.equal(nomesChamadas.includes(etapa.presente), true, etapa.nome);
    assert.equal(nomesChamadas.includes(etapa.ausente), false, etapa.nome);
    assert.equal(nomesChamadas.includes("PW_iConfirmation"), false, etapa.nome);
    assert.equal(nomesChamadas.filter((item) => item === "PW_iNewTransac").length, 1, etapa.nome);
    const journal = JSON.parse(await readFile(arquivo, "utf8"));
    assert.equal(journal.status, "resultado_terminal", etapa.nome);
    assert.notEqual(classificarSituacaoJournal(journal), "captura_pendente", etapa.nome);
    assert.equal(journal.reconciliacao.ausenciaDeCobrancaComprovada, false, etapa.nome);
    esquecerMenuConector();
    const bloqueio = await avaliarJournalMenu([arquivo]);
    assert.equal(bloqueio.recuperavel, false, etapa.nome);
    assert.equal(bloqueio.seguir, false, etapa.nome);
  }
});

test("persistência interrompida conserva o journal e a repetição é idempotente", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-interrupcao-"));
  const arquivo = path.join(pasta, "etapa.json");
  const original = {
    versao: 1,
    status: "execucao_iniciada",
    identificador: "persistencia-interrompida",
    correlationId: "persistencia-interrompida",
    empresaId: "empresa-a",
    terminalCodigo: "caixa-lab",
    valor: 100,
    dataHoraInicio: "2026-10-21T19:12:34.462Z",
    etapa: "PW_iExecTransac",
    retornoNewTransac: 0,
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    historico: [],
  };
  await writeFile(arquivo, `${JSON.stringify(original, null, 2)}\n`);
  const dados = {
    identificador: original.identificador,
    correlationId: original.correlationId,
    empresaId: original.empresaId,
    terminalCodigo: original.terminalCodigo,
    retornoExec: -2596,
    resultadoId: "258",
    mensagemHost: "[NA A258] ERRO INTERNO",
    cnfReq: "0",
    classe: "desconhecido",
  };
  let falhou = false;
  const fsApi = {
    readFile,
    mkdir: async () => {},
    open: async (...args) => (await import("node:fs/promises")).open(...args),
    rename: async (origem, destino) => {
      if (!falhou && destino === arquivo) {
        falhou = true;
        throw Object.assign(new Error("disco interrompido"), { code: "EIO" });
      }
      return rename(origem, destino);
    },
    unlink: async () => {},
    appendFile: async (...args) => (await import("node:fs/promises")).appendFile(...args),
  };
  await assert.rejects(() => persistirResultadoTerminal(arquivo, dados, fsApi), /disco interrompido/);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).status, "execucao_iniciada");
  const gravado = await persistirResultadoTerminal(arquivo, dados);
  assert.equal(gravado.gravado, true);
  assert.equal(gravado.bloqueiaNovaCobranca, true);
  const repetido = await persistirResultadoTerminal(arquivo, dados);
  assert.equal(repetido.idempotente, true);
  const journal = JSON.parse(await readFile(arquivo, "utf8"));
  assert.equal(journal.historico.length, 1);
  assert.equal(journal.historico[0].status, "execucao_iniciada");
  assert.equal((await readFile(`${arquivo}.auditoria.jsonl`, "utf8")).trim().split(/\r?\n/).length, 1);
});

test("queda de processo conserva a execução iniciada e impede outra cobrança", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-queda-"));
  const arquivo = path.join(pasta, "etapa.json");
  const lib = bibliotecaChip([menu, capturaPinpad(3)]);
  const { base, inicio } = await venderAteMenu(lib, arquivo, "queda-processo");
  assert.equal(inicio.codigo, "captura");
  const antes = await readFile(arquivo, "utf8");
  const aberto = JSON.parse(antes);
  assert.equal(aberto.status, "execucao_iniciada");
  assert.equal(aberto.retornoExec ?? null, null);
  assert.equal(aberto.host, undefined);
  esquecerMenuConector();
  const bloqueio = await avaliarJournalMenu([arquivo]);
  assert.equal(bloqueio.seguir, false);
  assert.equal(bloqueio.codigo, "legado_sem_resultado");
  assert.equal(bloqueio.recuperavel, false);
  const outra = bibliotecaChip([menu]);
  const depois = await executar(
    pedido({ idempotencyKey: "queda-nova", terminalCodigo: base.terminalCodigo }),
    outra,
    bloqueio
  );
  assert.equal(depois.ok, false);
  assert.equal(depois.pagamentoRecebido, false);
  assert.equal(outra.chamadas.includes("PW_iNewTransac"), false);
  assert.equal(await readFile(arquivo, "utf8"), antes);
});

test("instalação com journal legado da operação A258 não inventa o resultado 258", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-legado-"));
  const arquivo = path.join(pasta, "etapa.json");
  const identificador = "01dcb9c0-3b55-4289-95b1-65f4b64b8f3e";
  const legado = {
    versao: 1,
    status: "execucao_iniciada",
    identificador,
    correlationId: identificador,
    valor: 100,
    etapa: "PW_iExecTransac",
    retornoNewTransac: 0,
    executada: true,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    empresaId: "empresa-lab",
    terminalCodigo: "caixa-lab",
    perfil: "conector-homologacao",
    operacao: "PWOPER_SALE",
  };
  await writeFile(arquivo, `${JSON.stringify(legado)}\n`);
  await writeFile(
    `${arquivo}.captura.jsonl`,
    `${JSON.stringify({ tipo: "encerramento_captura", status: "captura_cancelada", identificador, correlationId: identificador, capturaEmCurso: true, aborto: 0, evento: PWRET.CANCEL, retornoExec: PWRET.CANCEL, confirmacaoChamada: false })}\n`
  );
  const original = await readFile(arquivo, "utf8");
  const bloqueio = await avaliarJournalMenu([arquivo]);
  assert.equal(bloqueio.seguir, false);
  assert.equal(bloqueio.codigo, "legado_sem_resultado");
  assert.equal(bloqueio.recuperavel, false);
  assert.equal(await readFile(arquivo, "utf8"), original);
  assert.equal(original.includes("258"), false);
  assert.equal(original.includes("resultado_terminal"), false);
  const lib = bibliotecaChip([menu]);
  const venda = await executar(
    pedido({ idempotencyKey: "legado-nova", empresaId: "empresa-lab", terminalCodigo: "caixa-lab" }),
    lib,
    bloqueio
  );
  assert.equal(venda.ok, false);
  assert.equal(lib.chamadas.includes("PW_iNewTransac"), false);
  assert.equal(lib.chamadas.includes("PW_iConfirmation"), false);
  assert.equal(await readFile(arquivo, "utf8"), original);
});

test("confirmação repetida permanece idempotente e não confirma de novo", async () => {
  esquecerMenuConector();
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-cnf-"));
  const arquivo = path.join(pasta, "etapa.json");
  const lib = biblioteca([menu, { codigo: 0, captura: [] }], { refs: { [PWINFO.CNFREQ]: "1" } });
  const base = pedido({ idempotencyKey: "op-cnf-journal" });
  await preparar(base, lib);
  const inicio = await executarTransacaoHomologacao({
    pedido: base,
    assinatura: assinarAutorizacaoOperacao(privada, base),
    chavePublicaPem: publica,
    agora,
    frase: FRASE_MENU_CONECTOR,
    entrada: { ...entrada(lib), arquivoEtapa: arquivo },
  });
  const aprovada = await atenderMenuConector({
    ambiente: "homologacao",
    empresaId: base.empresaId,
    terminalCodigo: base.terminalCodigo,
    acao: "responder",
    frase: FRASE_MENU_CONECTOR,
    capturaId: inicio.menu.capturaId,
    valor: "9691",
    journal: { seguir: true },
    arquivoEtapa: arquivo,
    dispositivoId: base.dispositivoId,
  });
  assert.equal(aprovada.pagamentoRecebido, true);
  assert.equal(aprovada.confirmacaoChamada, true);
  assert.equal(lib.chamadas.filter((item) => Array.isArray(item) && item[0] === "PW_iConfirmation").length, 1);
  const journal = JSON.parse(await readFile(arquivo, "utf8"));
  assert.equal(journal.status, "resultado_terminal");
  assert.equal(journal.reconciliacao.situacao, "confirmada");
  assert.equal(journal.confirmacaoChamada, true);
  const repetido = await persistirResultadoTerminal(arquivo, {
    identificador: base.idempotencyKey,
    correlationId: base.idempotencyKey,
    retornoExec: journal.retornoExec,
    classe: journal.host.classe,
    resultadoId: journal.host.resultadoId,
    mensagemHost: journal.host.mensagem,
    cnfReq: journal.host.cnfReq,
    confirmacaoChamada: true,
    pagamentoRecebido: true,
  });
  assert.equal(repetido.idempotente, true);
  assert.equal(repetido.bloqueiaNovaCobranca, false);
  assert.equal(lib.chamadas.filter((item) => Array.isArray(item) && item[0] === "PW_iConfirmation").length, 1);
  assert.equal(JSON.parse(await readFile(arquivo, "utf8")).historico.length, journal.historico.length);
  const leitura = await avaliarJournalMenu([arquivo]);
  assert.equal(leitura.seguir, true);
});

test("cancelamento, recusa e timeout exigem reconciliação antes de outra cobrança", async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), "ultrapdv-politica-"));
  const casos = [
    { nome: "cancelada", retornoExec: PWRET.CANCEL, classe: "cancelada" },
    { nome: "recusa", retornoExec: -2598, classe: "recusa", mensagemHost: "recusa do ponto" },
    { nome: "timeout", retornoExec: PWRET.TIMEOUT, classe: "desconhecido" },
  ];
  for (const caso of casos) {
    const arquivo = path.join(pasta, `${caso.nome}.json`);
    const gravado = await persistirResultadoTerminal(arquivo, {
      identificador: caso.nome,
      correlationId: caso.nome,
      empresaId: "empresa-lab",
      terminalCodigo: "caixa-lab",
      retornoExec: caso.retornoExec,
      classe: caso.classe,
      mensagemHost: caso.mensagemHost ?? "",
      cnfReq: "0",
      confirmacaoChamada: false,
      pagamentoRecebido: false,
    });
    assert.equal(gravado.bloqueiaNovaCobranca, true, caso.nome);
    const journal = JSON.parse(await readFile(arquivo, "utf8"));
    assert.equal(journal.host.classe, caso.classe, caso.nome);
    assert.equal(journal.reconciliacao.situacao, "pendente", caso.nome);
    assert.equal(journal.reconciliacao.cancelamento, false, caso.nome);
    assert.equal(journal.reconciliacao.estorno, false, caso.nome);
    assert.equal(journal.reconciliacao.ausenciaDeCobrancaComprovada, false, caso.nome);
    const bloqueio = await avaliarJournalMenu([arquivo]);
    assert.equal(bloqueio.seguir, false, caso.nome);
    assert.equal(bloqueio.recuperavel, false, caso.nome);
  }
});
