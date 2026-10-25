import fs from "node:fs/promises";
import path from "node:path";

import { calcularPwinfoAutcap } from "./tef-autcap.mjs";
import { medirLayoutFinanceiro, TAMANHO_PW_GETDATA } from "./tef-layout-financeiro.mjs";
import {
  lerPendenciaTef,
  OPERACAO_VENDA_PERDIDA,
  STATUS_JOURNAL_TEF,
} from "./tef-pendencia.mjs";
import { classificarPendenciaNativa, decidirConfirmacaoNativa } from "./tef-venda-nativa.mjs";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO, PWDAT, PWINFO, PWOPER, PWRET, horarioIdle } from "./tef-pgweb.mjs";

export const FRASE_CONFIRMACAO = "AUTORIZO_TESTE_NATIVO_HOMOLOGACAO";
export const BUFFER_RESULTADO = 4096;
export const CAPTURAS_MAX = 9;
export const HOST_PRODUCAO = "pos-transac.pgweb.io";

const ABERTOS = new Set([
  "iniciada",
  "autorizada",
  "vinculada",
  "desconhecida",
  "desfazimento_pendente",
  "reconciliacao",
  "aguardando_confirmacao",
  "aguardando_captura",
  STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO,
  STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
  STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO,
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function perfilConectorHomologacao(raiz) {
  const normal = path.win32.normalize(String(raiz ?? "")).toLowerCase();
  if (!normal.endsWith("\\ultraPDV\\conector-homologacao".toLowerCase())) return "";
  if (normal.includes("\\producao\\") || normal.includes("\\paygo\\") || normal.includes(HOST_PRODUCAO)) return "";
  return path.win32.normalize(String(raiz));
}

export function diretorioDoPerfil(raiz) {
  const perfil = perfilConectorHomologacao(raiz);
  if (!perfil) return "";
  const diretorio = path.win32.join(perfil, "TEF", "Homologacao", "PGWeb");
  const normal = diretorio.toLowerCase();
  if (!normal.includes("\\conector-homologacao\\") || !normal.includes("\\homologacao\\")) return "";
  if (normal.includes("\\producao\\") || normal.includes("\\paygo\\")) return "";
  return diretorio;
}

export function classificarServidor(texto, servidores = {}) {
  const bruto = String(texto ?? "").toLowerCase();
  if (!bruto.trim()) return "ausente";
  const producao = String(servidores.producao ?? "").trim().toLowerCase();
  const homologacao = String(servidores.homologacao ?? "").trim().toLowerCase();
  if (bruto.includes(HOST_PRODUCAO) || (producao && bruto.includes(producao))) return "producao";
  if (homologacao && bruto.includes(homologacao)) return "homologacao";
  if (/\b(?:hmg|homolog|sandbox|lab)\b/.test(bruto)) return "homologacao";
  return "desconhecido";
}

export function decidirRecuperacaoTecnica(journal) {
  return classificarPendenciaNativa(journal);
}

export function interpretarRetornoNativo(etapa, codigo) {
  const transacaoIniciada = etapa === "PW_iNewTransac" && Number(codigo) === 0;
  return {
    etapa,
    codigo: Number(codigo),
    transacaoIniciada,
    pagamentoAprovado: false,
    pagamentoRecebido: false,
    podeFinalizar: false,
  };
}

function impedimento(codigo, mensagem, extra = {}) {
  return {
    pronto: false,
    executar: false,
    codigo,
    mensagem,
    pagamentoRecebido: false,
    podeFinalizar: false,
    motorDefinitivoBloqueado: ABI_COMPROVADO !== true || LAYOUT_HOMOLOGADO !== true,
    ...extra,
  };
}

export function validarParametrosVenda(pedido = {}) {
  const faltas = [];
  const valor = Number(pedido.valorCentavos);
  if (!Number.isInteger(valor) || valor <= 0) faltas.push("valorCentavos");
  if (pedido.modalidade !== "debito" && pedido.modalidade !== "credito") faltas.push("modalidade");
  const parcelas = Number(pedido.parcelas ?? 1);
  if (!Number.isInteger(parcelas) || parcelas < 1 || (pedido.modalidade === "debito" && parcelas !== 1)) {
    faltas.push("parcelas");
  }
  if (pedido.moeda !== "986") faltas.push("moeda");
  if (pedido.expoente !== "2") faltas.push("expoente");
  if (!UUID.test(String(pedido.identificador ?? "")) || !UUID.test(String(pedido.idempotencyKey ?? ""))) {
    faltas.push("identificador");
  }
  if (pedido.identificador === pedido.idempotencyKey) faltas.push("identificador");
  if (Number(pedido.operacao) !== PWOPER.SALE) faltas.push("operacao");
  if (Number(pedido.capturasMax) !== CAPTURAS_MAX) faltas.push("capturas");
  if (Number(pedido.bufferResultado) !== BUFFER_RESULTADO) faltas.push("bufferResultado");
  if (Number(pedido.tamanhoGetData) !== TAMANHO_PW_GETDATA) faltas.push("PW_GetData");
  if (pedido.autcap !== calcularPwinfoAutcap()) faltas.push("autcap");
  const obrigatorios = [
    PWINFO.AUTNAME,
    PWINFO.AUTVER,
    PWINFO.AUTDEV,
    PWINFO.AUTCAP,
    PWINFO.TOTAMNT,
    PWINFO.CURRENCY,
    PWINFO.CURREXP,
    PWINFO.FISCALREF,
    PWINFO.INSTALLMENTS,
  ];
  if (!Array.isArray(pedido.parametros) || obrigatorios.some((info) => !pedido.parametros.includes(info))) {
    faltas.push("parametros");
  }
  if (pedido.incluiCnpj === true || pedido.incluiPonto === true) faltas.push("credencial");
  if (pedido.setEnvironment === true) faltas.push("setEnvironment");
  return faltas;
}

export function avaliarTesteNativoHomologacao(input = {}) {
  if (ABI_COMPROVADO === true || LAYOUT_HOMOLOGADO === true) {
    return impedimento(
      "motor",
      "O motor definitivo não pode estar liberado para este teste técnico."
    );
  }
  const perfil = perfilConectorHomologacao(input.perfil);
  const diretorio = diretorioDoPerfil(input.perfil);
  if (!perfil || input.diretorio !== diretorio) {
    return impedimento(
      "perfil",
      "O teste só aceita o perfil conector-homologacao e o diretório TEF\\Homologacao\\PGWeb."
    );
  }
  const journal = path.win32.normalize(String(input.journal ?? ""));
  if (!journal.toLowerCase().startsWith(`${perfil.toLowerCase()}\\`)) {
    return impedimento("journal", "O journal precisa estar dentro de conector-homologacao.");
  }
  if (input.pontoInstalado !== true) {
    return impedimento("ponto", "O ponto de homologação não está comprovado neste perfil.");
  }
  if (input.servidor !== "homologacao") {
    return impedimento(
      "servidor",
      input.servidor === "producao"
        ? "O perfil contém o servidor de produção. O teste foi interrompido."
        : "O servidor de homologação não está comprovado neste perfil."
    );
  }
  if ((input.chavesEncerradas ?? []).includes(input.pedido?.idempotencyKey)) {
    return impedimento("repetida", "A chave encerrada não foi reutilizada. Nenhum comando foi enviado.");
  }
  if (
    input.journalRegistro?.status === "sessao_nativa_perdida_sem_autorizacao" &&
    input.journalRegistro.correlationId === input.pedido?.idempotencyKey
  ) {
    return impedimento("repetida", "A chave encerrada não foi reutilizada. Nenhum comando foi enviado.");
  }
  if (input.journalPendente === true || ABERTOS.has(input.journalStatus)) {
    return impedimento("pendencia", "Há transação pendente. Nenhum comando foi preparado para envio.");
  }
  const sessoes = Array.isArray(input.sessoes) ? input.sessoes : [];
  if (
    sessoes.some(
      (item) => ABERTOS.has(item?.status) && item?.idempotencyKey === input.pedido?.idempotencyKey
    )
  ) {
    return impedimento("idempotencia", "A chave de idempotência já está em uso.");
  }
  if (sessoes.some((item) => ABERTOS.has(item?.status))) {
    return impedimento("idempotencia", "Há outra operação aberta. A chave nova não foi enviada.");
  }
  const faltas = validarParametrosVenda(input.pedido);
  if (faltas.length > 0) {
    return impedimento("parametros", "Há parâmetro ou buffer inválido.", { faltas });
  }
  if (input.layoutConferido !== true) {
    return impedimento("layout", "O layout de PW_GetData não foi conferido nesta execução.");
  }
  if (input.confirmacao !== FRASE_CONFIRMACAO) {
    return impedimento(
      "confirmacao",
      "Falta a confirmação explícita do operador. Nenhuma chamada financeira foi feita."
    );
  }
  return {
    pronto: true,
    executar: false,
    codigo: "pronto",
    mensagem: "A pré-validação passou. O teste nativo ainda não foi executado.",
    pagamentoRecebido: false,
    podeFinalizar: false,
    motorDefinitivoBloqueado: true,
    faltas: [],
  };
}

export function pedidoTecnicoPadrao(identificador, idempotencyKey) {
  return {
    valorCentavos: 100,
    modalidade: "debito",
    parcelas: 1,
    moeda: "986",
    expoente: "2",
    identificador,
    idempotencyKey,
    operacao: PWOPER.SALE,
    capturasMax: CAPTURAS_MAX,
    bufferResultado: BUFFER_RESULTADO,
    tamanhoGetData: TAMANHO_PW_GETDATA,
    autcap: calcularPwinfoAutcap(),
    parametros: [
      PWINFO.AUTNAME,
      PWINFO.AUTVER,
      PWINFO.AUTDEV,
      PWINFO.AUTCAP,
      PWINFO.TOTAMNT,
      PWINFO.CURRENCY,
      PWINFO.CURREXP,
      PWINFO.FISCALREF,
      PWINFO.INSTALLMENTS,
    ],
    incluiCnpj: false,
    incluiPonto: false,
    setEnvironment: false,
  };
}

export async function lerSinaisDoPerfil(perfil, deps = {}) {
  const raiz = perfilConectorHomologacao(perfil);
  const diretorio = diretorioDoPerfil(perfil);
  if (!raiz || !diretorio) {
    return { pontoInstalado: false, servidor: "ausente", journalPendente: false, journal: "" };
  }
  const lerDir = deps.lerDir ?? fs.readdir;
  const lerArquivo = deps.lerArquivo ?? fs.readFile;
  const dados = path.win32.join(diretorio, "Data");
  let nomes = [];
  try {
    nomes = await lerDir(dados);
  } catch {
    nomes = [];
  }
  const presentes = new Set(nomes.map((nome) => String(nome).toLowerCase()));
  const pontoInstalado = presentes.has("certificado.crt") && presentes.has("check.pos");
  let classe = "ausente";
  const candidatos = [];
  for (const nome of nomes) {
    const item = String(nome).toLowerCase();
    if (item.endsWith(".ini") || item.endsWith(".log") || item.endsWith(".pos")) {
      candidatos.push(path.win32.join(dados, nome));
    }
  }
  let logs = [];
  try {
    logs = await lerDir(path.win32.join(diretorio, "Log"));
  } catch {
    logs = [];
  }
  for (const nome of logs) {
    if (String(nome).toLowerCase().endsWith(".log")) {
      candidatos.push(path.win32.join(diretorio, "Log", nome));
    }
  }
  for (const arquivo of candidatos) {
    let texto = "";
    try {
      texto = await lerArquivo(arquivo);
    } catch {
      if (classe === "ausente") classe = "desconhecido";
      continue;
    }
    const atual = classificarServidor(
      Buffer.isBuffer(texto) ? texto.toString("latin1") : String(texto),
      deps.servidores
    );
    if (atual === "producao") {
      classe = "producao";
      break;
    }
    if (atual === "homologacao") classe = "homologacao";
    else if (classe === "ausente") classe = atual;
  }
  const journals = [
    path.win32.join(raiz, "tef-journal-teste-nativo.json"),
    path.win32.join(raiz, "tef-journal-venda-100.json"),
  ];
  let journalPendente = false;
  const chavesEncerradas = [];
  for (const arquivo of journals) {
    const pendencia = await lerPendenciaTef(arquivo, deps.fsApi);
    if (pendencia.ok !== true || Boolean(pendencia.registro)) journalPendente = true;
    if (pendencia.encerrado?.status === "resultado_desconhecido") journalPendente = true;
    if (pendencia.encerrado?.correlationId) chavesEncerradas.push(pendencia.encerrado.correlationId);
  }
  return {
    pontoInstalado,
    servidor: classe,
    journalPendente,
    chavesEncerradas,
    journal: journals[0],
    diretorio,
  };
}

function valorParametro(info, pedido) {
  if (info === PWINFO.AUTNAME || info === PWINFO.AUTDEV) return "UltraPDV";
  if (info === PWINFO.AUTVER) return "2.0.0";
  if (info === PWINFO.AUTCAP) return pedido.autcap;
  if (info === PWINFO.TOTAMNT) return String(pedido.valorCentavos);
  if (info === PWINFO.CURRENCY) return pedido.moeda;
  if (info === PWINFO.CURREXP) return pedido.expoente;
  if (info === PWINFO.FISCALREF) return pedido.identificador;
  if (info === PWINFO.INSTALLMENTS) return String(pedido.parcelas);
  return "";
}

const TIPOS_PINPAD = new Set([
  PWDAT.CARDINF,
  PWDAT.PPENTRY,
  PWDAT.PPENCPIN,
  PWDAT.CARDOFF,
  PWDAT.CARDONL,
  PWDAT.PPCONF,
  PWDAT.PPREMCRD,
  PWDAT.PPGENCMD,
  PWDAT.PPDATAPOSCNF,
]);

function textoCaptura(valor, limite) {
  return String(valor ?? "").split("\0")[0].replace(/\s+$/g, "").slice(0, limite);
}

function listaCaptura(valor, limite, quantidade) {
  if (!Array.isArray(valor)) return [];
  const total = quantidade > 0 ? quantidade : valor.length;
  const itens = [];
  for (let indice = 0; indice < total && indice < 40; indice += 1) {
    itens.push(textoCaptura(valor[indice], limite));
  }
  while (itens.length > 0 && itens.at(-1) === "") itens.pop();
  return itens;
}

export function criarSessaoContinua() {
  return {
    viva: false,
    captura: null,
    capturaId: 0,
    respondidaId: 0,
    respondendo: false,
    conduzindo: false,
    transporte: null,
    novas: 0,
    correlationId: "",
    cancelada: false,
    inicializada: false,
    idleOcupado: false,
    proximaOciosidade: null,
    timerOciosidade: null,
    agendarOciosidade: null,
  };
}

export function transacaoResidenteAtiva(sessao) {
  return sessao?.viva === true || sessao?.conduzindo === true || sessao?.respondendo === true || Boolean(sessao?.captura);
}

export function suspenderOciosidade(sessao) {
  if (sessao?.timerOciosidade) {
    clearTimeout(sessao.timerOciosidade);
    sessao.timerOciosidade = null;
  }
}

export async function pulsoOciosidadeResidente(sessao, agora = new Date()) {
  if (!sessao?.inicializada || typeof sessao.transporte?.idleProc !== "function") {
    return { executou: false, motivo: "biblioteca" };
  }
  if (transacaoResidenteAtiva(sessao)) return { executou: false, motivo: "transacao" };
  if (sessao.idleOcupado) return { executou: false, motivo: "concorrente" };
  if (!(sessao.proximaOciosidade instanceof Date) || agora.getTime() < sessao.proximaOciosidade.getTime()) {
    return { executou: false, motivo: "aguardando" };
  }
  sessao.idleOcupado = true;
  try {
    const codigo = await sessao.transporte.idleProc();
    const lido = typeof sessao.transporte.getResult === "function"
      ? await sessao.transporte.getResult(PWINFO.IDLEPROCTIME)
      : { codigo: PWRET.NODATA, valor: "" };
    sessao.proximaOciosidade = lido?.codigo === PWRET.OK ? horarioIdle(String(lido.valor ?? "").trim()) : null;
    return { executou: true, codigo, proxima: sessao.proximaOciosidade };
  } finally {
    sessao.idleOcupado = false;
  }
}

export async function sincronizarOciosidadeResidente(sessao) {
  if (!sessao?.inicializada || transacaoResidenteAtiva(sessao) || sessao.idleOcupado) return { executou: false, motivo: "suspenso" };
  if (typeof sessao.transporte?.getResult !== "function") return { executou: false, motivo: "biblioteca" };
  const lido = await sessao.transporte.getResult(PWINFO.IDLEPROCTIME);
  sessao.proximaOciosidade = lido?.codigo === PWRET.OK ? horarioIdle(String(lido.valor ?? "").trim()) : null;
  programarOciosidadeResidente(sessao);
  return { executou: false, motivo: "aguardando", proxima: sessao.proximaOciosidade };
}

export function programarOciosidadeResidente(sessao, agendar = sessao?.agendarOciosidade) {
  suspenderOciosidade(sessao);
  if (!sessao || typeof agendar !== "function" || !(sessao.proximaOciosidade instanceof Date)) return;
  if (transacaoResidenteAtiva(sessao)) return;
  const atraso = Math.max(0, sessao.proximaOciosidade.getTime() - Date.now());
  sessao.timerOciosidade = agendar(() => {
    void pulsoOciosidadeResidente(sessao).then(() => programarOciosidadeResidente(sessao, agendar));
  }, atraso);
}

function vetorInformado(valor, limite, quantidade) {
  if (!Array.isArray(valor)) return null;
  return listaCaptura(valor, limite, quantidade > 0 ? quantidade : valor.length);
}

export function normalizarCapturaNativa(item) {
  if (!item || typeof item !== "object") return null;
  const tipo = Number(item.bTipoDeDado ?? item.tipo);
  const quantidade = Number(item.bNumOpcoesMenu) || 0;
  const identificador = Number(item.wIdentificador ?? item.identificador);
  const colapsado = typeof item.vszTextoMenu === "string" || typeof item.vszValorMenu === "string";
  const opcoes = vetorInformado(item.opcoes, 41, 0) ?? (colapsado ? [] : vetorInformado(item.vszTextoMenu, 41, quantidade) ?? []);
  const valores = vetorInformado(item.valores, 256, 0) ?? (colapsado ? [] : vetorInformado(item.vszValorMenu, 256, quantidade) ?? []);
  const esperado = quantidade > 0 ? quantidade : opcoes.length;
  const menuIncompleto =
    tipo === PWDAT.MENU &&
    (colapsado ||
      item.ok === false ||
      item.codigo === "MENU_INCOMPLETO" ||
      esperado < 1 ||
      opcoes.length !== esperado ||
      valores.length !== esperado ||
      valores.some((valor) => valor === ""));
  const indiceInformado = Number(item.uiIndex ?? item.indice);
  return {
    identificador: Number.isFinite(identificador) ? identificador : 0,
    indice: Number.isInteger(indiceInformado) && indiceInformado >= 0 ? indiceInformado : 0,
    tipo: Number.isFinite(tipo) ? tipo : 0,
    prompt: textoCaptura(item.szPrompt ?? item.prompt, 84),
    opcoes,
    valores,
    pinpad: TIPOS_PINPAD.has(tipo),
    exibicao: tipo === PWDAT.DSPCHECKOUT || tipo === PWDAT.DSPQRCODE,
    sensivel: tipo === PWDAT.PPENCPIN,
    leitura: menuIncompleto ? "MENU_INCOMPLETO" : "ok",
  };
}

export function retomavelPorJournal() {
  return false;
}

export function registrarContinuidade(registro, evento = {}) {
  const anterior = structuredClone(registro ?? {});
  return {
    ...anterior,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    desfazimentoChamado: false,
    autorizacaoFinanceira: false,
    eventos: [
      ...(Array.isArray(anterior.eventos) ? anterior.eventos : []),
      {
        em: evento.em ?? "",
        codigo: Number(evento.codigo),
        tipo: evento.tipo ?? null,
        info: evento.info ?? null,
      },
    ],
  };
}

export function processoResidente(sessao) {
  return {
    encerrar: false,
    viva: sessao?.viva === true,
    novas: sessao?.novas ?? 0,
    interacoes: sessao?.capturaId ?? 0,
  };
}

const METODO_PINPAD = new Map([
  [PWDAT.CARDINF, "ppGetCard"],
  [PWDAT.PPENTRY, "ppGetData"],
  [PWDAT.PPENCPIN, "ppGetPIN"],
  [PWDAT.CARDOFF, "ppGoOnChip"],
  [PWDAT.CARDONL, "ppFinishChip"],
  [PWDAT.PPCONF, "ppConfirmData"],
  [PWDAT.PPREMCRD, "ppRemoveCard"],
  [PWDAT.PPGENCMD, "ppGenericCMD"],
  [PWDAT.PPDATAPOSCNF, "ppPositiveConfirmation"],
]);

const REFERENCIAS_FINANCEIRAS = [
  ["reqNum", PWINFO.REQNUM],
  ["locRef", PWINFO.AUTLOCREF],
  ["extRef", PWINFO.AUTEXTREF],
  ["virtMerch", PWINFO.VIRTMERCH],
  ["authSyst", PWINFO.AUTHSYST],
];

function resultadoResidente(sessao, codigo, extra = {}) {
  return {
    encerrar: false,
    codigo,
    novas: sessao?.novas ?? 0,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    retomavel: false,
    ...extra,
  };
}

export function pedidoParaOperador(sessao) {
  const captura = sessao?.captura;
  if (!sessao?.viva || !captura) return null;
  return {
    capturaId: sessao.capturaId,
    identificador: captura.identificador,
    tipo: captura.tipo,
    prompt: captura.prompt,
    opcoes: [...captura.opcoes],
    valores: [...(captura.valores ?? [])],
    pinpad: captura.pinpad === true,
    exibicao: captura.exibicao === true,
  };
}

export function validarRespostaOperador(pedido, resposta) {
  if (!pedido || !resposta || resposta.capturaId !== pedido.capturaId) {
    return { ok: false, codigo: "DIVERGENTE" };
  }
  if (resposta.timeout === true) return { ok: true, pedido: { timeout: true } };
  if (resposta.cancelar === true) return { ok: true, pedido: { cancelar: true } };
  if (pedido.pinpad || pedido.exibicao) return { ok: false, codigo: "PINPAD" };
  if (pedido.tipo === PWDAT.MENU) {
    return { ok: true, pedido: { indice: resposta.indice } };
  }
  return { ok: true, pedido: { valor: resposta.valor } };
}

async function lerReferencias(transporte) {
  const referencias = {};
  if (typeof transporte?.getResult !== "function") return referencias;
  for (const [nome, info] of REFERENCIAS_FINANCEIRAS) {
    const lido = await transporte.getResult(info);
    referencias[nome] = String(lido?.valor ?? "").trim();
  }
  return referencias;
}

async function encerrarExecucao(sessao, resultado) {
  if (resultado?.codigo !== "executada") return { ...resultado, encerrar: false, retomavel: false };
  const referencias = await lerReferencias(sessao.transporte);
  const confirmacao = decidirConfirmacaoNativa({ referencias, autorizacaoFinanceira: false });
  return {
    ...resultado,
    encerrar: false,
    retomavel: false,
    referencias,
    confirmacao,
    confirmacaoChamada: false,
    pagamentoRecebido: false,
  };
}

export async function acionarPinpadSeNecessario(sessao) {
  if (!pedidoParaOperador(sessao)?.pinpad) return null;
  return atenderPinpadResidente(sessao, {});
}

async function atenderPinpadResidente(sessao, deps) {
  const metodo = METODO_PINPAD.get(sessao.captura?.tipo);
  const funcao = sessao.transporte?.[metodo];
  const loop = sessao.transporte?.ppEventLoop;
  if (typeof funcao !== "function" || typeof loop !== "function") {
    return resultadoResidente(sessao, "PINPAD_AUSENTE", { solicitacao: sessao.captura });
  }
  if (sessao.capturaPinpadIniciada !== true) {
    const indice = Number.isInteger(sessao.captura?.indice) ? sessao.captura.indice : 0;
    const inicio = metodo === "ppRemoveCard" ? Number(await funcao()) : Number(await funcao(indice));
    if (inicio !== PWRET.OK) {
      sessao.viva = false;
      sessao.capturaPinpadIniciada = false;
      return resultadoResidente(sessao, "PINPAD", { retorno: inicio, aborto: null, evento: null });
    }
    sessao.capturaPinpadIniciada = true;
  }
  const maximo = Number(deps.maximoEventos) > 0 ? Number(deps.maximoEventos) : 180;
  const encerrar = (nome, codigo) => {
    sessao.viva = false;
    sessao.capturaPinpadIniciada = false;
    return resultadoResidente(sessao, nome, {
      retorno: codigo,
      aborto: sessao.aborto ?? null,
      evento: codigo,
    });
  };
  for (let sonda = 0; sonda < maximo; sonda += 1) {
    if (sessao.interromperCaptura === true && sessao.aborto == null && typeof sessao.transporte.ppAbort === "function") {
      sessao.aborto = Number(await sessao.transporte.ppAbort());
    }
    const evento = await loop();
    const codigo = Number(evento?.codigo ?? evento);
    if (typeof deps.exibir === "function" && evento?.display) deps.exibir(String(evento.display));
    if (codigo === PWRET.NOTHING || codigo === PWRET.DISPLAY) {
      if (typeof deps.esperar === "function") await deps.esperar(500);
      continue;
    }
    if (codigo === PWRET.OK || codigo === PWRET.FALLBACK) {
      sessao.capturaPinpadIniciada = false;
      return { codigo: "seguinte", aborto: sessao.aborto ?? null, evento: codigo };
    }
    if (codigo === PWRET.TIMEOUT || codigo === PWRET.PPCOMERR || codigo === PWRET.CANCEL) {
      const nome = codigo === PWRET.TIMEOUT ? "TIMEOUT" : codigo === PWRET.PPCOMERR ? "DESCONEXAO" : "CANCELADA_PINPAD";
      return encerrar(nome, codigo);
    }
    return encerrar("PINPAD", codigo);
  }
  return resultadoResidente(sessao, "EM_CURSO", {
    aborto: null,
    evento: null,
    capturaPinpadIniciada: true,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
  });
}

async function concluirCapturaCancelada(sessao, pinpad) {
  const aborto = pinpad?.aborto == null ? null : Number(pinpad.aborto);
  const base = {
    ...pinpad,
    aborto: pinpad?.aborto ?? null,
    evento: pinpad?.evento ?? null,
    capturaCancelada: true,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    transacaoEncerrada: false,
  };
  if (aborto != null && aborto !== PWRET.OK) return base;
  const seguida = await executarContinuacao(sessao);
  const transacaoEncerrada = Number(seguida?.retornoExec) === PWRET.CANCEL;
  return {
    ...seguida,
    aborto: base.aborto,
    evento: base.evento,
    capturaCancelada: true,
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    transacaoEncerrada,
    codigo: transacaoEncerrada ? "transacao_cancelada" : seguida?.codigo,
  };
}

export async function continuarCapturasPinpad(sessao, maximo = 12, deps = {}) {
  let resultado = null;
  const limite = Number(maximo) > 0 ? Number(maximo) : 12;
  for (let etapa = 0; etapa < limite; etapa += 1) {
    if (!pedidoParaOperador(sessao)?.pinpad && sessao?.capturaPinpadIniciada !== true) break;
    const anterior = sessao.capturaId;
    resultado = await executarCapturaPinpad(sessao, deps);
    if (resultado?.codigo === "EM_CURSO") break;
    const segueNoPinpad = resultado?.codigo === "captura" && pedidoParaOperador(sessao)?.pinpad === true;
    if (!segueNoPinpad || sessao.capturaId === anterior) break;
  }
  return resultado;
}

export async function executarCapturaPinpad(sessao, deps = {}) {
  if (!pedidoParaOperador(sessao)?.pinpad && sessao?.capturaPinpadIniciada !== true) {
    return resultadoResidente(sessao, "sem_captura", { aborto: null, evento: null, pagamentoRecebido: false });
  }
  if (sessao.conduzindo || sessao.respondendo) return resultadoResidente(sessao, "OCUPADA");
  sessao.conduzindo = true;
  let codigoCaptura = "";
  try {
    const pinpad = await atenderPinpadResidente(sessao, {
      esperar: deps.esperar ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms))),
      maximoEventos: deps.maximoEventos,
      exibir: deps.exibir,
    });
    codigoCaptura = pinpad?.codigo ?? "";
    if (pinpad.codigo === "CANCELADA_PINPAD") return await concluirCapturaCancelada(sessao, pinpad);
    if (pinpad.codigo !== "seguinte") return { ...pinpad, pagamentoRecebido: false, transacaoEncerrada: false };
    const seguida = await executarContinuacao(sessao);
    return {
      ...seguida,
      aborto: pinpad.aborto ?? null,
      evento: pinpad.evento ?? null,
      pagamentoRecebido: false,
    };
  } finally {
    sessao.conduzindo = false;
    if (codigoCaptura !== "EM_CURSO") sessao.capturaPinpadIniciada = false;
  }
}

export async function conduzirProcessoResidente(sessao, deps = {}) {
  if (sessao?.correlationId === OPERACAO_VENDA_PERDIDA.correlationId) {
    return resultadoResidente(sessao, "REPETIDA");
  }
  if (!sessao?.viva || !sessao.captura || !sessao.transporte) {
    return resultadoResidente(sessao, "SESSAO_PERDIDA");
  }
  if (sessao.conduzindo || sessao.respondendo) return resultadoResidente(sessao, "OCUPADA");
  if (typeof deps.aguardarResposta !== "function") return resultadoResidente(sessao, "SEM_OPERADOR");
  sessao.conduzindo = true;
  try {
    for (let volta = 0; volta < 12 && sessao.viva; volta += 1) {
      const pedido = pedidoParaOperador(sessao);
      if (pedido?.pinpad) {
        const pinpad = await atenderPinpadResidente(sessao, deps);
        if (pinpad.codigo === "CANCELADA_PINPAD") return await concluirCapturaCancelada(sessao, pinpad);
        if (pinpad.codigo !== "seguinte") return pinpad;
        const seguida = await encerrarExecucao(sessao, await executarContinuacao(sessao));
        if (seguida.codigo !== "captura") return seguida;
        continue;
      }
      if (pedido?.exibicao) {
        if (typeof deps.exibir === "function") deps.exibir(pedido.prompt);
        const seguida = await encerrarExecucao(sessao, await executarContinuacao(sessao));
        if (seguida.codigo !== "captura") return seguida;
        continue;
      }
      let resposta;
      try {
        resposta = await deps.aguardarResposta(pedido);
      } catch {
        sessao.viva = false;
        return resultadoResidente(sessao, "DESCONEXAO");
      }
      const validada = validarRespostaOperador(pedido, resposta);
      if (!validada.ok) return resultadoResidente(sessao, validada.codigo);
      if (validada.pedido.timeout === true) {
        sessao.viva = false;
        return resultadoResidente(sessao, "TIMEOUT");
      }
      const resultado = await encerrarExecucao(sessao, await responderContinuidadeNativa(sessao, validada.pedido));
      if (resultado.codigo !== "captura") return { ...resultado, encerrar: false, retomavel: false };
    }
    sessao.viva = false;
    return resultadoResidente(sessao, "LIMITE");
  } catch {
    sessao.viva = false;
    return resultadoResidente(sessao, "DESCONEXAO");
  } finally {
    sessao.conduzindo = false;
    if (!transacaoResidenteAtiva(sessao)) await sincronizarOciosidadeResidente(sessao);
  }
}

function publicarCaptura(sessao, item) {
  const captura = normalizarCapturaNativa(item);
  sessao.viva = true;
  sessao.captura = captura;
  sessao.capturaId += 1;
  sessao.respondidaId = 0;
  return captura;
}

async function lerDiagnosticoHost(transporte) {
  if (typeof transporte?.getResult !== "function") return {};
  const mensagem = await transporte.getResult(PWINFO.RESULTMSG);
  const identificador = await transporte.getResult(PWINFO.RESULTID);
  return {
    mensagemHost: String(mensagem?.valor ?? "").split("\0")[0].trim(),
    resultadoId: String(identificador?.valor ?? "").split("\0")[0].trim(),
  };
}

async function executarContinuacao(sessao) {
  const transporte = sessao.transporte;
  for (let volta = 0; volta < 8; volta += 1) {
    const execucao = await transporte.execTransac(9);
    const codigo = Number(execucao?.codigo);
    if (codigo === PWRET.NOTHING || codigo === PWRET.DISPLAY) continue;
    if (codigo === PWRET.MOREDATA) {
      const captura = publicarCaptura(sessao, execucao?.captura?.[0] ?? null);
      return {
        ok: true,
        codigo: "captura",
        solicitacao: captura,
        pagamentoRecebido: false,
        confirmacaoChamada: false,
        novas: sessao.novas,
      };
    }
    sessao.viva = false;
    sessao.captura = null;
    const encerrado = {
      ok: codigo === PWRET.OK,
      codigo: codigo === PWRET.OK ? "executada" : "erro",
      retornoExec: codigo,
      pagamentoRecebido: false,
      confirmacaoChamada: false,
      novas: sessao.novas,
    };
    if (codigo === PWRET.OK) return { ...encerrado, referencias: await lerReferencias(transporte) };
    return { ...encerrado, ...(await lerDiagnosticoHost(transporte)) };
  }
  return {
    ok: false,
    codigo: "nada",
    pagamentoRecebido: false,
    confirmacaoChamada: false,
    novas: sessao.novas,
  };
}

export async function abrirCapturaResidente(sessao) {
  if (!sessao?.transporte || sessao.novas !== 1) {
    return resultadoResidente(sessao, sessao?.novas > 1 ? "OCUPADA" : "SESSAO_PERDIDA");
  }
  return executarContinuacao(sessao);
}

export async function responderContinuidadeNativa(sessao, pedido = {}) {
  if (!sessao?.viva || !sessao.captura || !sessao.transporte) {
    return { ok: false, codigo: "SESSAO_PERDIDA", novas: sessao?.novas ?? 0, pagamentoRecebido: false, confirmacaoChamada: false };
  }
  if (sessao.respondendo) {
    return { ok: false, codigo: "OCUPADA", novas: sessao.novas, pagamentoRecebido: false, confirmacaoChamada: false };
  }
  if (sessao.respondidaId === sessao.capturaId) {
    return { ok: false, codigo: "DUPLICADA", novas: sessao.novas, pagamentoRecebido: false, confirmacaoChamada: false };
  }
  if (pedido.cancelar === true) {
    sessao.viva = false;
    sessao.captura = null;
    sessao.cancelada = true;
    return { ok: true, codigo: "cancelada", novas: sessao.novas, pagamentoRecebido: false, confirmacaoChamada: false };
  }
  const captura = sessao.captura;
  if (captura.pinpad || captura.sensivel) {
    return { ok: false, codigo: "PINPAD", novas: sessao.novas, solicitacao: captura, pagamentoRecebido: false, confirmacaoChamada: false };
  }
  if (captura.exibicao) {
    return { ok: false, codigo: "EXIBICAO", novas: sessao.novas, solicitacao: captura, pagamentoRecebido: false, confirmacaoChamada: false };
  }
  let valor = "";
  if (captura.tipo === PWDAT.MENU) {
    if (captura.leitura === "MENU_INCOMPLETO") {
      return { ok: false, codigo: "MENU_INCOMPLETO", novas: sessao.novas, pagamentoRecebido: false, confirmacaoChamada: false };
    }
    if (!Number.isInteger(pedido.indice) || pedido.indice < 0 || pedido.indice >= captura.valores.length) {
      return { ok: false, codigo: "OPCAO", novas: sessao.novas, pagamentoRecebido: false, confirmacaoChamada: false };
    }
    valor = captura.valores[pedido.indice];
  } else {
    valor = String(pedido.valor ?? "").trim();
  }
  if (!valor || !/^[\x20-\x7E]+$/.test(valor)) {
    return { ok: false, codigo: "ASCII", novas: sessao.novas, pagamentoRecebido: false, confirmacaoChamada: false };
  }
  sessao.respondendo = true;
  sessao.respondidaId = sessao.capturaId;
  try {
    const codigo = Number(await sessao.transporte.addParam(captura.identificador, valor));
    if (codigo !== PWRET.OK) {
      sessao.respondidaId = 0;
      return { ok: false, codigo: "ADDPARAM", retorno: codigo, novas: sessao.novas, pagamentoRecebido: false, confirmacaoChamada: false };
    }
    return await executarContinuacao(sessao);
  } finally {
    sessao.respondendo = false;
  }
}

export async function executarTesteNativoHomologacao(input, transporte) {
  const avaliacao = avaliarTesteNativoHomologacao(input);
  if (!avaliacao.pronto || input.executar !== true) {
    return { ...avaliacao, executado: false, chamadas: [] };
  }
  const recuperacao = decidirRecuperacaoTecnica(input.journalRegistro);
  if (recuperacao.acao !== "seguir") {
    return impedimento("recuperacao", "A recuperação não está segura. Nenhum comando foi enviado.");
  }
  if (!transporte || typeof transporte.newTransac !== "function" || typeof transporte.addParam !== "function") {
    return impedimento("transporte", "O adaptador nativo não foi ligado. Nenhum comando foi enviado.");
  }
  if (input.sessao?.viva) {
    return { ...impedimento("ocupada", "Há captura pendente na sessão nativa. Outra cobrança não foi iniciada."), executado: false, chamadas: [] };
  }
  if (input.sessao) {
    input.sessao.transporte = transporte;
    input.sessao.inicializada = true;
    suspenderOciosidade(input.sessao);
  }
  const chamadas = [];
  try {
  const nova = await transporte.newTransac(PWOPER.SALE);
  chamadas.push("PW_iNewTransac");
  if (input.sessao) input.sessao.novas += 1;
  const leitura = interpretarRetornoNativo("PW_iNewTransac", nova);
  if (leitura.transacaoIniciada !== true) {
    return { ...leitura, executado: true, chamadas, pronto: false, codigo: "recusa", mensagem: "A transação não iniciou." };
  }
  for (const info of input.pedido.parametros) {
    const codigo = await transporte.addParam(info, valorParametro(info, input.pedido));
    chamadas.push("PW_iAddParam");
    if (Number(codigo) !== 0) {
      return { ...leitura, executado: true, chamadas, codigo: "parametro", mensagem: "Um parâmetro foi recusado." };
    }
  }
  let execucao = await transporte.execTransac(input.pedido.capturasMax);
  chamadas.push("PW_iExecTransac");
  for (let volta = 0; volta < 8 && (Number(execucao?.codigo) === PWRET.NOTHING || Number(execucao?.codigo) === PWRET.DISPLAY); volta += 1) {
    execucao = await transporte.execTransac(input.pedido.capturasMax);
    chamadas.push("PW_iExecTransac");
  }
  if (Number(execucao?.codigo) === PWRET.MOREDATA) {
    const solicitacao = normalizarCapturaNativa(execucao?.captura?.[0] ?? null);
    if (input.sessao) {
      input.sessao.transporte = transporte;
      input.sessao.correlationId = input.pedido?.idempotencyKey ?? "";
      input.sessao.captura = solicitacao;
      input.sessao.capturaId = 1;
      input.sessao.respondidaId = 0;
      input.sessao.viva = true;
      input.sessao.cancelada = false;
    }
    return {
      ...leitura,
      executado: true,
      chamadas,
      codigo: "captura",
      solicitacao,
      mensagem: "A DLL pediu um dado. A resposta usa o identificador devolvido e a mesma transação.",
    };
  }
  if (Number(execucao?.codigo) !== PWRET.OK) {
    return {
      ...leitura,
      ...(await lerDiagnosticoHost(transporte)),
      executado: true,
      chamadas,
      codigo: "erro",
      retornoExec: Number(execucao?.codigo),
      mensagem: "PW_iExecTransac não concluiu. A transação não foi repetida nem desfeita.",
    };
  }
  const resultado = await transporte.getResult(PWINFO.REQNUM);
  chamadas.push("PW_iGetResult");
  const prova = Boolean(resultado?.reqNum && resultado?.locRef && resultado?.extRef);
  if (!prova || input.confirmacaoFinanceira !== FRASE_CONFIRMACAO) {
    return {
      ...leitura,
      executado: true,
      chamadas,
      codigo: "sem_prova",
      mensagem: "Não há prova para confirmar ou desfazer. O pagamento não foi marcado.",
    };
  }
  return {
    ...leitura,
    executado: true,
    chamadas,
    codigo: "prova",
    mensagem: "A prova foi lida. A confirmação financeira continua manual e a venda do PDV não fecha.",
  };
  } finally {
    if (input.sessao) await sincronizarOciosidadeResidente(input.sessao);
  }
}
