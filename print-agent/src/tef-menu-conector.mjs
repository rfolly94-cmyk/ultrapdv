import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { arquivoChaveHomologacao } from "./tef-identidade-homologacao.mjs";

import { liberarHomologacao, ocupacaoHomologacao, reservarHomologacao } from "./tef-homologacao-ocupacao.mjs";
import { diagnosticarLeiturasJournal } from "./tef-executor-homologacao.mjs";
import {
  classificarSituacaoJournal,
  encerrarSessaoAbertaSemExecucao,
  gravarEtapaAntesDaExecucao,
  aplicarProvaAnexa,
  anexarProvaReconciliacao,
  journalPertenceAoPedido,
  gravarPendenciaTef,
  lerPendenciaTef,
  marcarExecucaoIniciada,
  persistirResultadoTerminal,
  montarFalhaReconciliacao1817,
  persistirReconciliacao1817,
  registrarConsultaRecuperacao,
  registrarEncerramentoCaptura,
  registrarProvaSemApagarJournal,
} from "./tef-pendencia.mjs";
import { calcularPwinfoAutcap } from "./tef-autcap.mjs";
import { assinaturaNativa, nomeCodigoPw, PWCNF, PWINFO, PWOPER, PWRET, SEQUENCIA_REFERENCIAS_PENDENTES } from "./tef-pgweb.mjs";
import { resolverRaizAgente } from "./raiz.mjs";
import { carregarVersao } from "./versao.mjs";
import {
  abrirCapturaResidente,
  conduzirProcessoResidente,
  continuarCapturasPinpad,
  criarSessaoContinua,
  pedidoParaOperador,
  responderContinuidadeNativa,
  transacaoResidenteAtiva,
} from "./tef-teste-nativo-homologacao.mjs";
import { decidirConfirmacaoNativa, executarExecTransacOficial, lerResultadoOficial } from "./tef-venda-nativa.mjs";
import { persistirReferenciasConfirmacao } from "./tef-confirmacao-duravel.mjs";

export const FRASE_MENU_CONECTOR = "AUTORIZO_TESTE_FINANCEIRO_HOMOLOGACAO";

export const MENSAGEM_EXECUCAO_FISICA_BLOQUEADA =
  "A execução física pelo modal permanece bloqueada. O cancelamento não encerra uma sessão financeira na DLL e a recuperação não libera PWOPER_SALE. Nenhum comando foi enviado ao PinPad.";

export const MENSAGEM_CANCELAMENTO_IMPEDIDO =
  "A sessão financeira continua no Connector. Não há encerramento seguro da DLL para esta captura. O fechamento foi impedido. Nenhum journal foi apagado e nenhum pagamento foi marcado como recebido.";

const sessoes = new Map();
const aberturas = new Set();
const resultadosDesconhecidos = new Map();
const sessoesAbertasSemExecucao = new Map();
const autorizacoesOperacao = new Map();
const ORIGEM_COM7 = "com7";
let reservaCom7 = null;

function sessaoNativaDaReserva() {
  if (!reservaCom7) return null;
  return sessoes.get(chave(reservaCom7.empresaId, reservaCom7.terminalCodigo)) ?? null;
}

function mensagemReservaAtiva(reserva = reservaCom7, ocupacao = null) {
  if (ocupacao?.origem === "diagnostico") {
    return "O diagnóstico do PinPad está em andamento neste computador. Aguarde o término. Nenhum pagamento foi iniciado.";
  }
  if (ocupacao?.origem === "instalacao") {
    return "A instalação do PinPad está em andamento neste computador. Aguarde o término. Nenhum pagamento foi iniciado.";
  }
  if (ocupacao?.origem === "comprovacao") {
    return "Há uma comprovação do PinPad em andamento neste computador. Aguarde o término. Nenhum pagamento foi iniciado.";
  }
  const desde = Number(reserva?.desde);
  const quando = Number.isFinite(desde) && desde > 0 ? new Date(desde).toISOString() : "";
  return `O PinPad deste computador está em uso por uma venda${quando ? ` desde ${quando}` : ""}. Aguarde a conclusão. Nenhum comando novo foi enviado.`;
}

function terminalDaReserva(reserva) {
  return chave(reserva?.empresaId, reserva?.terminalCodigo);
}

function resultadoDesconhecidoPreservado(reserva = reservaCom7) {
  if (!reserva) return false;
  if (reserva.estado === "desconhecida" || reserva.queda === true) return true;
  return resultadosDesconhecidos.has(terminalDaReserva(reserva));
}

function sessaoFinanceiraPreservada(reserva = reservaCom7) {
  if (!reserva) return false;
  if (sessoesAbertasSemExecucao.has(terminalDaReserva(reserva))) return true;
  const caixa = sessoes.get(terminalDaReserva(reserva));
  if (!caixa) return false;
  if (transacaoResidenteAtiva(caixa.sessao) || reserva.capturaAtiva === true) return true;
  const status = String(caixa.registro?.status ?? "");
  return (
    status === "desconhecida" ||
    status === "aguardando_confirmacao" ||
    status === "aguardando_captura" ||
    status === "pagamento_em_andamento" ||
    status === "resultado_desconhecido" ||
    status === "reconciliacao"
  );
}

export function classificarReservaPorta(reserva = reservaCom7, ocupacao = ocupacaoHomologacao()) {
  if (resultadoDesconhecidoPreservado(reserva)) {
    return { acao: "bloquear", codigo: "desconhecido", desde: reserva?.desde ?? null, origem: "venda" };
  }
  if (ocupacao && ocupacao.origem !== ORIGEM_COM7) {
    return { acao: "bloquear", codigo: "ocupada", desde: ocupacao.desde ?? null, origem: ocupacao.origem };
  }
  if (reserva && reserva.estado !== "encerrada") {
    if (reserva.emExecucao === true || sessaoFinanceiraPreservada(reserva)) {
      return { acao: "bloquear", codigo: "ocupada", desde: reserva.desde ?? null, origem: "venda" };
    }
    return { acao: "liberar", codigo: "abandonada", desde: reserva.desde ?? null, origem: "venda" };
  }
  return { acao: "seguir", codigo: "livre", desde: null, origem: "" };
}

function aplicarReservaAbandonada() {
  const classe = classificarReservaPorta();
  if (classe.acao !== "liberar") return classe;
  liberarHomologacao(ORIGEM_COM7);
  reservaCom7 = null;
  return { acao: "seguir", codigo: "abandonada", desde: classe.desde, origem: "venda" };
}

export function concluirExecucaoReservaPorta() {
  if (!reservaCom7) return;
  reservaCom7.emExecucao = false;
  if (resultadoDesconhecidoPreservado() || sessaoFinanceiraPreservada()) return;
  liberarHomologacao(ORIGEM_COM7);
  reservaCom7 = null;
}

const MOTIVOS_OPERACAO = Object.freeze({
  ambiente: "O ambiente não é a homologação sandbox.",
  journal: "O journal não libera nova captura.",
  ponto: "O ponto de homologação não está instalado.",
  dll: "A DLL de homologação não foi validada.",
  com7: "O PinPad deste computador não está reservado para esta operação. Nenhum comando foi enviado.",
  sessao: "A sessão nativa residente não está disponível.",
  biblioteca: "A biblioteca residente do Connector não está ligada.",
  autorizacao: "Não há autorização de operação concedida pelo servidor.",
});

function chave(empresaId, terminalCodigo) {
  return `${empresaId}|${terminalCodigo}`;
}

function recusa(codigo, mensagem, extra = {}) {
  return {
    ok: false,
    codigo,
    mensagem,
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
    execucaoFisica: false,
    comandoEnviado: false,
    sessaoMantida: false,
    novas: 0,
    fase: "recusa",
    menu: null,
    pinpad: null,
    resultado: null,
    ...extra,
  };
}

export function listarPendenciasFisicas(entrada = {}) {
  const pendencias = [];
  if (entrada.journal?.seguir === false) {
    pendencias.push("O journal não libera nova captura.");
  }
  if (entrada.servidor !== "homologacao") {
    pendencias.push("O servidor sandbox não foi revalidado por esta rota.");
  }
  if (entrada.portaPinpadOcupada === true) {
    pendencias.push("O PinPad não está exclusivo.");
  }
  if (entrada.autorizacaoServidor !== true) {
    pendencias.push("Não há autorização do servidor para venda física.");
  }
  return pendencias;
}

export function execucaoFisicaPermitida(entrada) {
  return listarPendenciasFisicas(entrada).length === 0;
}

export function bibliotecaResidenteElegivel(biblioteca) {
  const homologacao = biblioteca?.homologacao === true;
  const producao = biblioteca?.producao === true;
  return Boolean(
    biblioteca &&
      biblioteca.residente === true &&
      homologacao !== producao &&
      biblioteca.origem === "conector" &&
      typeof biblioteca.newTransac === "function"
  );
}

export function bibliotecaResidenteDoConector(instancia) {
  return bibliotecaResidenteElegivel(instancia) ? instancia : null;
}

export const FUNCOES_SESSAO_RESIDENTE = Object.freeze([
  "PW_iNewTransac",
  "PW_iAddParam",
  "PW_iExecTransac",
  "PW_iGetResult",
  "PW_iConfirmation",
  "PW_iWaitConfirmation",
  "PW_iPPAbort",
  "PW_iPPEventLoop",
  "PW_iPPGetCard",
  "PW_iPPGetData",
  "PW_iPPGetPIN",
  "PW_iPPGoOnChip",
  "PW_iPPFinishChip",
  "PW_iPPConfirmData",
  "PW_iPPRemoveCard",
  "PW_iPPGenericCMD",
  "PW_iPPPositiveConfirmation",
]);

const METODOS_SESSAO = Object.freeze({
  PW_iNewTransac: "newTransac",
  PW_iAddParam: "addParam",
  PW_iExecTransac: "execTransac",
  PW_iGetResult: "getResult",
  PW_iConfirmation: "confirmation",
  PW_iWaitConfirmation: "waitConfirmation",
  PW_iPPAbort: "ppAbort",
  PW_iPPEventLoop: "ppEventLoop",
  PW_iPPGetCard: "ppGetCard",
  PW_iPPGetData: "ppGetData",
  PW_iPPGetPIN: "ppGetPIN",
  PW_iPPGoOnChip: "ppGoOnChip",
  PW_iPPFinishChip: "ppFinishChip",
  PW_iPPConfirmData: "ppConfirmData",
  PW_iPPRemoveCard: "ppRemoveCard",
  PW_iPPGenericCMD: "ppGenericCMD",
  PW_iPPPositiveConfirmation: "ppPositiveConfirmation",
});

export const DETALHES_SESSAO = Object.freeze({
  ausente: "Nenhuma instância nativa foi criada neste processo.",
  inicializacao: "PW_iInit ainda não foi concluído nesta instância.",
  carregamento: "As funções não pertencem ao mesmo carregamento x64 da PGWebLib.",
  perfil: "O perfil isolado de homologação não foi preservado.",
  assinatura: "A assinatura nativa não confere com o contrato da PGWebLib.",
  funcao: "Uma função nativa necessária não está neste carregamento.",
  vinculo: "newTransac não está ligada ao carregamento desta instância.",
  incompleta: "A preparação nativa está incompleta.",
});

const donosPonteiro = new WeakMap();

function ambienteVenda(valor) {
  return valor === "homologacao" || valor === "producao";
}

function perfilProducaoIsolado(diretorio) {
  const normal = path.win32.normalize(String(diretorio ?? "")).toLowerCase();
  return normal.includes("\\producao\\") && !normal.includes("\\homologacao\\") && !normal.includes("\\paygo\\");
}

function perfilDaInstancia(instancia) {
  if (instancia?.homologacao === true && instancia?.producao === true) return "";
  if (instancia?.homologacao === true && perfilHomologacaoIsolado(instancia.diretorio)) return "homologacao";
  if (instancia?.producao === true && perfilProducaoIsolado(instancia.diretorio)) return "producao";
  return "";
}

function perfilHomologacaoIsolado(diretorio) {
  const normal = path.win32.normalize(String(diretorio ?? "")).toLowerCase();
  return normal.includes("\\homologacao\\") && !normal.includes("\\producao\\") && !normal.includes("\\paygo\\");
}

function mensagemSessao(causa) {
  const detalhe = DETALHES_SESSAO[causa] ?? DETALHES_SESSAO.incompleta;
  return `${MOTIVOS_OPERACAO.sessao} ${detalhe}`;
}

function recusarSessao(instancia, causa) {
  if (!instancia || typeof instancia !== "object") return null;
  if (instancia.bibliotecaNativa) {
    instancia.residente = false;
    if (instancia.origem === "conector") delete instancia.origem;
  }
  instancia.causaSessao = causa;
  return null;
}

function vinculoNewTransac(instancia) {
  const carga = instancia?.bibliotecaNativa;
  const fn = instancia?.newTransac;
  const vinculo = instancia?.vinculoNativo;
  if (!carga || typeof carga.func !== "function" || typeof fn !== "function") return false;
  if (instancia.arquitetura !== "x64" || instancia.inicializada !== true || !perfilDaInstancia(instancia)) return false;
  if (!vinculo || vinculo.carregamento !== carga || vinculo.arquitetura !== "x64") return false;
  if (fn.carregamento !== carga || fn.ponteiro !== vinculo.funcoes?.PW_iNewTransac) return false;
  let assinaturaNova;
  try {
    assinaturaNova = assinaturaNativa("PW_iNewTransac");
  } catch {
    return false;
  }
  if (fn.assinatura !== assinaturaNova) return false;
  for (const nome of FUNCOES_SESSAO_RESIDENTE) {
    const ponteiro = vinculo.funcoes?.[nome];
    const dono = typeof ponteiro === "function" ? donosPonteiro.get(ponteiro) : null;
    let assinatura;
    try {
      assinatura = assinaturaNativa(nome);
    } catch {
      return false;
    }
    if (!dono || dono.carga !== carga || dono.assinatura !== assinatura) return false;
  }
  return true;
}

function causaAntesDeResolver(instancia) {
  if (!instancia) return "incompleta";
  if (instancia.homologacao === true && instancia.producao === true) return "perfil";
  if (instancia.homologacao !== true && instancia.producao !== true) return "incompleta";
  if (instancia.inicializada !== true) return "inicializacao";
  if (instancia.arquitetura !== "x64" || typeof instancia.bibliotecaNativa?.func !== "function") return "carregamento";
  if (!perfilDaInstancia(instancia)) return "perfil";
  return "";
}

function resolverFuncoesSessao(instancia) {
  const carga = instancia.bibliotecaNativa;
  const funcoes = {};
  for (const nome of FUNCOES_SESSAO_RESIDENTE) {
    let assinatura;
    try {
      assinatura = assinaturaNativa(nome);
    } catch {
      return { ok: false, causa: "assinatura" };
    }
    let ponteiro;
    try {
      ponteiro = carga.func(assinatura);
    } catch {
      return { ok: false, causa: "funcao" };
    }
    if (typeof ponteiro !== "function") return { ok: false, causa: "funcao" };
    const dono = donosPonteiro.get(ponteiro);
    if (dono && (dono.carga !== carga || dono.assinatura !== assinatura)) return { ok: false, causa: "funcao" };
    if (!dono) donosPonteiro.set(ponteiro, { carga, assinatura });
    funcoes[nome] = ponteiro;
  }
  return { ok: true, funcoes };
}

function instalarVinculo(instancia, funcoes) {
  const carga = instancia.bibliotecaNativa;
  instancia.vinculoNativo = { carregamento: carga, arquitetura: "x64", funcoes: { ...funcoes } };
  for (const nome of FUNCOES_SESSAO_RESIDENTE) {
    const metodo = METODOS_SESSAO[nome];
    if (typeof instancia[metodo] === "function" && nome !== "PW_iNewTransac") continue;
    const ponteiro = funcoes[nome];
    const envolvida = (...argumentos) => ponteiro(...argumentos);
    Object.defineProperties(envolvida, {
      carregamento: { value: carga },
      ponteiro: { value: ponteiro },
      assinatura: { value: assinaturaNativa(nome) },
    });
    instancia[metodo] = envolvida;
  }
}

export function completarInstanciaResidente(instancia, ligar) {
  if (instancia && bibliotecaResidenteElegivel(instancia) && !instancia.bibliotecaNativa) return instancia;
  if (vinculoNewTransac(instancia) && bibliotecaResidenteElegivel(instancia)) return instancia;
  if (!instancia || typeof instancia !== "object") return null;
  const previa = causaAntesDeResolver(instancia);
  if (previa) return recusarSessao(instancia, previa);
  const resolvido = resolverFuncoesSessao(instancia);
  if (!resolvido.ok) return recusarSessao(instancia, resolvido.causa);
  if (typeof ligar === "function") {
    try {
      const produzida = ligar(resolvido.funcoes, instancia);
      if (produzida != null && produzida !== instancia) return recusarSessao(instancia, "incompleta");
    } catch {
      return recusarSessao(instancia, "incompleta");
    }
  }
  instalarVinculo(instancia, resolvido.funcoes);
  if (!vinculoNewTransac(instancia)) {
    delete instancia.newTransac;
    delete instancia.vinculoNativo;
    return recusarSessao(instancia, "vinculo");
  }
  const perfil = perfilDaInstancia(instancia);
  instancia.residente = true;
  instancia.homologacao = perfil === "homologacao";
  instancia.producao = perfil === "producao";
  instancia.origem = "conector";
  instancia.real = true;
  instancia.causaSessao = "";
  return instancia;
}

export function concederAutorizacaoOperacao(pedido = {}, confianca = {}) {
  if (confianca.servidor !== true) return { ok: false, codigo: "confianca" };
  if (!ambienteVenda(pedido.ambiente)) return { ok: false, codigo: "producao" };
  const empresaId = String(pedido.empresaId ?? "");
  const terminalCodigo = String(pedido.terminalCodigo ?? "");
  const idempotencyKey = String(pedido.idempotencyKey ?? "");
  const valorCentavos = Number(pedido.valorCentavos);
  if (!empresaId || !terminalCodigo || !idempotencyKey || !Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    return { ok: false, codigo: "pedido" };
  }
  if (autorizacoesOperacao.has(idempotencyKey)) return { ok: false, codigo: "repetida" };
  autorizacoesOperacao.set(idempotencyKey, {
    empresaId,
    dispositivoId: String(pedido.dispositivoId ?? ""),
    terminalCodigo,
    posid: String(pedido.posid ?? ""),
    idempotencyKey,
    valorCentavos,
    expiraEm: Number(pedido.expiraEm) > 0 ? Number(pedido.expiraEm) : 0,
    ambiente: pedido.ambiente,
    consumida: false,
  });
  return { ok: true, codigo: "concedida" };
}

export function consultarAutorizacaoOperacao(pedido = {}, agora = Date.now()) {
  const token = autorizacoesOperacao.get(String(pedido.idempotencyKey ?? ""));
  if (!token) return { ok: false, codigo: "ausente" };
  if (token.expiraEm > 0 && agora > token.expiraEm) return { ok: false, codigo: "expirada" };
  if (token.consumida) return { ok: false, codigo: "consumida" };
  if (!ambienteVenda(pedido.ambiente)) return { ok: false, codigo: "producao" };
  if (token.ambiente !== String(pedido.ambiente ?? "")) {
    return { ok: false, codigo: String(pedido.ambiente ?? "") === "producao" ? "producao" : "ambiente" };
  }
  if (token.empresaId !== String(pedido.empresaId ?? "")) return { ok: false, codigo: "empresa" };
  if (token.terminalCodigo !== String(pedido.terminalCodigo ?? "")) return { ok: false, codigo: "terminal" };
  if (token.valorCentavos !== Number(pedido.valorCentavos)) return { ok: false, codigo: "valor" };
  if (token.dispositivoId && token.dispositivoId !== String(pedido.dispositivoId ?? "")) {
    return { ok: false, codigo: "dispositivo" };
  }
  if (token.posid && token.posid !== String(pedido.posid ?? "")) return { ok: false, codigo: "posid" };
  return { ok: true, codigo: "disponivel", autorizacao: { ...token, consumida: true } };
}

export function consumirAutorizacaoOperacao(pedido = {}) {
  const consulta = consultarAutorizacaoOperacao(pedido);
  if (!consulta.ok) return consulta;
  const token = autorizacoesOperacao.get(String(pedido.idempotencyKey ?? ""));
  token.consumida = true;
  return { ok: true, codigo: "consumida", autorizacao: { ...token } };
}

export function canonicoAutorizacaoOperacao(pedido = {}) {
  return [
    "ultrapdv-tef-autorizacao-operacao-v1",
    String(pedido.ambiente ?? ""),
    String(pedido.empresaId ?? "").trim(),
    String(pedido.dispositivoId ?? "").trim(),
    String(pedido.terminalCodigo ?? "").trim(),
    String(pedido.posid ?? "").trim(),
    String(Math.round(Number(pedido.valorCentavos))),
    String(pedido.idempotencyKey ?? "").trim(),
    String(Math.round(Number(pedido.expiraEm))),
  ].join("\n");
}

export function assinarAutorizacaoOperacao(chavePrivadaPem, pedido = {}) {
  return sign(
    null,
    Buffer.from(canonicoAutorizacaoOperacao(pedido)),
    createPrivateKey(chavePrivadaPem)
  ).toString("base64");
}

export function verificarAssinaturaAutorizacaoOperacao(chavePublicaPem, pedido = {}, assinatura = "") {
  try {
    return verify(
      null,
      Buffer.from(canonicoAutorizacaoOperacao(pedido)),
      createPublicKey(chavePublicaPem),
      Buffer.from(String(assinatura ?? ""), "base64")
    );
  } catch {
    return false;
  }
}

export function registrarBloqueioResultadoDesconhecido(empresaId, terminalCodigo) {
  resultadosDesconhecidos.set(chave(empresaId, terminalCodigo), { resultado: "desconhecido" });
  return { ok: true, codigo: "desconhecido", novaCobranca: false, pagamentoRecebido: false, journalApagado: false };
}

function registrarSessaoAbertaSemExecucao(empresaId, terminalCodigo, detalhe = {}) {
  sessoesAbertasSemExecucao.set(chave(empresaId, terminalCodigo), {
    resultado: "antes_da_execucao",
    retornoNewTransac: detalhe.retornoNewTransac ?? 0,
    executada: false,
  });
  return { ok: true, codigo: "antes_da_execucao", novaCobranca: false, pagamentoRecebido: false, journalApagado: false };
}

export function transacaoLocalAbertaSemExecucao(empresaId, terminalCodigo) {
  const caixa = sessoes.get(chave(String(empresaId ?? ""), String(terminalCodigo ?? "")));
  return Boolean(caixa && caixa.transporte?.transacaoLocalAberta === true && caixa.transporte?.executada !== true);
}

export function sessaoVendaEmMemoria(empresaId, terminalCodigo) {
  const caixa = sessoes.get(chave(String(empresaId ?? ""), String(terminalCodigo ?? "")));
  if (!caixa || !transacaoResidenteAtiva(caixa.sessao)) return { ativa: false, pinpad: false, novas: 0, tipo: null };
  const pedido = pedidoParaOperador(caixa.sessao);
  return {
    ativa: true,
    pinpad: pedido?.pinpad === true,
    tipo: pedido?.tipo ?? null,
    capturaId: caixa.sessao.capturaId ?? null,
    novas: caixa.sessao.novas ?? 0,
  };
}

const MENSAGENS_PREPARACAO = Object.freeze({
  ausente: "A autorização da operação não foi apresentada. Nenhum comando foi enviado.",
  assinatura: "A assinatura da autorização não confere. Nenhum comando foi enviado.",
  expirada: "A autorização da operação expirou. Nenhum comando foi enviado.",
  consumida: "A autorização da operação já foi utilizada. Nenhum comando foi enviado.",
  empresa: "A autorização não pertence a esta empresa. Nenhum comando foi enviado.",
  dispositivo: "O computador não confere com a autorização. Nenhum comando foi enviado.",
  terminal: "O terminal não confere com a autorização. Nenhum comando foi enviado.",
  posid: "O POSID não confere com a autorização. Nenhum comando foi enviado.",
  valor: "O valor não confere com a autorização. Nenhum comando foi enviado.",
  ocupada: "O PinPad deste computador já está em uso. Aguarde a conclusão. Nenhum comando foi enviado.",
  captura: "O PinPad deste computador está em captura. Aguarde a conclusão. Nenhum comando novo foi enviado.",
  porta_empresa: "Outra empresa já ocupa o PinPad deste computador. A sessão não foi trocada. Nenhum comando foi enviado.",
  porta_terminal: "Outro terminal já ocupa o PinPad deste computador. A sessão não foi trocada. Nenhum comando foi enviado.",
  desconhecido: "Há resultado desconhecido no journal. Nenhuma nova cobrança foi iniciada.",
  producao: "A preparação não usa o ambiente de produção. Nenhum comando foi enviado.",
  pedido: "A operação de teste não foi aceita. Nenhum comando foi enviado.",
  repetida: "A autorização não pode ser transferida para outra operação. Nenhum comando foi enviado.",
});

function recusaPreparacao(codigo, mensagem = "") {
  return {
    ok: false,
    codigo,
    mensagem: mensagem || MENSAGENS_PREPARACAO[codigo] || "A preparação foi interrompida. Nenhum comando foi enviado.",
    preparado: false,
    transacaoIniciada: false,
    simulacao: false,
    nativo: false,
    execucaoFisica: false,
    comandoDll: false,
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
    novaCobranca: false,
    journalApagado: false,
  };
}

export function prepararTransporteHomologacao({
  pedido = {},
  assinatura = "",
  chavePublicaPem = "",
  agora = Date.now(),
  entrada = {},
} = {}) {
  const apresentado = {
    ambiente: String(pedido.ambiente ?? ""),
    empresaId: String(pedido.empresaId ?? "").trim(),
    dispositivoId: String(pedido.dispositivoId ?? "").trim(),
    terminalCodigo: String(pedido.terminalCodigo ?? "").trim(),
    posid: String(pedido.posid ?? "").trim(),
    valorCentavos: Number(pedido.valorCentavos),
    idempotencyKey: String(pedido.idempotencyKey ?? "").trim(),
    expiraEm: Number(pedido.expiraEm),
  };
  if (!String(assinatura ?? "").trim()) return recusaPreparacao("ausente");
  if (!chavePublicaPem || verificarAssinaturaAutorizacaoOperacao(chavePublicaPem, apresentado, assinatura) !== true) {
    return recusaPreparacao("assinatura");
  }
  if (!ambienteVenda(apresentado.ambiente)) return recusaPreparacao("producao");
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(apresentado.posid)) return recusaPreparacao("posid");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(apresentado.dispositivoId)) {
    return recusaPreparacao("dispositivo");
  }
  if (!Number.isFinite(apresentado.expiraEm) || apresentado.expiraEm <= agora) return recusaPreparacao("expirada");
  if (resultadosDesconhecidos.has(chave(apresentado.empresaId, apresentado.terminalCodigo))) {
    return recusaPreparacao("desconhecido");
  }
  if (sessoesAbertasSemExecucao.has(chave(apresentado.empresaId, apresentado.terminalCodigo))) {
    return recusaPreparacao(
      "sessao_aberta",
      "Há transação aberta sem execução financeira. Nenhuma nova cobrança foi iniciada."
    );
  }
  const classePorta = aplicarReservaAbandonada();
  if (classePorta.acao === "bloquear") {
    const outraEmpresa = Boolean(
      reservaCom7 && apresentado.empresaId && reservaCom7.empresaId !== apresentado.empresaId
    );
    return recusaPreparacao(
      classePorta.codigo === "desconhecido" ? "desconhecido" : "ocupada",
      classePorta.codigo === "desconhecido"
        ? MENSAGENS_PREPARACAO.desconhecido
        : outraEmpresa
          ? MENSAGENS_PREPARACAO.porta_empresa
          : mensagemReservaAtiva(reservaCom7, ocupacaoHomologacao())
    );
  }
  const concessao = concederAutorizacaoOperacao(apresentado, { servidor: true });
  if (!concessao.ok && concessao.codigo !== "repetida") return recusaPreparacao(concessao.codigo);
  const consulta = consultarAutorizacaoOperacao(apresentado, agora);
  if (!consulta.ok) return recusaPreparacao(consulta.codigo);
  const informada = entrada.biblioteca ?? null;
  const promovida = informada ? completarInstanciaResidente(informada) : null;
  const biblioteca = bibliotecaResidenteElegivel(promovida) ? promovida : null;
  const causaSessao = biblioteca ? "" : informada?.causaSessao || (informada ? "incompleta" : "ausente");
  const selecao = {
    ambiente: apresentado.ambiente,
    servidor: apresentado.ambiente,
    journal: entrada.journal ?? { seguir: false },
    pontoInstalado: entrada.pontoInstalado === true,
    dllOk: entrada.dllOk === true,
    com7Exclusiva: true,
    portaPinpadOcupada: false,
    sessaoNativaDisponivel: biblioteca != null,
    biblioteca,
    autorizacaoOperacao: consulta.autorizacao,
  };
  const falhas = avaliarOperacaoResidente(selecao);
  if (falhas.length > 0) {
    const codigo = falhas[0];
    const resposta = recusaPreparacao(
      codigo,
      codigo === "sessao"
        ? mensagemSessao(causaSessao)
        : entrada.journal?.seguir === false && entrada.journal?.mensagem
          ? entrada.journal.mensagem
          : MOTIVOS_OPERACAO[codigo] || MOTIVOS_OPERACAO.journal
    );
    if (codigo === "sessao") resposta.causa = causaSessao;
    return resposta;
  }
  const escolha = resolverTransporteMenu(selecao);
  const nativo = escolha.nativo === true && escolha.simulacao !== true;
  if (!nativo) {
    const resposta = recusaPreparacao("sessao", mensagemSessao(causaSessao || "incompleta"));
    resposta.causa = causaSessao || "incompleta";
    return resposta;
  }
  return {
    ok: true,
    codigo: "preparada",
    fase: "preparada",
    mensagem: "A operação foi preparada. Nenhuma transação foi iniciada e nenhum pagamento foi recebido.",
    preparado: true,
    transacaoIniciada: false,
    simulacao: false,
    nativo,
    execucaoFisica: false,
    comandoDll: false,
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
    novaCobranca: false,
    journalApagado: false,
    reservaTomada: false,
    motivo: nativo ? "" : escolha.motivo,
  };
}

export async function executarTransacaoHomologacao({
  pedido = {},
  assinatura = "",
  chavePublicaPem = "",
  agora = Date.now(),
  entrada = {},
  frase = "",
} = {}) {
  const apresentado = {
    ambiente: String(pedido.ambiente ?? ""),
    empresaId: String(pedido.empresaId ?? "").trim(),
    dispositivoId: String(pedido.dispositivoId ?? "").trim(),
    terminalCodigo: String(pedido.terminalCodigo ?? "").trim(),
    posid: String(pedido.posid ?? "").trim(),
    valorCentavos: Number(pedido.valorCentavos),
    idempotencyKey: String(pedido.idempotencyKey ?? "").trim(),
    expiraEm: Number(pedido.expiraEm),
  };
  const recusar = (codigo, mensagem) => {
    const resposta = recusaPreparacao(codigo, mensagem);
    resposta.simulacao = false;
    resposta.fase = "recusa";
    return resposta;
  };
  if (frase !== FRASE_MENU_CONECTOR) return recusar("autorizacao", MENSAGENS_PREPARACAO.ausente);
  if (!String(assinatura ?? "").trim()) return recusar("ausente");
  if (!chavePublicaPem || verificarAssinaturaAutorizacaoOperacao(chavePublicaPem, apresentado, assinatura) !== true) {
    return recusar("assinatura");
  }
  if (!ambienteVenda(apresentado.ambiente)) return recusar("producao");
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(apresentado.posid)) return recusar("posid");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(apresentado.dispositivoId)) {
    return recusar("dispositivo");
  }
  if (!Number.isFinite(apresentado.expiraEm) || apresentado.expiraEm <= agora) return recusar("expirada");
  if (resultadosDesconhecidos.has(chave(apresentado.empresaId, apresentado.terminalCodigo))) {
    return recusar("desconhecido");
  }
  if (sessoesAbertasSemExecucao.has(chave(apresentado.empresaId, apresentado.terminalCodigo))) {
    return recusar("sessao_aberta", "Há transação aberta sem execução financeira. Nenhuma nova cobrança foi iniciada.");
  }
  if (entrada.journal?.seguir === false) {
    return recusar(entrada.journal.codigo || "journal", entrada.journal.mensagem || MOTIVOS_OPERACAO.journal);
  }
  const consulta = consultarAutorizacaoOperacao(apresentado, agora);
  if (!consulta.ok) return recusar(consulta.codigo);
  const informada = entrada.biblioteca ?? null;
  const promovida = informada ? completarInstanciaResidente(informada) : null;
  const biblioteca = bibliotecaResidenteElegivel(promovida) ? promovida : null;
  if (!biblioteca) {
    const causa = informada?.causaSessao || (informada ? "incompleta" : "ausente");
    const resposta = recusar("sessao", mensagemSessao(causa));
    resposta.causa = causa;
    return resposta;
  }
  if (entrada.pontoInstalado !== true) return recusar("ponto", MOTIVOS_OPERACAO.ponto);
  if (entrada.dllOk !== true) return recusar("dll", MOTIVOS_OPERACAO.dll);
  if (entrada.portaPinpadOcupada === true) return recusar("com7", MOTIVOS_OPERACAO.com7);
  const reserva = reservarOperacaoCom7(apresentado);
  if (!reserva.ok) {
    const mensagensReserva = {
      empresa: MENSAGENS_PREPARACAO.porta_empresa,
      terminal: MENSAGENS_PREPARACAO.porta_terminal,
      captura: MENSAGENS_PREPARACAO.captura,
      ocupada: mensagemReservaAtiva(reservaCom7, ocupacaoHomologacao()),
    };
    return recusar(
      reserva.codigo,
      mensagensReserva[reserva.codigo] || MOTIVOS_OPERACAO[reserva.codigo] || MENSAGENS_PREPARACAO[reserva.codigo]
    );
  }
  try {
  const ligacao = prepararLigacaoResidente({
    ambiente: apresentado.ambiente,
    servidor: apresentado.ambiente,
    journal: entrada.journal ?? { seguir: true },
    pontoInstalado: true,
    dllOk: true,
    com7Exclusiva: true,
    portaPinpadOcupada: false,
    sessaoNativaDisponivel: true,
    biblioteca,
    autorizacaoOperacao: reserva.autorizacao,
  });
  if (ligacao.ligado !== true || ligacao.transporte?.nativo !== true || ligacao.transporte?.simulado === true) {
    liberarReservaSemSessao();
    return recusar("transporte", ligacao.motivo || MOTIVOS_OPERACAO.biblioteca);
  }
  let resultado;
  try {
    resultado = await atenderMenuConector({
      ambiente: apresentado.ambiente,
      acao: "iniciar",
      empresaId: apresentado.empresaId,
      terminalCodigo: apresentado.terminalCodigo,
      frase,
      journal: entrada.journal ?? { seguir: true },
      simulacao: false,
      transporte: ligacao.transporte,
      ensaioNativo: false,
      sessaoResidenteAutorizada: true,
      portaPinpadOcupada: false,
      arquivoJournal: entrada.arquivoJournal,
      arquivoEtapa: entrada.arquivoEtapa,
      idempotencyKey: apresentado.idempotencyKey,
      valorCentavos: apresentado.valorCentavos,
      dispositivoId: apresentado.dispositivoId,
      ambiente: apresentado.ambiente,
    });
  } catch (erro) {
    const iniciada = reservaCom7?.sessaoIniciada === true || ligacao.transporte?.novas === 1;
    const executou = ligacao.transporte?.executada === true;
    if (!iniciada) {
      liberarReservaSemSessao();
      return recusar("falha", "A falha ocorreu antes de PW_iNewTransac. Nenhuma cobrança foi iniciada.");
    }
    if (!executou || erro?.code === "ANTES_DA_EXECUCAO") {
      registrarSessaoAbertaSemExecucao(apresentado.empresaId, apresentado.terminalCodigo, { retornoNewTransac: 0 });
      if (entrada.arquivoEtapa) {
        await gravarEtapaAntesDaExecucao(entrada.arquivoEtapa, {
          identificador: apresentado.idempotencyKey,
          correlationId: apresentado.idempotencyKey,
          valor: apresentado.valorCentavos,
          etapa: "falha_antes_da_execucao",
          retornoNewTransac: 0,
          executada: false,
          empresaId: apresentado.empresaId,
          terminalCodigo: apresentado.terminalCodigo,
          dispositivoId: apresentado.dispositivoId,
          ambiente: apresentado.ambiente,
        }).catch(() => {});
      }
      return recusar(
        "antes_da_execucao",
        "PW_iNewTransac retornou 0 e PW_iExecTransac não entrou na biblioteca. Não houve autorização. A sessão permanece aberta e PW_iConfirmation não foi chamada."
      );
    }
    registrarBloqueioResultadoDesconhecido(apresentado.empresaId, apresentado.terminalCodigo);
    return recusar("desconhecido", "O resultado da transação é desconhecido. Nenhuma nova cobrança foi iniciada.");
  }
  const iniciada = resultado?.ok === true && Number(resultado.novas) === 1;
  if (!iniciada && reservaCom7?.sessaoIniciada !== true && reservaCom7?.estado !== "desconhecida") {
    liberarReservaSemSessao();
  }
  return {
    ...resultado,
    preparado: false,
    transacaoIniciada: iniciada || resultado?.transacaoIniciada === true,
    execucaoFisica: false,
    pagamentoRecebido: resultado?.pagamentoRecebido === true,
    podeFinalizar: false,
    nfcEEmitida: false,
    simulado: false,
    nativo: true,
    comandoDll: iniciada,
    journalApagado: false,
    novaCobranca: false,
  };
  } finally {
    concluirExecucaoReservaPorta();
  }
}

export async function lerChavePublicaHomologacao() {
  const par = await lerParChaveHomologacao();
  return par?.publica ?? "";
}

export async function lerChavePrivadaHomologacao() {
  const par = await lerParChaveHomologacao();
  return par?.privada ?? "";
}

async function lerParChaveHomologacao() {
  const arquivo = arquivoChaveHomologacao();
  if (!arquivo) return null;
  try {
    const bruto = JSON.parse(await readFile(arquivo, "utf8"));
    if (typeof bruto?.publica !== "string" || typeof bruto?.privada !== "string") return null;
    return { publica: bruto.publica, privada: bruto.privada };
  } catch {
    return null;
  }
}

export function exclusivaCom7(empresaId, terminalCodigo) {
  if (!reservaCom7 || reservaCom7.estado === "encerrada" || reservaCom7.estado === "desconhecida") return false;
  return reservaCom7.empresaId === String(empresaId ?? "") && reservaCom7.terminalCodigo === String(terminalCodigo ?? "");
}

export function reservarOperacaoCom7(pedido = {}) {
  const recusaReserva = (codigo) => ({ ok: false, codigo, exclusiva: false, pagamentoRecebido: false, journalApagado: false });
  if (pedido.origemNavegador === true) return recusaReserva("navegador");
  if (!ambienteVenda(pedido.ambiente)) return recusaReserva("producao");
  const consulta = consultarAutorizacaoOperacao(pedido);
  if (!consulta.ok) return recusaReserva(consulta.codigo);
  const empresaId = String(pedido.empresaId ?? "");
  const terminalCodigo = String(pedido.terminalCodigo ?? "");
  const idempotencyKey = String(pedido.idempotencyKey ?? "");
  aplicarReservaAbandonada();
  if (
    reservaCom7?.estado === "desconhecida" ||
    reservaCom7?.queda === true ||
    resultadosDesconhecidos.has(chave(empresaId, terminalCodigo))
  ) {
    return recusaReserva("reconciliacao");
  }
  if (
    reservaCom7 &&
    reservaCom7.estado !== "encerrada" &&
    reservaCom7.empresaId === empresaId &&
    reservaCom7.terminalCodigo === terminalCodigo &&
    reservaCom7.idempotencyKey === idempotencyKey
  ) {
    return { ok: true, codigo: "mantida", exclusiva: true, autorizacao: consulta.autorizacao, pagamentoRecebido: false, journalApagado: false };
  }
  if (reservaCom7 && reservaCom7.estado !== "encerrada") {
    const codigo = reservaCom7.capturaAtiva ? "captura" : reservaCom7.empresaId !== empresaId ? "empresa" : "terminal";
    return recusaReserva(codigo);
  }
  const ocupacao = ocupacaoHomologacao();
  if ((ocupacao && ocupacao.origem !== ORIGEM_COM7) || !reservarHomologacao(ORIGEM_COM7).ok) return recusaReserva("ocupada");
  reservaCom7 = {
    empresaId,
    terminalCodigo,
    idempotencyKey,
    estado: "reservada",
    capturaAtiva: false,
    sessaoIniciada: false,
    emExecucao: true,
    desde: Date.now(),
    pendente: true,
    queda: false,
  };
  const consumo = consumirAutorizacaoOperacao(pedido);
  if (!consumo.ok) {
    reservaCom7 = null;
    liberarHomologacao(ORIGEM_COM7);
    return recusaReserva(consumo.codigo);
  }
  return { ok: true, codigo: "reservada", exclusiva: true, autorizacao: consumo.autorizacao, pagamentoRecebido: false, journalApagado: false };
}

export function marcarCapturaCom7(empresaId, terminalCodigo) {
  if (!reservaCom7 || reservaCom7.empresaId !== String(empresaId ?? "") || reservaCom7.terminalCodigo !== String(terminalCodigo ?? "")) {
    return { ok: false, exclusiva: false };
  }
  reservaCom7.sessaoIniciada = true;
  reservaCom7.capturaAtiva = true;
  reservaCom7.estado = "captura";
  reservaCom7.pendente = true;
  return { ok: true, exclusiva: true, pagamentoRecebido: false };
}

export function registrarCancelamentoCom7(pedido = {}) {
  if (!reservaCom7) return { ok: false, codigo: "ausente", liberada: false, exclusiva: false, pagamentoRecebido: false };
  if (pedido.confirmado !== true) {
    reservaCom7.estado = "captura";
    reservaCom7.capturaAtiva = true;
    reservaCom7.pendente = true;
    return { ok: false, codigo: "nao_confirmado", liberada: false, exclusiva: true, pagamentoRecebido: false, journalApagado: false };
  }
  reservaCom7.capturaAtiva = false;
  return { ok: true, codigo: "confirmado", liberada: false, exclusiva: true, pagamentoRecebido: false, journalApagado: false };
}

export function registrarResultadoDesconhecidoCom7(pedido = {}) {
  if (!reservaCom7 || reservaCom7.estado === "encerrada") return { ok: false, codigo: "ausente", pagamentoRecebido: false };
  reservaCom7.estado = "desconhecida";
  reservaCom7.queda = pedido.queda === true;
  reservaCom7.pendente = true;
  reservaCom7.capturaAtiva = false;
  return { ok: true, codigo: pedido.queda === true ? "queda" : "desconhecida", exclusiva: false, novaCobranca: false, pagamentoRecebido: false, journalApagado: false };
}

export function liberarReservaSemSessao() {
  if (!reservaCom7 || reservaCom7.sessaoIniciada === true || reservaCom7.estado === "desconhecida") {
    return { ok: false, liberada: false, pagamentoRecebido: false };
  }
  liberarHomologacao(ORIGEM_COM7);
  reservaCom7 = null;
  return { ok: true, liberada: true, pagamentoRecebido: false, journalApagado: false };
}

export function encerrarReservaCom7(pedido = {}) {
  if (!reservaCom7) return { ok: false, codigo: "ausente", liberada: false, pagamentoRecebido: false };
  const mesma =
    reservaCom7.empresaId === String(pedido.empresaId ?? "") &&
    reservaCom7.terminalCodigo === String(pedido.terminalCodigo ?? "") &&
    reservaCom7.idempotencyKey === String(pedido.idempotencyKey ?? "");
  if (!mesma) return { ok: false, codigo: "vinculo", liberada: false, pagamentoRecebido: false };
  const comprovada =
    pedido.comprovada === true &&
    pedido.sessaoEncerrada === true &&
    pedido.capturaAtiva !== true &&
    pedido.resultadoDesconhecido !== true &&
    pedido.autorizacaoFinanceira !== true &&
    pedido.cancelamentoNaoConfirmado !== true &&
    reservaCom7.estado !== "desconhecida" &&
    reservaCom7.capturaAtiva !== true;
  if (!comprovada) return { ok: false, codigo: "nao_comprovada", liberada: false, exclusiva: true, pagamentoRecebido: false, journalApagado: false };
  liberarHomologacao(ORIGEM_COM7);
  reservaCom7 = null;
  return { ok: true, codigo: "liberada", liberada: true, exclusiva: false, pagamentoRecebido: false, journalApagado: false, novaCobranca: false };
}

export async function decidirNaSessaoResidente(empresaId, terminalCodigo, acao) {
  const caixa = sessoes.get(chave(empresaId, terminalCodigo));
  if (!caixa) return { ok: false, codigo: "sessao", pagamentoRecebido: false, journalApagado: false, mesmaSessao: false };
  const decisao = await executarDecisaoFinanceira(caixa.transporte, caixa.registro, acao);
  caixa.journal = [...(caixa.journal ?? []), { etapa: acao, codigo: decisao.codigo }];
  if (decisao.ok !== true || decisao.pendente === true) {
    if (decisao.codigo === "CONFIRMATION" || decisao.codigo === "SEM_RESPOSTA") {
      registrarResultadoDesconhecidoCom7();
    }
    return { ...decisao, pagamentoRecebido: false, podeFinalizar: false, nfcEEmitida: false, journalApagado: false, novaCobranca: false, mesmaSessao: true };
  }
  return {
    ...decisao,
    pagamentoRecebido: acao === "confirmar" && decisao.pagamentoRecebido === true,
    podeFinalizar: false,
    nfcEEmitida: false,
    journalApagado: false,
    novaCobranca: false,
    mesmaSessao: true,
  };
}

export function reconciliarReservaCom7(pedido = {}) {
  if (pedido.origemNavegador === true) return { ok: false, codigo: "navegador", pagamentoRecebido: false };
  if (!reservaCom7 || reservaCom7.estado !== "desconhecida" || pedido.comprovada !== true) {
    return { ok: false, codigo: "nao_comprovada", pagamentoRecebido: false, journalApagado: false, novaCobranca: false };
  }
  liberarHomologacao(ORIGEM_COM7);
  reservaCom7 = null;
  return { ok: true, codigo: "reconciliada", pagamentoRecebido: false, journalApagado: false, novaCobranca: false };
}

export function avaliarOperacaoResidente(entrada = {}) {
  const falhas = [];
  const perfil = perfilDaInstancia(entrada.biblioteca);
  const perfilDiverge =
    (entrada.biblioteca?.homologacao === true && entrada.ambiente !== "homologacao") ||
    (entrada.biblioteca?.producao === true && entrada.ambiente !== "producao") ||
    (perfil && entrada.ambiente !== perfil);
  if (!ambienteVenda(entrada.ambiente) || (entrada.servidor && entrada.servidor !== entrada.ambiente) || perfilDiverge) {
    falhas.push("ambiente");
  }
  if (entrada.journal?.seguir === false) falhas.push(entrada.journal.codigo || "journal");
  if (entrada.pontoInstalado !== true) falhas.push("ponto");
  if (entrada.dllOk !== true) falhas.push("dll");
  if (entrada.com7Exclusiva !== true || entrada.portaPinpadOcupada === true) falhas.push("com7");
  if (entrada.sessaoNativaDisponivel !== true) falhas.push("sessao");
  if (!bibliotecaResidenteElegivel(entrada.biblioteca)) falhas.push("biblioteca");
  if (!entrada.autorizacaoOperacao || entrada.autorizacaoOperacao.consumida !== true || entrada.autorizacaoOperacao.ambiente !== entrada.ambiente) {
    falhas.push("autorizacao");
  }
  return falhas;
}

export async function pontoHomologacaoNoDisco(diretorio) {
  const base = path.win32.join(String(diretorio ?? ""), "Data");
  try {
    await access(path.win32.join(base, "certificado.crt"));
    await access(path.win32.join(base, "check.pos"));
    return true;
  } catch {
    return false;
  }
}

export function prepararLigacaoResidente(entrada = {}) {
  if (entrada.biblioteca?.real === true && !bibliotecaResidenteElegivel(entrada.biblioteca)) {
    return {
      ligado: false,
      execucaoFisica: false,
      nativo: false,
      motivo: "O transporte marcado como real é recusado antes de PW_iNewTransac.",
      ponto: "transporteNativoHomologacao.newTransac",
    };
  }
  if (entrada.payloadNavegador === true || entrada.autorizacaoServidor === true) {
    return { ligado: false, execucaoFisica: false, nativo: false, motivo: "O navegador não habilita a biblioteca." };
  }
  const falhas = avaliarOperacaoResidente(entrada);
  if (falhas.length > 0) {
    return {
      ligado: false,
      execucaoFisica: false,
      nativo: false,
      motivo: MOTIVOS_OPERACAO[falhas[0]] ?? "A ligação residente foi recusada.",
      falhas,
    };
  }
  return {
    ligado: true,
    execucaoFisica: false,
    nativo: true,
    transporte: transporteNativoHomologacao(entrada.biblioteca, entrada.autorizacaoOperacao),
    motivo: "",
    falhas,
  };
}

export function resolverTransporteMenu(entrada = {}) {
  if (entrada.payloadNavegador === true || entrada.autorizacaoServidor === true) {
    return {
      simulacao: true,
      nativo: false,
      execucaoFisica: false,
      transporte: transporteMenuSimulado(),
      pendencias: [entrada.ambiente === "producao" || entrada.servidor === "producao" ? MOTIVOS_OPERACAO.ambiente : MOTIVOS_OPERACAO.autorizacao],
      motivo: entrada.ambiente === "producao" || entrada.servidor === "producao" ? MOTIVOS_OPERACAO.ambiente : MOTIVOS_OPERACAO.autorizacao,
    };
  }
  const falhas = avaliarOperacaoResidente(entrada);
  const pendencias = falhas.map((falha) => MOTIVOS_OPERACAO[falha] ?? falha);
  if (falhas.length === 0) {
    return {
      simulacao: false,
      nativo: true,
      execucaoFisica: false,
      transporte: transporteNativoHomologacao(entrada.biblioteca, entrada.autorizacaoOperacao),
      pendencias,
      motivo: "",
    };
  }
  return {
    simulacao: true,
    nativo: false,
    execucaoFisica: false,
    transporte: transporteMenuSimulado(),
    pendencias,
    motivo: pendencias[0] ?? "",
  };
}

export function transporteNativoHomologacao(biblioteca, autorizacao = null) {
  const params = [];
  const transporte = {
    nativo: true,
    simulado: false,
    real: false,
    novas: 0,
    params,
    chamadas: [],
    async newTransac() {
      const perfil = perfilDaInstancia(biblioteca);
      const ambienteBiblioteca =
        perfil || (biblioteca.homologacao === true ? "homologacao" : biblioteca.producao === true ? "producao" : "");
      const residenteAutorizada =
        bibliotecaResidenteElegivel(biblioteca) &&
        autorizacao?.consumida === true &&
        autorizacao?.ambiente === ambienteBiblioteca;
      if (!biblioteca || typeof biblioteca.newTransac !== "function" || (biblioteca.real === true && !residenteAutorizada)) {
        transporte.chamadas.push("recusado");
        return PWRET.INVCALL;
      }
      transporte.chamadas.push("PW_iNewTransac");
      const codigo = Number(await biblioteca.newTransac(PWOPER.SALE));
      if (codigo === PWRET.OK) {
        transporte.novas += 1;
        transporte.transacaoLocalAberta = true;
        transporte.retornoNewTransac = 0;
        transporte.etapa = "apos_PW_iNewTransac";
        transporte.executada = false;
      }
      return codigo;
    },
    async addParam(info, valor) {
      transporte.chamadas.push("PW_iAddParam");
      params.push([info, valor]);
      if (typeof biblioteca.addParam === "function") return biblioteca.addParam(info, valor);
      return PWRET.OK;
    },
    async execTransac(quantidade) {
      transporte.chamadas.push("PW_iExecTransac");
      const nativa = biblioteca?.execTransac;
      if (typeof nativa !== "function") return { codigo: PWRET.MOREDATA, captura: [] };
      const oficial =
        nativa.assinatura === assinaturaNativa("PW_iExecTransac") && typeof nativa.ponteiro === "function";
      transporte.etapa = "chamando_PW_iExecTransac";
      try {
        const resultado = oficial
          ? await executarExecTransacOficial(nativa.ponteiro, quantidade)
          : await nativa(quantidade);
        const codigo = Number(resultado?.codigo ?? resultado);
        if (!Number.isFinite(codigo)) {
          const falha = new Error("PW_iExecTransac não devolveu código.");
          falha.code = "ANTES_DA_EXECUCAO";
          throw falha;
        }
        transporte.executada = true;
        transporte.retornoExec = codigo;
        transporte.etapa = "PW_iExecTransac";
        return resultado;
      } catch (erro) {
        if (transporte.executada !== true) {
          transporte.etapa = "falha_antes_da_execucao";
          transporte.executada = false;
          if (erro && typeof erro === "object" && !erro.code) erro.code = "ANTES_DA_EXECUCAO";
        }
        throw erro;
      }
    },
    async ppAbort() {
      transporte.chamadas.push("PW_iPPAbort");
      if (typeof biblioteca.ppAbort === "function") return biblioteca.ppAbort();
      return PWRET.OK;
    },
    async ppEventLoop() {
      transporte.chamadas.push("PW_iPPEventLoop");
      if (typeof biblioteca.ppEventLoop === "function") return biblioteca.ppEventLoop();
      return { codigo: PWRET.TRNNOTINIT, display: "" };
    },
    async getResult(info) {
      if (typeof biblioteca.getResult === "function") return biblioteca.getResult(info);
      return { codigo: PWRET.NODATA, valor: "" };
    },
    async confirmation(status, refs) {
      transporte.chamadas.push(["PW_iConfirmation", status, refs]);
      if (typeof biblioteca.confirmation === "function") return biblioteca.confirmation(status, refs);
      return PWRET.INVCALL;
    },
    async waitConfirmation() {
      transporte.chamadas.push("PW_iWaitConfirmation");
      if (typeof biblioteca.waitConfirmation === "function") return biblioteca.waitConfirmation();
      return PWRET.INVCALL;
    },
  };
  for (const [nome, metodo] of Object.entries(METODOS_SESSAO)) {
    if (typeof transporte[metodo] === "function") continue;
    transporte[metodo] = async (indice = 0) => {
      transporte.chamadas.push(nome);
      if (typeof biblioteca[metodo] !== "function") return PWRET.DLLNOTINIT;
      return nome === "PW_iPPRemoveCard" ? biblioteca[metodo]() : biblioteca[metodo](indice);
    };
  }
  return transporte;
}

const EVENTOS_CONTINUOS = new Set([PWRET.NOTHING, PWRET.DISPLAY]);
const REFERENCIAS_CONFIRMACAO = ["reqNum", "locRef", "extRef", "virtMerch", "authSyst"];
function textoNativo(valor) {
  return String(valor ?? "").replaceAll("\0", "").trim();
}

async function informarParametrosVenda(transporte, pedido) {
  const versao = String(carregarVersao(resolverRaizAgente())?.version ?? "").trim();
  const campos = [
    [PWINFO.AUTNAME, "UltraPDV"],
    [PWINFO.AUTVER, versao],
    [PWINFO.AUTDEV, "UltraPDV"],
    [PWINFO.AUTCAP, calcularPwinfoAutcap()],
    [PWINFO.TOTAMNT, String(Math.round(Number(pedido.valorCentavos)))],
    [PWINFO.CURRENCY, "986"],
    [PWINFO.CURREXP, "2"],
    [PWINFO.FISCALREF, String(pedido.idempotencyKey ?? "").trim()],
  ];
  for (const [info, valor] of campos) {
    if (!valor) return { ok: false, codigo: "parametro" };
    const codigo = Number(await transporte.addParam(info, valor));
    if (codigo !== PWRET.OK) return { ok: false, codigo: "parametro", retorno: codigo };
  }
  return { ok: true };
}

async function confirmacaoJaRegistrada(arquivo, identificador) {
  if (!arquivo || !identificador) return null;
  try {
    const json = JSON.parse(await readFile(arquivo, "utf8"));
    if (String(json?.correlationId ?? "") !== identificador || json?.confirmacaoChamada !== true) return null;
    return json;
  } catch {
    return null;
  }
}

async function confirmarAposPersistencia(caixa, referencias, identificador) {
  const jaConfirmada = await confirmacaoJaRegistrada(caixa?.arquivoEtapa || "", identificador);
  if (jaConfirmada) {
    return {
      pagamentoRecebido: jaConfirmada.pagamentoRecebido === true,
      confirmacaoChamada: true,
      codigo: "idempotente",
    };
  }
  const persistida = await persistirReferenciasConfirmacao(
    { identificador, referencias },
    { arquivo: caixa?.arquivoEtapa || "" }
  );
  if (persistida.confirmavel !== true) {
    return {
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      codigo: persistida.motivo || "persistencia",
    };
  }
  return confirmarAprovacaoOficial(caixa?.transporte ?? caixa?.sessao?.transporte, persistida.referencias);
}

async function confirmarAprovacaoOficial(transporte, referencias) {
  const lido = await lerInfoTransporte(transporte, PWINFO.CNFREQ);
  const codigo = Number(lido?.codigo);
  const valor = textoNativo(lido?.valor);
  if (codigo !== PWRET.OK || valor !== "1") {
    return {
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      codigo: codigo === PWRET.OK ? "sem_confirmacao" : "cnf",
      retorno: Number.isInteger(codigo) ? codigo : null,
    };
  }
  if (typeof transporte?.confirmation !== "function" || typeof transporte?.waitConfirmation !== "function") {
    return { pagamentoRecebido: false, confirmacaoChamada: false, codigo: "cnf" };
  }
  const confirmacao = Number(await transporte.confirmation(PWCNF.CNF_AUTO, referencias));
  const espera = confirmacao === PWRET.OK ? Number(await transporte.waitConfirmation()) : null;
  const recebido = confirmacao === PWRET.OK && espera === PWRET.OK;
  return {
    pagamentoRecebido: recebido,
    confirmacaoChamada: true,
    codigo: recebido ? "confirmada" : "desconhecido",
    confirmacao,
    espera,
  };
}

function mensagemLeitura(tag, codigo, complemento) {
  const numero = Number.isInteger(Number(codigo)) ? Number(codigo) : "sem código numérico";
  return `PW_iGetResult(${tag}) retornou ${nomeCodigoPw(codigo)} (${numero}). ${complemento} O bloqueio permanece e nenhuma cobrança foi iniciada.`;
}

function mensagemConsultaSemProva(tag, codigo) {
  const nome = nomeCodigoPw(codigo);
  if (codigo === PWRET.TRNNOTINIT) {
    return `PW_iGetResult(${tag}) retornou ${nome} (${codigo}). O contrato da PGWebLib diz que PW_iNewTransac não foi executado nesta sessão. A consulta não comprova ausência de cobrança. A captura interrompida permanece bloqueada. Nenhuma nova cobrança foi iniciada e PW_iConfirmation não foi chamada. Reconcilie este journal com a SETIS antes do próximo teste físico.`;
  }
  if (codigo === PWRET.NODATA) {
    return `PW_iGetResult(${tag}) retornou ${nome} (${codigo}). A informação solicitada não está disponível. Isso não comprova ausência de cobrança. O journal original permanece, PW_iConfirmation não foi chamada e nenhuma nova cobrança foi iniciada. Reconcilie com a SETIS antes de repetir a venda.`;
  }
  if (codigo === PWRET.DLLNOTINIT) {
    return `PW_iGetResult(${tag}) retornou ${nome} (${codigo}). PW_iInit não foi executado. O bloqueio permanece e nenhuma cobrança foi iniciada.`;
  }
  return mensagemLeitura(tag, codigo, "Esse retorno não comprova ausência de pendência financeira.");
}

export const EVIDENCIA_SESSAO_1817 = Object.freeze({
  identificador: "sessao-1817-homologacao",
  correlationId: "sessao-1817-homologacao",
  status: "sessao_aberta_sem_execucao",
  etapa: "apos_PW_iNewTransac",
  retornoNewTransac: 0,
  retornoExec: null,
  executada: false,
  autorizacaoFinanceira: false,
  pagamentoRecebido: false,
  confirmacaoChamada: false,
  desfazimentoChamado: false,
  perfil: "conector-homologacao",
  operacao: "PWOPER_SALE",
});

async function lerInfoTransporte(transporte, info) {
  const fn = transporte?.getResult;
  if (typeof fn !== "function") return null;
  if (fn.assinatura === assinaturaNativa("PW_iGetResult") && typeof fn.ponteiro === "function") {
    return lerResultadoOficial(fn.ponteiro, info);
  }
  return fn.call(transporte, info);
}

export async function recuperarSessaoAbertaSemExecucao({
  journal = EVIDENCIA_SESSAO_1817,
  transporte = null,
  transacaoLocalAberta = false,
  arquivo = "",
  empresaId = "",
  terminalCodigo = "",
  bloqueioFinanceiro = false,
  fsApi,
} = {}) {
  const base = {
    ok: false,
    confirmacaoChamada: false,
    ppAbortChamado: false,
    bloqueioRemovido: false,
    pagamentoRecebido: false,
    journalApagado: false,
    novaCobranca: false,
    chamadas: [],
    referenciasPresentes: false,
  };
  const id = chave(String(empresaId ?? ""), String(terminalCodigo ?? ""));
  const situacaoInicial = classificarSituacaoJournal(journal);
  const journalBase = {
    ...EVIDENCIA_SESSAO_1817,
    ...journal,
    retornoNewTransac: 0,
    executada: false,
    retornoExec: null,
    autorizacaoFinanceira: false,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
  };
  async function recusar(parcial) {
    const resultado = {
      ...base,
      prova1817: false,
      situacao: situacaoInicial,
      ...parcial,
      novaCobranca: false,
      journalApagado: false,
      confirmacaoChamada: false,
    };
    if (arquivo) {
      try {
        await registrarConsultaRecuperacao(arquivo, resultado, fsApi);
        await persistirReconciliacao1817(arquivo, montarFalhaReconciliacao1817(journalBase, resultado), fsApi);
      } catch {
        resultado.evidenciaGravada = false;
      }
    }
    return resultado;
  }
  if (
    situacaoInicial === "resultado_desconhecido" ||
    situacaoInicial === "falha_host" ||
    bloqueioFinanceiro ||
    (empresaId && terminalCodigo && resultadosDesconhecidos.has(id))
  ) {
    if (arquivo) {
      await registrarConsultaRecuperacao(arquivo, {
        situacao: "resultado_desconhecido",
        tag: "journal",
        nomeRetorno: "resultado_desconhecido",
      }, fsApi).catch(() => {});
    }
    return {
      ...base,
      codigo: "financeiro",
      situacao: "resultado_desconhecido",
      mensagem: "Há resultado financeiro desconhecido. PW_iGetResult(PWINFO_SERVERPND) não encerra esse estado e PW_iConfirmation não foi chamada. O bloqueio permanece. Reconcilie com a SETIS.",
    };
  }
  if (situacaoInicial === "aguardando_confirmacao") {
    if (arquivo) {
      await registrarConsultaRecuperacao(arquivo, {
        situacao: "aguardando_confirmacao",
        tag: "journal",
        nomeRetorno: "aguardando_confirmacao",
      }, fsApi).catch(() => {});
    }
    return {
      ...base,
      codigo: "aguardando_confirmacao",
      situacao: "aguardando_confirmacao",
      mensagem:
        "Há transação aguardando confirmação no journal. PW_iConfirmation não foi chamada porque não há PWINFO_CNFREQ desta sessão. Nenhuma nova cobrança foi iniciada. Reconcilie com a SETIS.",
    };
  }
  const retornoExecOriginal = journal?.retornoExec == null ? null : Number(journal.retornoExec);
  if (
    (retornoExecOriginal != null && retornoExecOriginal !== PWRET.MOREDATA) ||
    journal?.autorizacaoFinanceira === true ||
    journal?.pagamentoRecebido === true ||
    journal?.confirmacaoChamada === true ||
    journal?.desfazimentoChamado === true
  ) {
    return {
      ...base,
      codigo: "financeiro",
      mensagem: "A operação já teve resultado financeiro. PW_iConfirmation não foi chamada e o bloqueio permanece.",
    };
  }
  if (transacaoLocalAberta || transacaoLocalAbertaSemExecucao(empresaId, terminalCodigo)) {
    return recusar({
      codigo: "sessao_local",
      tag: "sessao_local",
      mensagem:
        "PW_iNewTransac continua aberto neste processo. PW_iConfirmation e PW_iPPAbort não foram chamados. O bloqueio permanece.",
    });
  }
  if (typeof transporte?.getResult !== "function") {
    return recusar({
      codigo: "serverpnd",
      tag: "PWINFO_SERVERPND",
      mensagem: "PW_iGetResult(PWINFO_SERVERPND) não está disponível nesta sessão. O bloqueio permanece e nenhuma cobrança foi iniciada.",
    });
  }
  let tagAtual = "PWINFO_SERVERPND";
  try {
    const pendencia = await lerInfoTransporte(transporte, PWINFO.SERVERPND);
    base.chamadas.push("PW_iGetResult");
    const codigoPnd = Number(pendencia?.codigo);
    const valorPnd = textoNativo(pendencia?.valor);
    if (!Number.isInteger(codigoPnd) || codigoPnd !== PWRET.OK || valorPnd !== "0") {
      const aguardando = codigoPnd === PWRET.OK && valorPnd !== "0";
      return recusar({
        codigo: aguardando ? "aguardando_confirmacao" : "serverpnd",
        situacao: aguardando ? "aguardando_confirmacao" : situacaoInicial,
        tag: "PWINFO_SERVERPND",
        retorno: Number.isInteger(codigoPnd) ? codigoPnd : null,
        nomeRetorno: nomeCodigoPw(codigoPnd),
        mensagem: aguardando
          ? "PWINFO_SERVERPND retornou PWRET_OK e o valor não é 0. Há transação aguardando confirmação. O bloqueio permanece. PW_iConfirmation não foi chamada porque não há transação em curso nem PWINFO_CNFREQ desta captura. Nenhuma nova cobrança foi iniciada. Reconcilie com a SETIS."
          : mensagemConsultaSemProva("PWINFO_SERVERPND", codigoPnd),
      });
    }
    const pendentes = [];
    for (const tag of SEQUENCIA_REFERENCIAS_PENDENTES) {
      tagAtual = tag.nome;
      const lido = await lerInfoTransporte(transporte, tag.info);
      base.chamadas.push("PW_iGetResult");
      const codigoTag = Number(lido?.codigo);
      const valorTag = textoNativo(lido?.valor);
      if (!Number.isInteger(codigoTag) || codigoTag !== PWRET.OK) {
        return recusar({
          codigo: "leitura",
          situacao: situacaoInicial,
          tag: tag.nome,
          retorno: Number.isInteger(codigoTag) ? codigoTag : null,
          nomeRetorno: nomeCodigoPw(codigoTag),
          mensagem: mensagemConsultaSemProva(tag.nome, codigoTag),
        });
      }
      if (valorTag !== "") {
        return recusar({
          codigo: "pendente",
          situacao: "aguardando_confirmacao",
          tag: tag.nome,
          retorno: PWRET.OK,
          nomeRetorno: "PWRET_OK",
          referenciasPresentes: true,
          vazio: false,
          mensagem: `PW_iGetResult(${tag.nome}) retornou PWRET_OK e o valor não é vazio. Há referência pendente de confirmação. O valor não é exibido. PW_iConfirmation não foi chamada e nenhuma nova cobrança foi iniciada. Reconcilie com a SETIS.`,
        });
      }
      pendentes.push({ nome: tag.nome, info: tag.info, codigo: PWRET.OK, vazio: true });
    }
    const encerrado = encerrarSessaoAbertaSemExecucao(journalBase, {
      serverPndCodigo: PWRET.OK,
      serverPndValor: valorPnd,
      referenciasPresentes: false,
      transacaoLocalAberta: false,
      bloqueioFinanceiro: false,
      pendentes,
    });
    if (!encerrado.ok) {
      return recusar({
        codigo: encerrado.codigo,
        tag: "PWINFO_SERVERPND",
        mensagem: "A leitura não formou a prova de reconciliação. O bloqueio permanece e nenhuma cobrança foi iniciada.",
      });
    }
    if (arquivo) {
      await registrarConsultaRecuperacao(arquivo, {
        situacao: situacaoInicial,
        tag: "PWINFO_SERVERPND",
        retorno: PWRET.OK,
        nomeRetorno: "PWRET_OK",
        vazio: true,
      }, fsApi);
      await registrarProvaSemApagarJournal(arquivo, encerrado.registro, fsApi);
    }
    const tinhaBloqueio = empresaId && terminalCodigo && sessoesAbertasSemExecucao.has(id);
    if (tinhaBloqueio) sessoesAbertasSemExecucao.delete(id);
    return {
      ...base,
      ok: true,
      codigo: "encerrada",
      prova1817: true,
      bloqueioRemovido: tinhaBloqueio === true,
      encerrouAgora: true,
      mensagem:
        "PWINFO_SERVERPND retornou PWRET_OK e 0, e as cinco referências pendentes retornaram vazias. Nenhuma cobrança foi iniciada. PW_iConfirmation não foi chamada.",
    };
  } catch {
    return recusar({
      codigo: "leitura",
      tag: tagAtual,
      mensagem: `A consulta a ${tagAtual} falhou antes de uma leitura válida. O bloqueio permanece e nenhuma cobrança foi iniciada.`,
    });
  }
}

export async function concluirInterrupcaoCaptura(transporte, opcoes = {}) {
  if (typeof transporte?.ppAbort !== "function" || typeof transporte?.ppEventLoop !== "function") {
    return {
      confirmado: false,
      resultado: "cancelamento_nao_confirmado",
      sessaoMantida: true,
      pagamentoRecebido: false,
      journalApagado: false,
    };
  }
  const aborto = Number(await transporte.ppAbort());
  const eventos = [];
  const maximo = Number(opcoes.maximo) > 0 ? Number(opcoes.maximo) : 8;
  for (let volta = 0; volta < maximo; volta += 1) {
    const evento = await transporte.ppEventLoop();
    const codigo = Number(evento?.codigo ?? evento);
    eventos.push(codigo);
    if (EVENTOS_CONTINUOS.has(codigo)) continue;
    const confirmado = aborto === PWRET.OK && codigo === PWRET.CANCEL;
    return {
      confirmado,
      aborto,
      evento: codigo,
      eventos,
      resultado: confirmado ? "captura_cancelada" : "cancelamento_nao_confirmado",
      sessaoMantida: true,
      pagamentoRecebido: false,
      journalApagado: false,
    };
  }
  return {
    confirmado: false,
    aborto,
    evento: null,
    eventos,
    resultado: "cancelamento_nao_confirmado",
    sessaoMantida: true,
    pagamentoRecebido: false,
    journalApagado: false,
  };
}

export async function executarDecisaoFinanceira(transporte, registro, acao) {
  const base = { executado: false, pagamentoRecebido: false, journalApagado: false, recusa: false, pendente: true };
  if (transporte?.real === true) {
    return { ...base, ok: false, codigo: "DLL" };
  }
  if (registro?.persistido !== true) {
    return { ...base, ok: false, codigo: "PERSISTENCIA" };
  }
  const refs = registro.referencias ?? {};
  const completas = REFERENCIAS_CONFIRMACAO.every((campo) => String(refs[campo] ?? "").trim().length > 0);
  if (!completas || registro.autorizacaoFinanceira !== true) {
    return { ...base, ok: false, codigo: "REFERENCIAS", chamar: false };
  }
  const status = acao === "confirmar" ? PWCNF.CNF_MANU_AUT : acao === "desfazer" ? PWCNF.REV_MANU_AUT : null;
  if (status == null || typeof transporte?.confirmation !== "function" || typeof transporte?.waitConfirmation !== "function") {
    return { ...base, ok: false, codigo: "ACAO" };
  }
  const codigo = Number(await transporte.confirmation(status, refs));
  if (codigo !== PWRET.OK) {
    return { ...base, ok: false, executado: true, codigo: "CONFIRMATION", retorno: codigo };
  }
  const espera = Number(await transporte.waitConfirmation());
  if (espera !== PWRET.OK) {
    return { ...base, ok: false, executado: true, codigo: "SEM_RESPOSTA", retorno: espera, recusa: false };
  }
  return {
    ok: true,
    executado: true,
    codigo: acao === "desfazer" ? "desfeita" : "confirmada",
    pagamentoRecebido: acao === "confirmar",
    pendente: false,
    recusa: false,
    journalApagado: false,
    status,
  };
}

export function recuperarPosQueda(evidencia = {}) {
  const chave = String(evidencia.idempotencyKey ?? "");
  const usada = chave !== "" && Array.isArray(evidencia.chavesUsadas) && evidencia.chavesUsadas.includes(chave);
  if (usada) {
    return { acao: "bloquear", novaCobranca: false, reutilizarChave: false, recusa: false, pagamentoRecebido: false, motivo: "chave" };
  }
  if (evidencia.respostaAusente === true || evidencia.rede === false) {
    return { acao: "intervir", novaCobranca: false, reutilizarChave: false, recusa: false, pagamentoRecebido: false, motivo: "sem_resposta" };
  }
  if (evidencia.serverPnd === "1") {
    return { acao: "intervir", novaCobranca: false, reutilizarChave: false, recusa: false, pagamentoRecebido: false, motivo: "pendencia_remota" };
  }
  if (evidencia.comprovado !== true || evidencia.resultado === "desconhecido") {
    return { acao: "intervir", novaCobranca: false, reutilizarChave: false, recusa: false, pagamentoRecebido: false, motivo: "nao_comprovado" };
  }
  return { acao: "seguir", novaCobranca: true, reutilizarChave: false, recusa: false, pagamentoRecebido: false, motivo: "comprovado" };
}

export function prepararConfirmacaoMenu(registro) {
  const decisao = decidirConfirmacaoNativa(registro ?? {});
  return {
    persistido: registro != null,
    chamar: false,
    confirmar: false,
    desfazer: false,
    codigo: decisao.codigo,
    journalApagado: false,
  };
}

export function classificarCancelamentoSdk(etapa) {
  if (etapa === "antes") {
    return {
      procedimento: "nenhum",
      chamar: false,
      motivo: "Não houve PW_iNewTransac. Encerrar não chama a DLL, não apaga journal e não marca pagamento.",
    };
  }
  if (etapa === "captura") {
    return {
      procedimento: "PW_iPPAbort",
      chamar: false,
      motivo:
        "O SDK permite PW_iPPAbort apenas para interromper captura de PIN-pad em curso. Sem PW_iPPEventLoop confirmando PWRET_CANCEL, a sessão permanece.",
    };
  }
  if (etapa === "desconhecido") {
    return {
      procedimento: "bloquear",
      chamar: false,
      motivo: "Resultado desconhecido não autoriza PW_iConfirmation nem desfazimento. O journal permanece.",
    };
  }
  return {
    procedimento: "PW_iConfirmation",
    chamar: false,
    motivo:
      "O desfazimento de transação autorizada exige PWCNF_REV_MANU_AUT e as referências de PW_iGetResult. O modal não as possui e não chama PW_iConfirmation.",
  };
}

export function transporteMenuSimulado() {
  const params = [];
  let etapa = 0;
  const transporte = {
    real: false,
    simulado: true,
    novas: 0,
    params,
    chamadas: [],
    async newTransac() {
      transporte.chamadas.push("simulado");
      transporte.novas += 1;
      return transporte.novas === 1 ? 0 : -2494;
    },
    async addParam(_info, valor) {
      transporte.chamadas.push("simulado");
      params.push([0, valor]);
      return 0;
    },
    async execTransac() {
      transporte.chamadas.push("simulado");
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

function menuDe(pedido) {
  return {
    capturaId: pedido.capturaId,
    wIdentificador: pedido.identificador,
    tipo: pedido.tipo,
    prompt: pedido.prompt,
    opcoes: pedido.opcoes.map((texto, indice) => ({
      texto,
      valor: pedido.valores[indice] ?? "",
    })),
  };
}

function apresentar(caixa, valorEnviado) {
  const pedido = pedidoParaOperador(caixa.sessao);
  const base = {
    ok: true,
    codigo: "captura",
    mensagem: pedido?.prompt || "A biblioteca devolveu uma captura.",
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
    execucaoFisica: false,
    simulado: caixa.transporte?.simulado === true,
    nativo: caixa.transporte?.nativo === true,
    comandoDll: false,
    comandoEnviado: caixa.transporte?.simulado === true,
    sessaoMantida: true,
    novas: caixa.sessao.novas,
    valorEnviado,
    resultado: null,
  };
  if (!pedido) {
    return { ...base, fase: "encerrado", menu: null, pinpad: null, sessaoMantida: false };
  }
  if (pedido.pinpad) {
    return {
      ...base,
      fase: "pinpad",
      menu: null,
      pinpad: { prompt: pedido.prompt, wIdentificador: pedido.identificador },
    };
  }
  return { ...base, fase: "menu", menu: menuDe(pedido), pinpad: null };
}

export async function avaliarJournalMenu(arquivos, ler = lerPendenciaTef, contexto = {}) {
  const leituras = [];
  for (const arquivo of arquivos) {
    const lido = await aplicarProvaAnexa(arquivo, await ler(arquivo));
    if (!journalPertenceAoPedido(lido, contexto)) continue;
    leituras.push({ ...lido, arquivo });
  }
  const aberta = leituras.find((lido) => lido?.abertaSemExecucao === true);
  const reconciliacao = leituras.find((lido) => lido?.reconciliacaoPendente === true);
  if (reconciliacao && !aberta) {
    return {
      seguir: false,
      codigo: "reconciliacao",
      recuperavel: true,
      mensagem: "A reconciliação da sessão aberta sem execução ainda não foi comprovada. Nenhuma cobrança foi iniciada.",
      journalAberto: {
        identificador: reconciliacao.identificador || "",
        correlationId: reconciliacao.correlationId || reconciliacao.identificador || "",
        retornoNewTransac: 0,
        executada: false,
      },
      arquivo: reconciliacao.arquivo,
    };
  }
  const iniciada = leituras.find((lido) => lido?.execucaoIniciada === true);
  if (iniciada && iniciada.recuperavel !== true) {
    return {
      seguir: false,
      codigo: "ocupada",
      recuperavel: false,
      mensagem: "Há captura em andamento nesta sessão. Nenhuma nova cobrança foi iniciada.",
    };
  }
  if (iniciada?.recuperavel === true) {
    return {
      seguir: false,
      codigo: "reconciliacao",
      recuperavel: true,
      mensagem:
        "Há captura pendente: PW_iExecTransac pediu continuação e não há autorização. PW_iGetResult(PWINFO_SERVERPND) será consultado nesta sessão, sem nova cobrança.",
      journalAberto: iniciada.registro,
      arquivo: iniciada.arquivo,
    };
  }
  const falhaHost = leituras.find((lido) => lido?.bloqueiaNovaCobranca === true);
  if (falhaHost) {
    const mensagemHost = String(falhaHost.mensagemHost ?? "").trim();
    return {
      seguir: false,
      codigo: "falha_host",
      recuperavel: false,
      mensagem: mensagemHost
        ? `${mensagemHost} O retorno do host não autorizou a cobrança e não comprova ausência de efeito financeiro. A reconciliação continua pendente. Nenhuma nova cobrança foi iniciada.`
        : "Há resultado de host sem reconciliação. Nenhuma nova cobrança foi iniciada.",
      arquivo: falhaHost.arquivo,
    };
  }
  if (aberta) {
    return {
      seguir: false,
      codigo: "sessao_aberta",
      mensagem: "Há transação aberta sem execução financeira concluída. Nenhuma nova cobrança foi iniciada.",
      journalAberto: aberta.registro,
      arquivo: aberta.arquivo,
      recuperavel: aberta.registro?.executada !== true,
    };
  }
  const diagnostico = diagnosticarLeiturasJournal(leituras);
  if (diagnostico) {
    return { seguir: false, codigo: diagnostico.acao, mensagem: diagnostico.mensagem };
  }
  for (const lido of leituras) {
    const encerrado = lido?.encerrado;
    if (encerrado?.status === "resultado_desconhecido") {
      return {
        seguir: false,
        codigo: "desconhecido",
        mensagem: "Há resultado desconhecido no journal. Nenhuma nova cobrança foi iniciada.",
      };
    }
  }
  return { seguir: true, codigo: "journal", mensagem: "" };
}

function portaOcupada() {
  for (const caixa of sessoes.values()) {
    const pedido = pedidoParaOperador(caixa.sessao);
    if (pedido?.pinpad) return true;
  }
  return false;
}

export function esquecerMenuConector() {
  sessoes.clear();
  aberturas.clear();
  resultadosDesconhecidos.clear();
  sessoesAbertasSemExecucao.clear();
  autorizacoesOperacao.clear();
  if (ocupacaoHomologacao()?.origem === ORIGEM_COM7) liberarHomologacao(ORIGEM_COM7);
  reservaCom7 = null;
}

const PWRET_FROMHOST = -2596;
const RECUSA_HOST = new Set([-2598, -2597]);
const QUEDA_HOST = new Set([-2599, -2592, -2585, -2583, -2582, PWRET_FROMHOST]);

function referenciasFinanceirasCompletas(resultado) {
  const referencias = resultado?.referencias ?? {};
  return ["reqNum", "locRef", "extRef", "virtMerch", "authSyst"].every((campo) => String(referencias[campo] ?? "").trim());
}

function classificarEncerramentoNativo(resultado) {
  const nome = String(resultado?.codigo ?? "");
  const retorno = Number(resultado?.retornoExec ?? resultado?.retorno);
  if (
    retorno === PWRET_FROMHOST &&
    !(resultado?.recusaFinanceiraComprovada === true && referenciasFinanceirasCompletas(resultado))
  ) {
    return "desconhecido";
  }
  if (
    nome === "TIMEOUT" ||
    nome === "DESCONEXAO" ||
    retorno === PWRET.TIMEOUT ||
    retorno === PWRET.PPCOMERR ||
    QUEDA_HOST.has(retorno)
  ) {
    return "desconhecido";
  }
  if (nome === "executada" && retorno === PWRET.OK) return "aprovada";
  if (nome === "transacao_cancelada" && retorno === PWRET.CANCEL) return "recusa";
  if (nome === "erro" && RECUSA_HOST.has(retorno)) return "recusa";
  return "desconhecido";
}

export async function persistirResultadoDesconhecido(arquivo, registro, fsApi) {
  if (!arquivo || !registro?.correlationId || !(Number(registro.valor) > 0)) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  const lido = await lerPendenciaTef(arquivo, fsApi);
  if (lido?.ok !== true || lido.registro || lido.encerrado) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  await gravarPendenciaTef(
    arquivo,
    {
      status: "resultado_desconhecido",
      identificador: registro.correlationId,
      valor: Number(registro.valor),
      dataHoraInicio: registro.dataHoraInicio,
      correlationId: registro.correlationId,
      idempotencyKey: registro.correlationId,
      perfil: "conector-homologacao",
      retorno: PWRET_FROMHOST,
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      desfazimentoChamado: false,
      autorizacaoFinanceira: false,
    },
    fsApi
  );
  return { gravado: true, preservado: true, journalApagado: false };
}

export function lerEvidenciaSessaoHomologacao(empresaId, terminalCodigo) {
  const caixa = sessoes.get(chave(String(empresaId ?? ""), String(terminalCodigo ?? "")));
  const referencias = caixa?.registro?.referencias ?? {};
  const completas = REFERENCIAS_CONFIRMACAO.every((campo) => String(referencias[campo] ?? "").trim());
  const origem = caixa?.registro?.referenciasOrigem === "pw_iGetResult" && completas ? "pw_iGetResult" : "";
  return {
    capturaEmCurso: caixa?.sessao?.capturaPinpadIniciada === true,
    referencias: origem ? referencias : {},
    referenciasOrigem: origem,
  };
}

async function registrarCapturaCancelada(caixa, resultado) {
  const evento = Number(resultado?.evento ?? resultado?.retorno);
  const aborto = resultado?.aborto == null ? null : Number(resultado.aborto);
  const retornoExec = Number(resultado?.retornoExec);
  if (resultado?.transacaoEncerrada !== true || resultado?.capturaCancelada !== true) return false;
  if (evento !== PWRET.CANCEL || retornoExec !== PWRET.CANCEL) return false;
  if (aborto != null && aborto !== PWRET.OK) return false;
  if (caixa.arquivoEtapa && caixa.idempotencyKey) {
    await registrarEncerramentoCaptura(caixa.arquivoEtapa, {
      identificador: caixa.idempotencyKey,
      correlationId: caixa.idempotencyKey,
      capturaEmCurso: true,
      aborto,
      evento: PWRET.CANCEL,
      retornoExec: PWRET.CANCEL,
    });
  }
  sessoes.delete(chave(caixa.empresaId, caixa.terminalCodigo));
  encerrarReservaCom7({
    empresaId: caixa.empresaId,
    terminalCodigo: caixa.terminalCodigo,
    idempotencyKey: caixa.idempotencyKey,
    comprovada: true,
    sessaoEncerrada: true,
    capturaAtiva: false,
    resultadoDesconhecido: false,
    autorizacaoFinanceira: false,
    cancelamentoNaoConfirmado: false,
  });
  return true;
}

export async function acompanharCapturaPinpad(empresaId, terminalCodigo) {
  const caixa = sessoes.get(chave(String(empresaId ?? ""), String(terminalCodigo ?? "")));
  const pedido = caixa ? pedidoParaOperador(caixa.sessao) : null;
  if (!caixa || !pedido?.pinpad) {
    return {
      ok: false,
      codigo: "sem_captura",
      fase: "idle",
      mensagem: "Não há captura de PIN-pad em curso. PW_iPPAbort não foi chamado.",
      pagamentoRecebido: false,
      podeFinalizar: false,
      nfcEEmitida: false,
      comandoDll: false,
      aborto: null,
      evento: null,
    };
  }
  const resultado = await continuarCapturasPinpad(caixa.sessao);
  if (resultado?.codigo === "PINPAD") {
    registrarBloqueioResultadoDesconhecido(caixa.empresaId, caixa.terminalCodigo);
  }
  const referencias = resultado?.referencias ?? {};
  const completas = REFERENCIAS_CONFIRMACAO.every((campo) => String(referencias[campo] ?? "").trim());
  if (completas) {
    caixa.registro = {
      persistido: true,
      codigo: "aprovada",
      referencias,
      referenciasOrigem: "pw_iGetResult",
      autorizacaoFinanceira: true,
    };
  }
  const seguinte = pedidoParaOperador(caixa.sessao);
  return {
    ...apresentar(caixa, null),
    ok: ["captura", "executada", "CANCELADA_PINPAD", "TIMEOUT", "DESCONEXAO"].includes(resultado?.codigo) || resultado?.ok === true,
    fase: seguinte?.pinpad ? "pinpad" : seguinte ? "menu" : resultado?.codigo === "executada" ? "resultado" : "resultado",
    codigo: resultado?.codigo ?? "pinpad",
    mensagem:
      resultado?.codigo === "CANCELADA_PINPAD"
        ? "A captura do PIN-pad terminou. Registre PW_iPPAbort e PW_iPPEventLoop. Nenhum pagamento foi recebido."
        : resultado?.codigo === "executada"
          ? "A biblioteca devolveu o resultado. As referências saíram de PW_iGetResult. A confirmação ainda não foi enviada."
          : resultado?.mensagem || apresentar(caixa, null).mensagem,
    aborto: resultado?.aborto ?? null,
    evento: resultado?.evento ?? resultado?.retorno ?? null,
    referencias: completas ? referencias : {},
    referenciasOrigem: completas ? "pw_iGetResult" : "",
    pagamentoRecebido: false,
    podeFinalizar: false,
    nfcEEmitida: false,
    comandoDll: caixa.sessao?.capturaPinpadIniciada === true || Number.isInteger(resultado?.evento),
    execucaoFisica: false,
    capturaEncerrada: await registrarCapturaCancelada(caixa, resultado),
  };
}

function classeTerminal(resultado) {
  const retorno = Number(resultado?.retornoExec ?? resultado?.retorno);
  if (resultado?.codigo === "transacao_cancelada" || retorno === PWRET.CANCEL) return "cancelada";
  return classificarEncerramentoNativo(resultado);
}

async function encerrarJournalDaCaptura(caixa, resultado) {
  const codigo = String(resultado?.codigo ?? "");
  const retorno = Number(resultado?.retornoExec ?? resultado?.retorno);
  if (!caixa?.arquivoEtapa || !caixa?.idempotencyKey || !Number.isInteger(retorno)) {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  if (codigo === "captura" || codigo === "EM_CURSO" || codigo === "seguinte") {
    return { gravado: false, preservado: true, journalApagado: false };
  }
  const gravado = await persistirResultadoTerminal(caixa.arquivoEtapa, {
    identificador: caixa.idempotencyKey,
    correlationId: caixa.idempotencyKey,
    empresaId: caixa.empresaId,
    terminalCodigo: caixa.terminalCodigo,
    dispositivoId: caixa.dispositivoId,
    retornoExec: retorno,
    resultadoId: resultado?.resultadoId ?? "",
    mensagemHost: resultado?.mensagemHost ?? "",
    cnfReq: resultado?.cnfReq ?? "",
    classe: classeTerminal(resultado),
    pagamentoRecebido: resultado?.pagamentoRecebido === true,
    confirmacaoChamada: resultado?.confirmacaoChamada === true,
  });
  if (caixa.sessao) {
    caixa.sessao.viva = false;
    caixa.sessao.captura = null;
  }
  const id = chave(caixa.empresaId, caixa.terminalCodigo);
  sessoes.delete(id);
  if (gravado?.bloqueiaNovaCobranca === true) {
    resultadosDesconhecidos.set(id, { correlationId: caixa.idempotencyKey });
  }
  return gravado;
}

export async function seguirCapturaPinpad(empresaId, terminalCodigo) {
  const id = chave(String(empresaId ?? ""), String(terminalCodigo ?? ""));
  const caixa = sessoes.get(id);
  if (!caixa || !pedidoParaOperador(caixa.sessao)?.pinpad) return null;
  const pinpad = await continuarCapturasPinpad(caixa.sessao);
  if (pinpad?.codigo === "PINPAD") {
    registrarBloqueioResultadoDesconhecido(caixa.empresaId, caixa.terminalCodigo);
  }
  const referencias = pinpad?.referencias ?? {};
  const completas = REFERENCIAS_CONFIRMACAO.every((campo) => String(referencias[campo] ?? "").trim());
  let pagamentoRecebido = false;
  let confirmacao = null;
  if (completas && pinpad?.codigo === "executada") {
    confirmacao = await confirmarAposPersistencia(caixa, referencias, caixa.idempotencyKey);
    pagamentoRecebido = confirmacao.pagamentoRecebido === true;
  }
  const apresentado = apresentar(caixa, null);
  const pedido = pedidoParaOperador(caixa.sessao);
  const transacaoIniciada = caixa.sessao?.novas === 1;
  const capturaEncerrada = await registrarCapturaCancelada(caixa, pinpad);
  const gravado = await encerrarJournalDaCaptura(caixa, {
    ...pinpad,
    pagamentoRecebido,
    confirmacaoChamada: confirmacao?.confirmacaoChamada === true,
  });
  return {
    ...pinpad,
    ...apresentado,
    ok: pinpad?.ok === true || ["captura", "executada", "transacao_cancelada", "EM_CURSO"].includes(pinpad?.codigo),
    codigo: pinpad?.codigo ?? apresentado.codigo,
    fase: pedido?.pinpad ? "pinpad" : pedido ? "menu" : apresentado.fase,
    menu: pedido && !pedido.pinpad && !pedido.exibicao ? menuDe(pedido) : null,
    pinpad: pedido?.pinpad ? { prompt: pedido.prompt, wIdentificador: pedido.identificador, tipo: pedido.tipo } : null,
    mensagem: pinpad?.mensagemHost || pinpad?.mensagem || apresentado.mensagem,
    referencias: completas ? referencias : {},
    referenciasOrigem: completas ? "pw_iGetResult" : "",
    comandoDll: true,
    transacaoIniciada,
    pagamentoRecebido,
    podeFinalizar: pagamentoRecebido,
    nfcEEmitida: false,
    novaCobranca: false,
    confirmacao,
    capturaEncerrada,
    journalApagado: false,
    journalPreservado: gravado?.preservado === true,
    journalGravado: gravado?.gravado === true,
  };
}

export async function atenderMenuConector(input = {}) {
  const empresaId = String(input.empresaId ?? "");
  const terminalCodigo = String(input.terminalCodigo ?? "");
  if (!ambienteVenda(input.ambiente) || !empresaId || !terminalCodigo) {
    return recusa("perfil", "A venda só existe na homologação ou na produção desta empresa.");
  }
  if (input.indice != null || input.execucaoFisica === true || input.com7Exclusiva === true) {
    return recusa("pedido", "O pedido não pode trazer índice, execução física nem exclusividade da COM7.");
  }
  const acao = input.acao === "responder" || input.acao === "cancelar" || input.acao === "estado" ? input.acao : input.acao === "iniciar" ? "iniciar" : "";
  if (!acao) return recusa("acao", "Ação recusada. Nenhum comando foi enviado.");
  if (input.frase !== FRASE_MENU_CONECTOR) {
    return recusa("autorizacao", "O teste financeiro de homologação não foi autorizado. Nenhum comando foi enviado.");
  }
  const journalBloqueia = input.journal?.seguir === false;
  if (journalBloqueia && input.simulacao !== true) {
    return recusa(input.journal.codigo || "recuperar", input.journal.mensagem || "A recuperação impede a captura.");
  }

  const id = chave(empresaId, terminalCodigo);
  if (acao === "estado" || acao === "cancelar") {
    const caixa = sessoes.get(id);
    if (!caixa || !transacaoResidenteAtiva(caixa.sessao)) {
      return {
        ...recusa("ociosa", "Não há sessão financeira neste terminal."),
        ok: true,
        fase: "idle",
        sessaoMantida: false,
      };
    }
    if (acao === "estado") return apresentar(caixa, null);
    const pedido = pedidoParaOperador(caixa.sessao);
    if (pedido?.pinpad) {
      if (caixa.sessao.capturaPinpadIniciada !== true) {
        return {
          ...apresentar(caixa, null),
          ok: false,
          codigo: "sem_captura",
          mensagem: "PW_iPPAbort só interrompe uma captura de PIN-pad já iniciada. Nenhum comando foi enviado.",
          sessaoMantida: true,
          pagamentoRecebido: false,
          podeFinalizar: false,
          comandoDll: false,
          aborto: null,
          evento: null,
          confirmacao: prepararConfirmacaoMenu(caixa.registro ?? null),
        };
      }
      if (caixa.sessao.conduzindo === true) {
        caixa.sessao.interromperCaptura = true;
        return {
          ...apresentar(caixa, null),
          ok: true,
          codigo: "interrupcao_solicitada",
          mensagem: "A interrupção foi pedida durante a captura. O retorno fica na coleta que está em curso.",
          sessaoMantida: true,
          pagamentoRecebido: false,
          podeFinalizar: false,
          comandoDll: false,
        };
      }
      const interrupcao = await concluirInterrupcaoCaptura(caixa.transporte);
      caixa.journal = [...(caixa.journal ?? []), { etapa: "captura", resultado: interrupcao.resultado, evento: interrupcao.evento ?? null }];
      registrarCancelamentoCom7({ confirmado: interrupcao.confirmado === true });
      if (interrupcao.confirmado) {
        let retornoExec = null;
        if (typeof caixa.transporte?.execTransac === "function") {
          const execucao = await caixa.transporte.execTransac(9);
          retornoExec = Number(execucao?.codigo ?? execucao);
        }
        const encerrada = await registrarCapturaCancelada(caixa, {
          capturaCancelada: true,
          transacaoEncerrada: retornoExec === PWRET.CANCEL,
          aborto: interrupcao.aborto,
          evento: interrupcao.evento,
          retornoExec,
          confirmacaoChamada: false,
        });
        return {
          ...apresentar(caixa, null),
          ok: false,
          codigo: "CAPTURA_INTERROMPIDA",
          mensagem: encerrada
            ? "A captura em curso foi encerrada: PW_iPPAbort retornou PWRET_OK e PW_iPPEventLoop retornou PWRET_CANCEL. PW_iConfirmation não foi chamada. O journal original permanece e não bloqueia nova venda."
            : "A captura foi interrompida no PinPad. A sessão e o journal permanecem. Nenhum pagamento foi marcado.",
          sessaoMantida: encerrada !== true,
          pagamentoRecebido: false,
          podeFinalizar: false,
          comandoDll: false,
          cancelamentoConfirmado: true,
          aborto: interrupcao.aborto ?? null,
          evento: interrupcao.evento ?? null,
          confirmacao: prepararConfirmacaoMenu(caixa.registro ?? null),
        };
      }
    }
    registrarCancelamentoCom7({ confirmado: false });
    return {
      ...apresentar(caixa, null),
      ok: false,
      codigo: "FECHAMENTO_IMPEDIDO",
      mensagem: pedido?.pinpad ? classificarCancelamentoSdk("captura").motivo : MENSAGEM_CANCELAMENTO_IMPEDIDO,
      sessaoMantida: true,
      pagamentoRecebido: false,
      podeFinalizar: false,
      comandoEnviado: false,
      comandoDll: false,
    };
  }

  if (acao === "iniciar") {
    if (resultadosDesconhecidos.has(id)) {
      return recusa("desconhecido", "Há resultado desconhecido neste terminal. Nenhuma nova cobrança foi iniciada. O journal não foi apagado.");
    }
    if (sessoesAbertasSemExecucao.has(id)) {
      return recusa("sessao_aberta", "Há transação aberta sem execução financeira. Nenhuma nova cobrança foi iniciada.");
    }
    if (aberturas.has(id)) {
      return recusa("ocupada", "Há outra abertura neste terminal. Nenhuma nova venda foi iniciada.");
    }
    aberturas.add(id);
    try {
    for (const [outra, caixa] of sessoes) {
      if (outra !== id && transacaoResidenteAtiva(caixa.sessao)) {
        const mesmaEmpresa = outra.startsWith(`${empresaId}|`);
        return recusa(
          mesmaEmpresa ? "ocupada" : "isolada",
          mesmaEmpresa
            ? "Há outra transação nesta empresa. Nenhuma nova venda foi iniciada."
            : "Outra empresa já ocupa o Connector. Nenhuma transação foi iniciada."
        );
      }
    }
    const existente = sessoes.get(id);
    if (existente && transacaoResidenteAtiva(existente.sessao)) {
      return apresentar(existente, null);
    }
    if (portaOcupada() || input.portaPinpadOcupada === true) {
      return recusa("porta", "A porta do PinPad já está em uso. Nenhuma nova transação foi iniciada.");
    }
    const residenteAutorizada = input.sessaoResidenteAutorizada === true && input.transporte?.nativo === true && input.transporte?.simulado !== true;
    if ((input.transporte?.real === true && !residenteAutorizada) || (input.transporte?.nativo === true && input.ensaioNativo !== true && !residenteAutorizada) || (input.transporte?.nativo !== true && input.simulacao !== true)) {
      return recusa("execucao_fisica_bloqueada", MENSAGEM_EXECUCAO_FISICA_BLOQUEADA);
    }
    if (residenteAutorizada && (ocupacaoHomologacao()?.origem !== ORIGEM_COM7 || !exclusivaCom7(empresaId, terminalCodigo))) {
      return recusa("com7", "A COM7 não está reservada nesta sessão. PW_iNewTransac não foi chamado.");
    }
    const transporte = input.transporte;
    if (!transporte || typeof transporte.newTransac !== "function") {
      return recusa("transporte", "O transporte da biblioteca não foi ligado. Nenhum comando foi enviado.");
    }
    if (input.arquivoEtapa && input.idempotencyKey && Number(input.valorCentavos) > 0) {
      const previa = await gravarEtapaAntesDaExecucao(input.arquivoEtapa, {
        identificador: input.idempotencyKey,
        correlationId: input.idempotencyKey,
        valor: input.valorCentavos,
        etapa: "antes_de_PW_iNewTransac",
        retornoNewTransac: null,
        executada: false,
        empresaId,
        terminalCodigo,
        dispositivoId: input.dispositivoId,
        ambiente: input.ambiente,
      });
      if (previa.codigo === "outra") {
        return recusa("journal", "O journal de outra operação foi preservado. Nenhuma cobrança foi iniciada.");
      }
    }
    const sessao = criarSessaoContinua();
    sessao.transporte = transporte;
    sessao.inicializada = true;
    const codigo = await transporte.newTransac();
    sessao.novas = transporte.novas;
    if (codigo !== 0 || sessao.novas !== 1) {
      liberarReservaSemSessao();
      return recusa("recusa", "A transação não iniciou. Nenhum pagamento foi recebido.");
    }
    if (Number(input.valorCentavos) > 0) {
      const parametros = await informarParametrosVenda(transporte, {
        valorCentavos: input.valorCentavos,
        idempotencyKey: input.idempotencyKey,
      });
      if (!parametros.ok) {
        registrarSessaoAbertaSemExecucao(empresaId, terminalCodigo, { retornoNewTransac: 0 });
        return recusa("parametro", "Um parâmetro foi recusado antes de PW_iExecTransac. Nenhuma cobrança foi concluída.");
      }
    }
    if (input.arquivoEtapa && input.idempotencyKey) {
      await gravarEtapaAntesDaExecucao(input.arquivoEtapa, {
        identificador: input.idempotencyKey,
        correlationId: input.idempotencyKey,
        valor: input.valorCentavos,
        etapa: "apos_PW_iNewTransac",
        retornoNewTransac: 0,
        executada: false,
        empresaId,
        terminalCodigo,
        dispositivoId: input.dispositivoId,
        ambiente: input.ambiente,
      });
    }
    if (reservaCom7) reservaCom7.sessaoIniciada = true;
    const caixa = {
      empresaId,
      terminalCodigo,
      dispositivoId: input.dispositivoId || "",
      sessao,
      transporte,
      arquivoEtapa: input.arquivoEtapa || "",
      idempotencyKey: input.idempotencyKey || "",
    };
    sessoes.set(id, caixa);
    const abertura = await abrirCapturaResidente(sessao);
    if (abertura?.codigo === "captura" && input.arquivoEtapa && input.idempotencyKey) {
      await marcarExecucaoIniciada(input.arquivoEtapa, { correlationId: input.idempotencyKey });
    }
    if (abertura?.codigo !== "captura") {
      const classe = classificarEncerramentoNativo(abertura);
      const referencias = abertura?.referencias ?? {};
      const completas = REFERENCIAS_CONFIRMACAO.every((campo) => String(referencias[campo] ?? "").trim());
      if (classe === "aprovada" && completas) {
        const confirmacao = await confirmarAposPersistencia(caixa, referencias, caixa.idempotencyKey);
        if (confirmacao.confirmacaoChamada === true && confirmacao.pagamentoRecebido !== true) {
          registrarResultadoDesconhecidoCom7();
        }
        await encerrarJournalDaCaptura(caixa, {
          ...abertura,
          pagamentoRecebido: confirmacao.pagamentoRecebido === true,
          confirmacaoChamada: confirmacao.confirmacaoChamada === true,
        });
        return {
          ok: confirmacao.pagamentoRecebido === true,
          fase: "resultado",
          codigo: confirmacao.codigo,
          novas: sessao.novas,
          mensagem:
            confirmacao.pagamentoRecebido === true
              ? "PWINFO_CNFREQ pediu confirmação e PW_iConfirmation concluiu. O pagamento foi recebido."
              : "A confirmação exigida por PWINFO_CNFREQ não concluiu. Nenhuma nova cobrança foi iniciada.",
          pagamentoRecebido: confirmacao.pagamentoRecebido === true,
          podeFinalizar: confirmacao.pagamentoRecebido === true,
          nfcEEmitida: false,
          comandoDll: true,
          transacaoIniciada: true,
          confirmacaoChamada: confirmacao.confirmacaoChamada === true,
          journalApagado: false,
          novaCobranca: false,
        };
      }
      if (classe === "recusa") {
        await encerrarJournalDaCaptura(caixa, abertura);
        sessoes.delete(id);
        return recusa("recusa", abertura?.mensagemHost || "A transação foi recusada. Nenhum pagamento foi recebido.");
      }
      await encerrarJournalDaCaptura(caixa, abertura);
      sessoes.delete(id);
      registrarResultadoDesconhecidoCom7();
      return recusa(
        "desconhecido",
        abertura?.mensagemHost || "O resultado da transação é desconhecido. Nenhuma nova cobrança foi iniciada e o journal não foi apagado."
      );
    }
    marcarCapturaCom7(empresaId, terminalCodigo);
    return apresentar(caixa, null);
    } finally {
      aberturas.delete(id);
    }
  }

  const caixa = sessoes.get(id);
  if (caixa && input.arquivoEtapa) caixa.arquivoEtapa = input.arquivoEtapa;
  if (caixa && input.dispositivoId) caixa.dispositivoId = input.dispositivoId;
  if (!caixa || !transacaoResidenteAtiva(caixa.sessao)) {
    return recusa("SESSAO_PERDIDA", "A sessão de homologação não está mais ativa. Nenhum pagamento foi recebido.");
  }
  const pedido = pedidoParaOperador(caixa.sessao);
  if (!pedido) {
    return recusa("SESSAO_PERDIDA", "A sessão de homologação não está mais ativa. Nenhum pagamento foi recebido.");
  }
  if (pedido.pinpad) {
    return {
      ...apresentar(caixa, null),
      resultado: { codigo: "pinpad", mensagem: pedido.prompt },
    };
  }
  if (pedido.capturaId !== Number(input.capturaId)) {
    return recusa("DIVERGENTE", "A resposta não pertence ao menu atual. Nenhum valor foi enviado.", { novas: caixa.sessao.novas, sessaoMantida: true });
  }
  const valor = String(input.valor ?? "");
  const indices = (pedido.valores ?? []).flatMap((item, posicao) => (item === valor ? [posicao] : []));
  if (indices.length !== 1) {
    return recusa("OPCAO", "A resposta precisa ser um vszValorMenu devolvido pela biblioteca. Nenhum índice foi enviado.", {
      novas: caixa.sessao.novas,
      sessaoMantida: true,
    });
  }
  const novasAntes = caixa.transporte.novas;
  const resultado = await responderContinuidadeNativa(caixa.sessao, { indice: indices[0] });
  if (caixa.transporte.novas !== novasAntes) {
    return recusa("NOVA_TRANSACAO", "Outra transação foi recusada. O valor permaneceu na sessão atual.", { novas: caixa.sessao.novas });
  }
  const valorEnviado = caixa.transporte.params?.at(-1)?.[1] ?? valor;
  if (resultado?.codigo === "DUPLICADA" || resultado?.codigo === "OCUPADA") {
    return { ...recusa(resultado.codigo, "Esta escolha já foi enviada. A sessão não foi repetida."), novas: caixa.sessao.novas, sessaoMantida: true, valorEnviado };
  }
  if (resultado?.codigo !== "captura") {
    const classe = classificarEncerramentoNativo(resultado);
    const referencias = resultado?.referencias ?? {};
    const aprovada =
      classe === "aprovada" &&
      ["reqNum", "locRef", "extRef", "virtMerch", "authSyst"].every((campo) => String(referencias[campo] ?? "").trim());
    caixa.registro = {
      persistido: true,
      codigo: classe,
      referencias,
      referenciasOrigem: aprovada ? "pw_iGetResult" : "",
      autorizacaoFinanceira: aprovada,
    };
    caixa.journal = [...(caixa.journal ?? []), { etapa: "resultado", codigo: classe }];
    let confirmacaoOficial = null;
    if (aprovada) {
      confirmacaoOficial = await confirmarAposPersistencia(caixa, referencias, caixa.idempotencyKey || input.idempotencyKey);
      if (confirmacaoOficial.confirmacaoChamada === true && confirmacaoOficial.pagamentoRecebido !== true) {
        resultadosDesconhecidos.set(id, caixa.registro);
        registrarResultadoDesconhecidoCom7();
      }
    } else if (classe !== "recusa") {
      resultadosDesconhecidos.set(id, { correlationId: caixa.idempotencyKey || input.idempotencyKey || "" });
      registrarResultadoDesconhecidoCom7();
    }
    const retornoHost = Number(resultado?.retornoExec ?? resultado?.retorno);
    let journalPreservado = { gravado: false, preservado: true, journalApagado: false };
    const etapaPreservada = await encerrarJournalDaCaptura(caixa, {
      ...resultado,
      pagamentoRecebido: confirmacaoOficial?.pagamentoRecebido === true,
      confirmacaoChamada: confirmacaoOficial?.confirmacaoChamada === true,
    });
    if (classe === "desconhecido" && retornoHost === PWRET_FROMHOST && input.arquivoJournal) {
      const autorizacao = reservaCom7?.idempotencyKey ? autorizacoesOperacao.get(reservaCom7.idempotencyKey) : null;
      journalPreservado = await persistirResultadoDesconhecido(input.arquivoJournal, {
        correlationId: String(reservaCom7?.idempotencyKey ?? input.idempotencyKey ?? ""),
        valor: Number(autorizacao?.valorCentavos ?? input.valorCentavos),
        dataHoraInicio: new Date().toISOString(),
      });
    }
    return {
      ...apresentar(caixa, valorEnviado),
      ok: classe === "aprovada",
      fase: "resultado",
      codigo: classe,
      mensagem:
        classe === "aprovada"
          ? "A biblioteca aprovou a transação. O pagamento só é recebido depois da confirmação."
          : classe === "recusa"
            ? resultado?.mensagemHost || "A transação foi recusada. Nenhum pagamento foi recebido."
            : resultado?.mensagemHost || "O resultado é desconhecido. Nenhuma nova cobrança foi iniciada e o journal não foi apagado.",
      resultado: { codigo: classe, retorno: resultado?.retornoExec ?? resultado?.retorno ?? null, mensagem: resultado?.mensagemHost || "" },
      pagamentoRecebido: confirmacaoOficial?.pagamentoRecebido === true,
      podeFinalizar: confirmacaoOficial?.pagamentoRecebido === true,
      nfcEEmitida: false,
      confirmacaoChamada: confirmacaoOficial?.confirmacaoChamada === true,
      confirmacao: confirmacaoOficial ?? prepararConfirmacaoMenu(caixa.registro),
      journalApagado: false,
      journalPreservado: journalPreservado.preservado === true,
      journalGravado: journalPreservado.gravado === true,
      novaCobranca: false,
      idempotencyKey: reservaCom7?.idempotencyKey ?? "",
    };
  }
  return apresentar(caixa, valorEnviado);
}
