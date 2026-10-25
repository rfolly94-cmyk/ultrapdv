import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { carregarVersao } from "./versao.mjs";
import { resolverRaizAgente } from "./raiz.mjs";
import { assinaturaNativa } from "./tef-pgweb.mjs";
import { lerCapturasPwGetData, TAMANHO_PW_GETDATA } from "./tef-getdata.mjs";
import { diretorioExclusivoHomologacao, garantirDiretorioHomologacao, pinpadEmOperacaoFinanceira, pontoHomologacaoInstalado, transacaoHomologacaoAtiva } from "./tef-diagnostico-homologacao.mjs";
import { liberarHomologacao, ocupacaoHomologacao, reservarHomologacao } from "./tef-homologacao-ocupacao.mjs";
import { assinarEvidenciaInstalacao } from "./tef-prova.mjs";

export const ENVRMNT_PROD = 0;
export const ENVRMNT_TEST = 1;
export const CONFIRMACAO_INSTALACAO_PRODUCAO = "EXECUTAR_PWOPER_INSTALL_PRODUCAO";
export const PWOPER_INSTALL = 0x01;
export const PWOPER_SALE = 0x21;
export const CAPTURAS_SUGERIDAS = 9;
export const CONFIRMACAO_INSTALACAO = "EXECUTAR_PWOPER_INSTALL_HOMOLOGACAO";
export const PWRET_OK = 0;
export const PWRET_MOREDATA = -2497;
export const PWRET_NOTHING = -2493;
export const PWRET_DISPLAY = -2495;
export const PWRET_INVCALL = -2494;
export const PWRET_NOTINST = -2498;
export const PWRET_TIMEOUT = -2490;
export const INTERVALO_PW_IPP_EVENT_LOOP_MS = 500;
export const TETO_SEM_ESTADO_TERMINAL_MS = 90_000;
export const PWRET_WRITERR = -2485;

const PWINFO_AUTNAME = 0x15;
const PWINFO_AUTVER = 0x16;
const PWINFO_AUTDEV = 0x17;
const PWINFO_AUTCAP = 0x24;
const PWINFO_AUTHMNGTUSER = 0xf5;
const PWINFO_AUTHTECHUSER = 0xf6;
const PWINFO_POSID = 0x11;
const PWINFO_USINGPINPAD = 0x7f01;
const PWINFO_PPCOMMPORT = 0x7f02;
const AUTCAP_FIXO = 4;
const AUTCAP_REMOCAO_CARTAO = 64;
const CAPTURA_PINPAD = new Map([
  [3, ["ppGetCard", "PW_iPPGetCard"]],
  [5, ["ppGetData", "PW_iPPGetData"]],
  [6, ["ppGetPin", "PW_iPPGetPIN"]],
  [9, ["ppGoOnChip", "PW_iPPGoOnChip"]],
  [10, ["ppFinishChip", "PW_iPPFinishChip"]],
  [11, ["ppConfirmData", "PW_iPPConfirmData"]],
  [13, ["ppRemoveCard", "PW_iPPRemoveCard"]],
  [14, ["ppGenericCmd", "PW_iPPGenericCMD"]],
  [16, ["ppPositiveConfirmation", "PW_iPPPositiveConfirmation"]],
]);
const PWINFO_DESTTCPIP = 0x1b;
const PWINFO_MERCHCNPJCPF = 0x1c;
const PWINFO_AUTHSYST = 0x35;
const PWINFO_REQNUM = 0x32;
const PWINFO_VIRTMERCH = 0x36;
const PWINFO_CNFREQ = 0x43;
const PWINFO_AUTLOCREF = 0x44;
const PWINFO_AUTEXTREF = 0x45;
const PWCNF_CNF_MANU_AUT = 0x00003221;
const PWCNF_REV_MANU_AUT = 0x00003231;
const LIMITE_VOLTAS = 8;
const CONTINUACAO_EVENTO_PINPAD = new Set([PWRET_NOTHING, PWRET_DISPLAY]);
const MAXIMO_SONDAGENS_EVENTO = Math.ceil(TETO_SEM_ESTADO_TERMINAL_MS / INTERVALO_PW_IPP_EVENT_LOOP_MS) + 1;

let esperarCapturaPinpad = (milissegundos) => new Promise((resolve) => setTimeout(resolve, milissegundos));
let instanteCapturaPinpad = () => Date.now();

export function definirRelogioCapturaPinpad(relogio = null) {
  if (!relogio) {
    esperarCapturaPinpad = (milissegundos) => new Promise((resolve) => setTimeout(resolve, milissegundos));
    instanteCapturaPinpad = () => Date.now();
    return;
  }
  if (typeof relogio.esperar === "function") esperarCapturaPinpad = relogio.esperar;
  if (typeof relogio.agora === "function") instanteCapturaPinpad = relogio.agora;
}

const DADOS_CONHECIDOS = new Map([
  [PWINFO_POSID, "ponto"],
  [PWINFO_DESTTCPIP, "servidor"],
  [PWINFO_MERCHCNPJCPF, "cnpj"],
]);

const RESPOSTA_PINPAD = new Map([
  [PWINFO_USINGPINPAD, "1"],
  [PWINFO_PPCOMMPORT, "0"],
]);

export function parametrosPinpadInstalacao() {
  const versao = String(carregarVersao(resolverRaizAgente())?.version ?? "").trim();
  return [
    [PWINFO_AUTNAME, "UltraPDV"],
    [PWINFO_AUTVER, versao],
    [PWINFO_AUTDEV, "UltraPDV"],
    [PWINFO_AUTCAP, String(AUTCAP_FIXO)],
    [PWINFO_USINGPINPAD, "1"],
    [PWINFO_PPCOMMPORT, "0"],
  ];
}

let sessao = null;
let conclusao = null;

function recusa(codigo, mensagem, extra = {}) {
  return {
    ok: false,
    codigo,
    mensagem,
    executado: false,
    instalado: false,
    sessaoAberta: false,
    interrompida: false,
    evidencia: false,
    abiComprovado: false,
    layoutHomologado: false,
    chamadas: [],
    ...extra,
  };
}

function publicar(atual, extra) {
  return {
    execucaoId: atual?.execucaoId ?? "",
    retornoSetEnvironment: atual?.retornoSetEnvironment ?? null,
    cnfreq: extra.cnfreq ?? atual?.cnfreq ?? "",
    ponto: atual?.credencial?.ponto ?? "",
    abiComprovado: false,
    layoutHomologado: false,
    evidencia: extra.instalado === true,
    instalado: false,
    sessaoAberta: false,
    interrompida: false,
    etapas: Array.isArray(atual?.etapas)
      ? atual.etapas.map((item) => ({
          funcao: item.funcao,
          codigo: Number(item.codigo),
          ...(Number.isInteger(item.identificador) ? { identificador: item.identificador } : {}),
        }))
      : [],
    ...extra,
  };
}

export function consultarSessaoInstalacao() {
  if (!sessao) {
    return { ativa: false, execucaoId: "", aguardandoConfirmacao: false, capturaPendente: false };
  }
  return {
    ativa: true,
    execucaoId: sessao.execucaoId,
    aguardandoConfirmacao: sessao.refs?.necessaria === true,
    capturaPendente: Array.isArray(sessao.pendentes) && sessao.pendentes.length > 0,
  };
}

export function avaliarPrecondicoesReinstalacao(entrada = {}) {
  const falhas = [];
  if (entrada.ambiente !== "producao") falhas.push("AMBIENTE");
  if (entrada.confirmacao !== CONFIRMACAO_INSTALACAO_PRODUCAO) falhas.push("CONFIRMACAO");
  if (entrada.transacaoAtiva === true) falhas.push("TRANSACAO_ATIVA");
  if (entrada.confirmacaoFinanceiraPendente === true) falhas.push("CONFIRMACAO_FINANCEIRA");
  if (entrada.ocupacao && entrada.ocupacao !== "livre") falhas.push("SESSAO_ATIVA");
  if (entrada.sessaoInstalacaoAtiva === true) falhas.push("SESSAO_INSTALACAO");
  if (entrada.diretorioValido !== true) falhas.push("DIRETORIO");
  if (Number(entrada.porta) !== 18182) falhas.push("PORTA");
  if (Number(entrada.ouvintes) !== 1) falhas.push("CONECTOR_UNICO");
  return {
    ok: falhas.length === 0,
    codigo: falhas.length === 0 ? "PRECONDICOES_OK" : "PRECONDICOES",
    falhas,
    removeData: false,
    executado: false,
    mensagem:
      falhas.length === 0
        ? "Pré-condições conferidas. A pasta Data ainda não foi removida."
        : "A reinstalação não removeu Data.",
  };
}

function montarPrecondicoes(pedido, deps, perfil) {
  const ocupacao = ocupacaoHomologacao();
  return avaliarPrecondicoesReinstalacao({
    ambiente: perfil.producao ? "producao" : "homologacao",
    confirmacao: pedido.confirmacao,
    transacaoAtiva: deps.pinpadOcupado === true || pinpadEmOperacaoFinanceira(deps.gerenciador) === true,
    confirmacaoFinanceiraPendente: sessao?.refs?.necessaria === true,
    ocupacao: ocupacao?.origem ?? "livre",
    sessaoInstalacaoAtiva: Boolean(sessao),
    diretorioValido: Boolean(perfil.diretorio),
    porta: Number(deps.porta ?? 18182),
    ouvintes: Number(deps.ouvintes ?? 1),
  });
}

function registrarEtapa(destino, funcao, codigo) {
  if (!Array.isArray(destino)) return;
  destino.push({ funcao, codigo: Number(codigo) });
}

export function interromperProcessoInstalacao() {
  sessao = null;
  conclusao = null;
  liberarHomologacao("instalacao");
}

export async function encerrarInstalacaoSemConfirmacao() {
  if (sessao?.refs?.necessaria === true) {
    return { ok: false, codigo: "CONFIRMACAO_PENDENTE", sessaoAberta: true };
  }
  const atual = sessao;
  if (atual?.biblioteca && typeof atual.biblioteca.end === "function") {
    try {
      await atual.biblioteca.end();
    } catch {
      return { ok: false, codigo: "ENCERRAMENTO_FALHOU", sessaoAberta: true };
    }
  }
  sessao = null;
  liberarHomologacao("instalacao");
  return { ok: true, codigo: "INSTALACAO_INTERROMPIDA", instalado: false };
}

export function instalacaoHomologacaoConcluida() {
  return conclusao?.codigo === "PWRET_OK";
}

function lembrarConclusao(resposta) {
  if (resposta?.instalado === true && resposta?.evidencia === true && resposta.execucaoId) {
    conclusao = {
      execucaoId: resposta.execucaoId,
      ponto: resposta.ponto,
      codigo: resposta.codigo,
      cnfreq: resposta.cnfreq ?? "",
      retornoSetEnvironment: resposta.retornoSetEnvironment,
    };
  }
}

function textoCampo(valor, limite) {
  return String(valor ?? "").split("\0")[0].slice(0, limite);
}

function capturaPublica(item, credencial) {
  const identificador = Number(item?.wIdentificador);
  const campo = DADOS_CONHECIDOS.get(identificador);
  const tipo = Number(item?.bTipoDeDado) || 0;
  const sensivel =
    Number(item?.bOcultarDadosDigitados) === 1 ||
    tipo === 6 ||
    tipo === 17 ||
    identificador === PWINFO_AUTHMNGTUSER ||
    identificador === PWINFO_AUTHTECHUSER;
  return {
    identificador,
    tipo,
    prompt: sensivel
      ? identificador === PWINFO_AUTHTECHUSER
        ? "Senha técnica"
        : identificador === PWINFO_AUTHMNGTUSER
          ? "Senha do lojista"
          : "Dado sensível solicitado pelo PayGo."
      : textoCampo(item?.szPrompt, 84),
    sensivel,
    aceitaNulo: Number(item?.bAceitaNulo) === 1,
    opcoes: sensivel ? [] : listaMenu(item?.vszTextoMenu),
    valorSugerido: RESPOSTA_PINPAD.get(identificador) ?? (!sensivel && campo && credencial?.[campo] ? String(credencial[campo]) : ""),
  };
}

function listaMenu(valor) {
  if (!Array.isArray(valor)) return [];
  return valor.map((item) => textoCampo(item, 41)).filter(Boolean).slice(0, 40);
}

export function prepararResumoInstalacao(pedido = {}, deps = {}) {
  const diretorio = diretorioExclusivoHomologacao(deps.raiz);
  const dll = pedido.dll ?? {};
  return {
    ok: Boolean(diretorio) && dll.integridade === true && dll.arquitetura === "x64" && deps.pinpadOcupado !== true,
    codigo: "RESUMO",
    executado: false,
    abiComprovado: false,
    layoutHomologado: false,
    ambiente: "homologacao",
    ambienteBiblioteca: "ENVRMNT_TEST",
    ambienteCodigo: ENVRMNT_TEST,
    operacao: PWOPER_INSTALL,
    operacaoNome: "PWOPER_INSTALL",
    perfil: diretorio,
    dll: {
      versao: dll.versao || "",
      arquitetura: dll.arquitetura || "",
      integridade: dll.integridade === true,
    },
    pinpadOcupado: deps.pinpadOcupado === true,
    confirmacaoExigida: CONFIRMACAO_INSTALACAO,
    efeito: "PW_iExecTransac pode produzir efeitos reais no ambiente de homologação.",
    chamadas: [],
  };
}

function perfilInstalacao(deps) {
  if (deps.ambiente === "producao") {
    const diretorio = path.win32.resolve(String(deps.diretorio ?? ""));
    const normal = diretorio.toLowerCase();
    const valido = normal.includes("\\producao\\pgweb") && !normal.includes("\\homologacao\\");
    return {
      producao: true,
      diretorio: valido ? diretorio : "",
      ambienteCodigo: ENVRMNT_PROD,
      confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO,
    };
  }
  return {
    producao: false,
    diretorio: diretorioExclusivoHomologacao(deps.raiz),
    ambienteCodigo: ENVRMNT_TEST,
    confirmacao: CONFIRMACAO_INSTALACAO,
  };
}

async function validarAntesDaBiblioteca(deps) {
  if (deps.pinpadOcupado === true || pinpadEmOperacaoFinanceira(deps.gerenciador) === true) {
    return recusa("PINPAD_OCUPADO", "O PinPad está em uma operação financeira. A instalação não foi iniciada.");
  }
  const perfil = perfilInstalacao(deps);
  const diretorio = perfil.diretorio;
  if (!diretorio) {
    return recusa(
      "DIRETORIO_PRODUCAO",
      perfil.producao
        ? "A instalação de produção recusou o diretório informado."
        : "A instalação recusou o perfil de produção."
    );
  }
  const dll = typeof deps.verificarDll === "function" ? await deps.verificarDll() : { ok: false };
  if (!dll?.ok || dll.arquitetura !== "x64" || dll.integridade !== true) {
    return recusa("DLL_DIVERGENTE", "A DLL x64 oficial não teve o hash confirmado. Ela não foi carregada.", {
      perfil: diretorio,
    });
  }
  return { ok: true, diretorio, dll };
}

function encerrarSessao() {
  const atual = sessao;
  sessao = null;
  liberarHomologacao("instalacao");
  if (atual?.biblioteca && typeof atual.biblioteca.end === "function") {
    return atual.biblioteca.end();
  }
  return Promise.resolve();
}

function capturaSemValor(item) {
  const identificador = Number(item?.identificador);
  const tipo = Number(item?.tipo) || 2;
  const sensivel =
    item?.sensivel === true || tipo === 6 || tipo === 17 || identificador === 0xf5 || identificador === 0xf6;
  const rotulos = new Map([
    [0x11, "Ponto de captura"],
    [0x1b, "Servidor"],
    [0x1c, "CNPJ"],
  ]);
  return {
    identificador,
    tipo,
    prompt: sensivel ? "Dado sensível solicitado pelo PayGo." : String(item?.prompt || rotulos.get(identificador) || `Dado ${identificador}`),
    sensivel,
    valorSugerido: "",
  };
}

function consultaPublicaInstalacao() {
  const base = {
    executado: false,
    instalado: false,
    evidencia: false,
    abiComprovado: false,
    layoutHomologado: false,
    interrompida: false,
  };
  if (!sessao) {
    return {
      ...base,
      ok: true,
      ativa: false,
      codigo: "SESSAO_AUSENTE",
      execucaoId: "",
      sessaoAberta: false,
      aguardandoConfirmacao: false,
      capturas: [],
      mensagem: "Não há instalação de homologação em andamento.",
    };
  }
  const guardadas = Array.isArray(sessao.capturasPendentes) ? sessao.capturasPendentes : [];
  const capturas = guardadas.length > 0
    ? guardadas.map(capturaSemValor)
    : (Array.isArray(sessao.pendentes) ? sessao.pendentes : []).map((identificador) => capturaSemValor({ identificador }));
  return {
    ...base,
    ok: true,
    ativa: true,
    codigo: "INSTALACAO_ABERTA",
    execucaoId: sessao.execucaoId,
    sessaoAberta: true,
    aguardandoConfirmacao: sessao.refs?.necessaria === true,
    capturas,
    mensagem: "A instalação continua aberta. Nenhuma operação nova foi iniciada.",
  };
}

export async function executarInstalacaoIsolada(pedido = {}, deps = {}) {
  const perfil = perfilInstalacao(deps);
  if (pedido.acao === "precondicoes") {
    return montarPrecondicoes(pedido, deps, perfil);
  }
  if (pedido.acao === "consultar") {
    const atual = consultaPublicaInstalacao();
    const diretorio = perfil.diretorio;
    const instalado = atual.ativa ? false : diretorio ? await pontoHomologacaoInstalado(diretorio) : false;
    if (!instalado) return atual;
    return {
      ...atual,
      instalado: true,
      codigo: "JA_INSTALADO",
      mensagem: "Já instalado",
    };
  }
  if (pedido.acao === "resumo") {
    const previa = await validarAntesDaBiblioteca(deps);
    const dll = previa.ok ? previa.dll : pedido.dll ?? {};
    const resumo = prepararResumoInstalacao({ dll }, { ...deps, raiz: deps.raiz });
    if (!previa.ok) {
      return { ...resumo, ok: false, codigo: previa.codigo, mensagem: previa.mensagem, perfil: previa.perfil || resumo.perfil };
    }
    return { ...resumo, ok: true, mensagem: "Ambiente conferido. PW_iExecTransac não foi chamado.", perfil: previa.diretorio, ambiente: perfil.producao ? "producao" : "homologacao", ambienteBiblioteca: perfil.producao ? "ENVRMNT_PROD" : "ENVRMNT_TEST", ambienteCodigo: perfil.ambienteCodigo };
  }

  if (pedido.acao === "responder") {
    return responderCaptura(pedido);
  }
  if (pedido.acao === "assinar") {
    return assinarConclusao(pedido, deps);
  }
  if (pedido.acao === "confirmar" || pedido.acao === "desfazer") {
    return finalizarTransacao(pedido);
  }
  if (pedido.acao !== "executar") {
    return recusa("ACAO", "A instalação isolada aceita consultar, resumo, executar, responder, confirmar ou desfazer.");
  }
  const diretorioInstalado = perfil.diretorio;
  if (!diretorioInstalado) {
    return recusa(
      "DIRETORIO_PRODUCAO",
      perfil.producao
        ? "A instalação de produção recusou o diretório informado. PW_iSetEnvironment não foi chamado."
        : "A instalação recusou o perfil de produção."
    );
  }
  if (await transacaoHomologacaoAtiva(deps)) {
    return recusa("TRANSACAO_EM_ANDAMENTO", "Transação em andamento", {
      executado: false,
      chamadas: [],
    });
  }
  if (pedido.confirmacao !== perfil.confirmacao) {
    return recusa(
      "CONFIRMACAO_AUSENTE",
      perfil.producao
        ? "PW_iExecTransac não foi chamado. A confirmação explícita da produção é obrigatória."
        : "PW_iExecTransac não foi chamado. A confirmação explícita da homologação é obrigatória."
    );
  }
  if (pedido.reinstalar === true && perfil.producao) {
    const previaRemocao = montarPrecondicoes(pedido, deps, perfil);
    if (!previaRemocao.ok) {
      return { ...previaRemocao, perfil: diretorioInstalado };
    }
    if (typeof deps.encerrarResidente === "function") {
      try {
        await deps.encerrarResidente();
      } catch {
        return {
          ...previaRemocao,
          ok: false,
          codigo: "PRECONDICOES",
          falhas: [...previaRemocao.falhas, "SESSAO_RESIDENTE"],
          removeData: false,
          mensagem: "A sessão residente não encerrou. Data não foi removida.",
        };
      }
    }
    await rm(path.win32.join(diretorioInstalado, "Data"), { recursive: true, force: true });
  }
  if (await pontoHomologacaoInstalado(diretorioInstalado)) {
    return {
      ok: true,
      codigo: "JA_INSTALADO",
      mensagem: "Já instalado",
      executado: false,
      instalado: true,
      evidencia: true,
      chamadas: [],
      pago: false,
      perfil: diretorioInstalado,
    };
  }
  if (Number(pedido.operacao) === PWOPER_SALE) {
    return recusa("OPERACAO_BLOQUEADA", "PWOPER_SALE permanece bloqueado.");
  }
  if (ocupacaoHomologacao()?.origem === "diagnostico") {
    return recusa(
      "DIAGNOSTICO_EM_CURSO",
      "O diagnóstico de homologação está com a DLL. A instalação não foi iniciada e a sessão existente não foi encerrada.",
      { executado: false, ...consultarSessaoInstalacao(), sessaoAberta: consultarSessaoInstalacao().ativa }
    );
  }
  if (sessao) {
    const atual = consultarSessaoInstalacao();
    return recusa(
      "SESSAO_INSTALACAO_ATIVA",
      "A instalação de homologação continua aberta neste Connector. PW_iInit não foi chamado de novo e a sessão não foi encerrada.",
      { executado: false, sessaoAberta: true, ...atual }
    );
  }
  const previa = await validarAntesDaBiblioteca(deps);
  if (!previa.ok) return previa;
  if (typeof deps.abrir !== "function") {
    return recusa("TRANSPORTE_NATIVO_AUSENTE", "O transporte da instalação não está neste processo.", {
      perfil: previa.diretorio,
    });
  }
  await encerrarSessao();
  conclusao = null;
  try {
    await (deps.criarDiretorio ??
      (perfil.producao ? (pasta) => mkdir(pasta, { recursive: true }) : garantirDiretorioHomologacao))(previa.diretorio);
  } catch {
    return recusa("PWRET_WRITERR", "O diretório exclusivo não foi criado. A biblioteca não foi chamada.", {
      codigoBiblioteca: PWRET_WRITERR,
      perfil: previa.diretorio,
    });
  }

  const reserva = reservarHomologacao("instalacao");
  if (!reserva.ok) {
    return recusa(
      "DIAGNOSTICO_EM_CURSO",
      "O diagnóstico de homologação está com a DLL. A instalação não foi iniciada e a sessão existente não foi encerrada.",
      { executado: false, sessaoAberta: false }
    );
  }
  if (typeof deps.encerrarResidente === "function") {
    try {
      await deps.encerrarResidente();
    } catch {
      /* A biblioteca da instalação chama PW_End se PW_iSetEnvironment recusar. */
    }
  }
  const chamadas = [];
  const etapas = [];
  let biblioteca = await deps.abrir(previa.dll.arquivo);
  const registrar = (nome, codigo) => {
    chamadas.push(nome);
    if (codigo !== undefined) registrarEtapa(etapas, nome, codigo);
  };
  registrar("LoadLibrary");
  let ambiente = await biblioteca.setEnvironment(perfil.ambienteCodigo);
  registrar("PW_iSetEnvironment", ambiente);
  if (
    (ambiente === PWRET_NOTINST || ambiente === PWRET_INVCALL) &&
    typeof biblioteca.end === "function"
  ) {
    try {
      await biblioteca.end();
      registrar("PW_End");
      biblioteca = await deps.abrir(previa.dll.arquivo);
      registrar("LoadLibrary");
      ambiente = await biblioteca.setEnvironment(perfil.ambienteCodigo);
      registrar("PW_iSetEnvironment", ambiente);
    } catch {
      liberarHomologacao("instalacao");
      return recusa(
        "PW_iSetEnvironment",
        `PW_iSetEnvironment retornou ${ambiente}. A sessão anterior não encerrou e PW_iInit não foi chamado.`,
        {
          executado: true,
          codigoBiblioteca: ambiente,
          chamadas,
          perfil: previa.diretorio,
        }
      );
    }
  }
  if (ambiente !== PWRET_OK && ambiente !== PWRET_NOTINST) {
    liberarHomologacao("instalacao");
    return recusa("PW_iSetEnvironment", `PW_iSetEnvironment não retornou PWRET_OK. Código ${ambiente}.`, {
      executado: true,
      codigoBiblioteca: ambiente,
      chamadas,
      perfil: previa.diretorio,
    });
  }
  const init = await biblioteca.init(previa.diretorio);
  registrar("PW_iInit", init);
  if (init !== PWRET_OK && !(init === PWRET_INVCALL && ambiente === PWRET_NOTINST)) {
    if (init !== PWRET_INVCALL && typeof biblioteca.end === "function") await biblioteca.end();
    liberarHomologacao("instalacao");
    return recusa("PW_iInit", `PW_iInit não retornou PWRET_OK. Código ${init}.`, {
      executado: true,
      codigoBiblioteca: init,
      chamadas,
      perfil: previa.diretorio,
    });
  }
  const nova = await biblioteca.newTransac(PWOPER_INSTALL);
  registrar("PW_iNewTransac", nova);
  if (nova !== PWRET_OK) {
    if (typeof biblioteca.end === "function") await biblioteca.end();
    liberarHomologacao("instalacao");
    return recusa("PW_iNewTransac", `PW_iNewTransac não retornou PWRET_OK. Código ${nova}.`, {
      executado: true,
      codigoBiblioteca: nova,
      chamadas,
      perfil: previa.diretorio,
    });
  }
  const pinpad = await informarUsoDoPinpad(biblioteca, registrar);
  if (pinpad !== PWRET_OK) {
    if (typeof biblioteca.end === "function") await biblioteca.end();
    liberarHomologacao("instalacao");
    return recusa("PW_iAddParam", `O PinPad não foi habilitado antes de PW_iExecTransac. Código ${pinpad}.`, {
      executado: true,
      codigoBiblioteca: pinpad,
      chamadas,
      perfil: previa.diretorio,
    });
  }
  sessao = {
    execucaoId: randomUUID(),
    biblioteca,
    chamadas,
    perfil: previa.diretorio,
    retornoSetEnvironment: ambiente,
    cnfreq: "",
    credencial: {
      ponto: String(pedido.ponto ?? ""),
      servidor: String(pedido.servidor ?? ""),
      cnpj: String(pedido.cnpj ?? ""),
    },
    pendentes: [],
    refs: null,
    confirmacao: perfil.confirmacao,
    etapas,
  };
  return continuarExecucao();
}

async function informarUsoDoPinpad(biblioteca, registrar) {
  if ((AUTCAP_FIXO & AUTCAP_REMOCAO_CARTAO) !== 0) return PWRET_INVCALL;
  for (const [identificador, valor] of parametrosPinpadInstalacao()) {
    const codigo = Number(await biblioteca.addParam(identificador, valor));
    registrar("PW_iAddParam", codigo);
    if (codigo !== PWRET_OK) return codigo;
  }
  return PWRET_OK;
}

function exigirSessao(pedido) {
  if (!sessao) {
    return recusa(
      "SESSAO_AUSENTE",
      "A sessão nativa não existe mais. O processo encerrou antes da conclusão e a instalação não foi gravada.",
      { interrompida: true }
    );
  }
  if (pedido.execucaoId !== sessao.execucaoId) {
    return recusa(
      "SESSAO_DIVERGENTE",
      "A resposta não pertence à sessão nativa que está com a DLL aberta.",
      { execucaoId: sessao.execucaoId, sessaoAberta: true }
    );
  }
  return null;
}

function codigoRetorno(valor) {
  if (valor && typeof valor === "object" && Object.prototype.hasOwnProperty.call(valor, "codigo")) {
    return Number(valor.codigo);
  }
  return Number(valor);
}

async function executarCapturasPinpad(atual, capturas) {
  const pedidos = capturas
    .map((item, indice) => ({ item, indice, mapa: CAPTURA_PINPAD.get(Number(item?.bTipoDeDado)) }))
    .filter((item) => item.mapa);
  if (pedidos.length === 0) return null;
  for (const pedido of pedidos) {
    const [metodo, nome] = pedido.mapa;
    const funcao = atual.biblioteca[metodo];
    if (typeof funcao !== "function") {
      return recusa(
        "CAPTURA_PINPAD_AUSENTE",
        `${nome} não está disponível. A solicitação do PinPad não foi executada.`,
        { executado: true, instalado: false, sessaoAberta: true, execucaoId: atual.execucaoId }
      );
    }
    const codigo = codigoRetorno(metodo === "ppRemoveCard" ? await funcao() : await funcao(pedido.indice));
    atual.chamadas.push(nome);
    if (codigo !== PWRET_OK) {
      return recusa(nome, `${nome} não iniciou a captura no PinPad. Código ${codigo}.`, {
        executado: true,
        instalado: false,
        sessaoAberta: true,
        codigoBiblioteca: codigo,
        execucaoId: atual.execucaoId,
      });
    }
    const evento = await aguardarEventoPinpad(atual);
    if (evento?.ok === false) return evento;
  }
  return "seguinte";
}

function textoEvento(valor) {
  if (!valor || typeof valor !== "object") return "";
  return String(valor.display ?? "").split("\0")[0].trim().slice(0, 100);
}

function recusaEventoPinpad(atual, retorno, display) {
  const complemento = display ? ` Mensagem da biblioteca: ${display}` : "";
  if (retorno === PWRET_TIMEOUT) {
    return recusa(
      "PWRET_TIMEOUT",
      `PW_iPPEventLoop retornou PWRET_TIMEOUT. O prazo da captura é o da biblioteca.${complemento}`,
      { executado: true, instalado: false, sessaoAberta: true, codigoBiblioteca: retorno, execucaoId: atual.execucaoId, display }
    );
  }
  if (retorno === PWRET_INVCALL) {
    return recusa(
      "PWRET_INVCALL",
      `PW_iPPEventLoop retornou PWRET_INVCALL. Não há captura de PinPad em curso.${complemento}`,
      { executado: true, instalado: false, sessaoAberta: true, codigoBiblioteca: retorno, execucaoId: atual.execucaoId, display }
    );
  }
  return recusa("PW_iPPEventLoop", `PW_iPPEventLoop encerrou a captura no PinPad. Código ${retorno}.${complemento}`, {
    executado: true,
    instalado: false,
    sessaoAberta: true,
    codigoBiblioteca: retorno,
    execucaoId: atual.execucaoId,
    display,
  });
}

async function aguardarEventoPinpad(atual) {
  if (typeof atual.biblioteca.ppEventLoop !== "function") {
    return recusa("CAPTURA_PINPAD_AUSENTE", "PW_iPPEventLoop não está disponível.", {
      executado: true,
      instalado: false,
      sessaoAberta: true,
      execucaoId: atual.execucaoId,
    });
  }
  const inicio = instanteCapturaPinpad();
  for (let sondagem = 0; sondagem < MAXIMO_SONDAGENS_EVENTO; sondagem += 1) {
    const bruto = await atual.biblioteca.ppEventLoop();
    const retorno = codigoRetorno(bruto);
    const display = textoEvento(bruto);
    atual.chamadas.push("PW_iPPEventLoop");
    if (retorno === PWRET_OK) return null;
    if (!CONTINUACAO_EVENTO_PINPAD.has(retorno)) return recusaEventoPinpad(atual, retorno, display);
    const decorrido = instanteCapturaPinpad() - inicio;
    if (decorrido >= TETO_SEM_ESTADO_TERMINAL_MS) {
      if (typeof atual.biblioteca.ppAbort === "function") {
        await atual.biblioteca.ppAbort();
        atual.chamadas.push("PW_iPPAbort");
      }
      return recusa(
        "CAPTURA_SEM_ESTADO_TERMINAL",
        "PW_iPPEventLoop permaneceu em PWRET_NOTHING ou PWRET_DISPLAY. A biblioteca não devolveu PWRET_OK nem PWRET_TIMEOUT.",
        {
          executado: true,
          instalado: false,
          sessaoAberta: true,
          codigoBiblioteca: retorno,
          execucaoId: atual.execucaoId,
          display,
        }
      );
    }
    await esperarCapturaPinpad(INTERVALO_PW_IPP_EVENT_LOOP_MS);
  }
  return recusa(
    "CAPTURA_SEM_ESTADO_TERMINAL",
    "PW_iPPEventLoop permaneceu em PWRET_NOTHING ou PWRET_DISPLAY. A biblioteca não devolveu PWRET_OK nem PWRET_TIMEOUT.",
    { executado: true, instalado: false, sessaoAberta: true, execucaoId: atual.execucaoId }
  );
}

async function continuarExecucao() {
  const atual = sessao;
  if (!atual) return recusa("SESSAO_AUSENTE", "Não há instalação de homologação em andamento.");
  for (let volta = 0; volta < LIMITE_VOLTAS; volta += 1) {
    const execucao = await atual.biblioteca.execTransac(CAPTURAS_SUGERIDAS);
    atual.chamadas.push("PW_iExecTransac");
    const codigo = Number(execucao?.codigo);
    registrarEtapa(atual.etapas, "PW_iExecTransac", codigo);
    if (codigo === PWRET_NOTHING || codigo === PWRET_DISPLAY) {
      if (typeof atual.biblioteca.ppEventLoop === "function") {
        await atual.biblioteca.ppEventLoop();
        atual.chamadas.push("PW_iPPEventLoop");
      }
      continue;
    }
    if (codigo === PWRET_MOREDATA) {
      const lista = (execucao.capturas ?? []).slice(0, CAPTURAS_SUGERIDAS);
      const pinpad = await executarCapturasPinpad(atual, lista);
      if (pinpad?.ok === false) return pinpad;
      const restantes = lista.filter((item) => !CAPTURA_PINPAD.has(Number(item?.bTipoDeDado)));
      const automaticas = restantes.filter((item) => RESPOSTA_PINPAD.has(Number(item?.wIdentificador)));
      for (const item of automaticas) {
        const identificador = Number(item.wIdentificador);
        const codigoParametro = Number(await atual.biblioteca.addParam(identificador, RESPOSTA_PINPAD.get(identificador)));
        atual.chamadas.push("PW_iAddParam");
        if (codigoParametro !== PWRET_OK) {
          return recusa("PW_iAddParam", `PW_iAddParam não habilitou o PinPad. Código ${codigoParametro}.`, {
            executado: true,
            instalado: false,
            sessaoAberta: true,
            codigoBiblioteca: codigoParametro,
            execucaoId: atual.execucaoId,
          });
        }
      }
      const manuais = restantes.filter((item) => !RESPOSTA_PINPAD.has(Number(item?.wIdentificador)));
      if ((pinpad === "seguinte" || automaticas.length > 0) && manuais.length === 0) continue;
      const capturas = manuais.map((item) => capturaPublica(item, atual.credencial));
      for (const item of capturas) {
        if (Array.isArray(atual.etapas)) atual.etapas.push({ funcao: "PW_GetData", codigo, identificador: item.identificador });
      }
      atual.pendentes = capturas.map((item) => item.identificador);
      atual.capturasPendentes = capturas.map(capturaSemValor);
      return publicar(atual, {
        ok: true,
        codigo: "PWRET_MOREDATA",
        executado: true,
        instalado: false,
        sessaoAberta: true,
        evidencia: false,
        mensagem: "A biblioteca pediu dados. A DLL permanece iniciada até a resposta desta execução.",
        capturas,
        chamadas: [...atual.chamadas],
        etapas: [...(atual.etapas ?? [])],
        perfil: atual.perfil,
      });
    }
    if (codigo !== PWRET_OK) {
      const chamadas = [...atual.chamadas];
      const execucaoId = atual.execucaoId;
      await encerrarSessao();
      conclusao = null;
      return recusa("PW_iExecTransac", `PW_iExecTransac não concluiu a instalação. Código ${codigo}.`, {
        executado: true,
        instalado: false,
        codigoBiblioteca: codigo,
        chamadas,
        execucaoId,
      });
    }
    const confirmacao = await lerConfirmacao(atual);
    atual.cnfreq = confirmacao.cnfreq;
    atual.refs = confirmacao.necessaria ? confirmacao : null;
    if (confirmacao.necessaria) {
      return publicar(atual, {
        ok: true,
        codigo: "AGUARDANDO_CONFIRMACAO",
        executado: true,
        instalado: false,
        sessaoAberta: true,
        evidencia: false,
        cnfreq: "1",
        mensagem: "PWRET_OK com PWINFO_CNFREQ igual a 1. A instalação só conclui depois de PW_iConfirmation.",
        chamadas: [...atual.chamadas],
        perfil: atual.perfil,
      });
    }
    const pontoInstalado = await lerTexto(atual, PWINFO_POSID);
    const chamadas = [...atual.chamadas];
    const execucaoId = atual.execucaoId;
    const retornoSetEnvironment = atual.retornoSetEnvironment;
    if (pontoInstalado !== atual.credencial.ponto) {
      await encerrarSessao();
      conclusao = null;
      return recusa("PONTO_DIVERGENTE", "PW_iGetResult não devolveu o ponto desta instalação.", {
        executado: true,
        instalado: false,
        execucaoId,
        retornoSetEnvironment,
        chamadas,
      });
    }
    await encerrarSessao();
    const concluida = publicar(
      { execucaoId, retornoSetEnvironment, cnfreq: confirmacao.cnfreq, credencial: { ponto: pontoInstalado } },
      {
        ok: true,
        codigo: "PWRET_OK",
        executado: true,
        instalado: true,
        sessaoAberta: false,
        evidencia: true,
        cnfreq: confirmacao.cnfreq,
        mensagem: "PWRET_OK sem PWINFO_CNFREQ 1. A biblioteca não pediu confirmação.",
        chamadas,
      }
    );
    lembrarConclusao(concluida);
    return concluida;
  }
  const chamadas = [...atual.chamadas];
  const execucaoId = atual.execucaoId;
  await encerrarSessao();
  conclusao = null;
  return recusa("PWRET_NOTHING", "PW_iExecTransac repetiu espera além do limite local.", {
    executado: true,
    instalado: false,
    chamadas,
    execucaoId,
  });
}

async function lerTexto(atual, info) {
  if (typeof atual.biblioteca.getResult !== "function") return "";
  atual.chamadas.push("PW_iGetResult");
  const bruto = await atual.biblioteca.getResult(info);
  const codigo =
    bruto && typeof bruto === "object" && Object.prototype.hasOwnProperty.call(bruto, "codigo")
      ? Number(bruto.codigo)
      : PWRET_OK;
  const valor = bruto && typeof bruto === "object" && Object.prototype.hasOwnProperty.call(bruto, "valor") ? bruto.valor : bruto;
  registrarEtapa(atual.etapas, "PW_iGetResult", codigo);
  return textoCampo(valor, 64);
}

async function lerConfirmacao(atual) {
  const pedido = await lerTexto(atual, PWINFO_CNFREQ);
  const cnfreq = pedido === "1" || pedido === "0" ? pedido : "";
  if (cnfreq !== "1") return { necessaria: false, cnfreq };
  return {
    necessaria: true,
    cnfreq,
    reqNum: await lerTexto(atual, PWINFO_REQNUM),
    locRef: await lerTexto(atual, PWINFO_AUTLOCREF),
    extRef: await lerTexto(atual, PWINFO_AUTEXTREF),
    virtMerch: await lerTexto(atual, PWINFO_VIRTMERCH),
    authSyst: await lerTexto(atual, PWINFO_AUTHSYST),
  };
}

async function responderCaptura(pedido) {
  const divergencia = exigirSessao(pedido);
  if (divergencia) return divergencia;
  const atual = sessao;
  const respostas = Array.isArray(pedido.respostas) ? pedido.respostas : [];
  const pedidos = new Set(atual.pendentes);
  if (respostas.some((item) => String(item.valor ?? "").trim() === "")) {
    return recusa("CAPTURA_VAZIA", "PW_iAddParam não recebe valor vazio.", {
      execucaoId: atual.execucaoId,
      sessaoAberta: true,
      retornoSetEnvironment: atual.retornoSetEnvironment,
    });
  }
  if (respostas.length === 0 || respostas.some((item) => !pedidos.has(Number(item.identificador)))) {
    return recusa("CAPTURA_NAO_SOLICITADA", "PW_iAddParam só aceita um identificador pedido nesta captura.", {
      execucaoId: atual.execucaoId,
      sessaoAberta: true,
      retornoSetEnvironment: atual.retornoSetEnvironment,
    });
  }
  for (const item of respostas) {
    const valor = String(item.valor ?? "").slice(0, 255);
    const codigo = await atual.biblioteca.addParam(Number(item.identificador), valor);
    atual.chamadas.push("PW_iAddParam");
    if (codigo !== PWRET_OK) {
      return recusa("PW_iAddParam", `PW_iAddParam não retornou PWRET_OK. Código ${codigo}.`, {
        executado: true,
        instalado: false,
        sessaoAberta: true,
        execucaoId: atual.execucaoId,
        codigoBiblioteca: codigo,
        chamadas: [...atual.chamadas],
      });
    }
  }
  atual.pendentes = [];
  atual.capturasPendentes = [];
  return continuarExecucao();
}

async function finalizarTransacao(pedido) {
  const divergencia = exigirSessao(pedido);
  if (divergencia) return divergencia;
  const atual = sessao;
  if (!atual?.refs?.necessaria) {
    return recusa("CONFIRMACAO_INDISPONIVEL", "A biblioteca não pediu confirmação desta instalação.", {
      execucaoId: atual.execucaoId,
      sessaoAberta: true,
    });
  }
  if (pedido.confirmacao !== (atual.confirmacao || CONFIRMACAO_INSTALACAO)) {
    return recusa("CONFIRMACAO_AUSENTE", "A confirmação da transação também exige a frase explícita.");
  }
  const status = pedido.acao === "desfazer" ? PWCNF_REV_MANU_AUT : PWCNF_CNF_MANU_AUT;
  const codigo = await atual.biblioteca.confirmation(
    status,
    atual.refs.reqNum,
    atual.refs.locRef,
    atual.refs.extRef,
    atual.refs.virtMerch,
    atual.refs.authSyst
  );
  atual.chamadas.push("PW_iConfirmation");
  const chamadas = [...atual.chamadas];
  const execucaoId = atual.execucaoId;
  const retornoSetEnvironment = atual.retornoSetEnvironment;
  const ponto = atual.credencial.ponto;
  await encerrarSessao();
  if (codigo !== PWRET_OK) {
    conclusao = null;
    return recusa("PW_iConfirmation", `PW_iConfirmation não retornou PWRET_OK. Código ${codigo}.`, {
      executado: true,
      instalado: false,
      codigoBiblioteca: codigo,
      chamadas,
      execucaoId,
      retornoSetEnvironment,
    });
  }
  const desfeita = pedido.acao === "desfazer";
  const finalizada = publicar(
    { execucaoId, retornoSetEnvironment, cnfreq: "1", credencial: { ponto } },
    {
      ok: true,
      codigo: desfeita ? "DESFEITA" : "INSTALADO_CONFIRMADO",
      executado: true,
      instalado: !desfeita,
      evidencia: !desfeita,
      sessaoAberta: false,
      cnfreq: "1",
      mensagem: desfeita
        ? "A instalação foi desfeita na biblioteca e não foi gravada como concluída."
        : "PW_iConfirmation retornou PWRET_OK depois de PWINFO_CNFREQ 1.",
      chamadas,
    }
  );
  if (desfeita) conclusao = null;
  else lembrarConclusao(finalizada);
  return finalizada;
}

async function assinarConclusao(pedido, deps) {
  if (!conclusao || pedido.execucaoId !== conclusao.execucaoId) {
    return recusa(
      "CONCLUSAO_AUSENTE",
      "Não há instalação comprovada nesta execução. O retorno da interface não gera evidência.",
      { instalado: false, interrompida: !conclusao }
    );
  }
  if (typeof deps.lerChave !== "function") {
    return recusa("CHAVE_AUSENTE", "A identidade de homologação ainda não foi gerada neste Connector.", {
      execucaoId: conclusao.execucaoId,
    });
  }
  const chave = await deps.lerChave();
  if (!chave?.privada || !chave?.publica) {
    return recusa("CHAVE_AUSENTE", "A identidade de homologação ainda não foi gerada neste Connector.", {
      execucaoId: conclusao.execucaoId,
    });
  }
  const assinada = assinarEvidenciaInstalacao(chave.privada, {
    empresaId: pedido.empresaId,
    dispositivoId: pedido.dispositivoId,
    terminalId: pedido.terminalId,
    pontoCaptura: conclusao.ponto,
    pontoInstalado: conclusao.ponto,
    estabelecimento: pedido.estabelecimento,
    ambienteSolicitado: "homologacao",
    instalacaoId: conclusao.execucaoId,
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
  });
  if (!assinada?.assinatura) {
    return recusa("ASSINATURA_RECUSADA", "A conclusão comprovada não pôde ser assinada.", {
      execucaoId: conclusao.execucaoId,
    });
  }
  return {
    ok: true,
    codigo: conclusao.codigo,
    execucaoId: conclusao.execucaoId,
    ponto: conclusao.ponto,
    retornoSetEnvironment: conclusao.retornoSetEnvironment,
    cnfreq: conclusao.cnfreq,
    instalado: true,
    evidencia: true,
    sessaoAberta: false,
    interrompida: false,
    chavePublica: chave.publica,
    chaveId: chave.id,
    assinatura: assinada.assinatura,
    abiComprovado: false,
    layoutHomologado: false,
    mensagem: "A instalação comprovada foi assinada com a identidade de homologação.",
  };
}

let tipoGetDataInstalacao = null;

function definicaoGetDataInstalacao(koffi) {
  return {
    wIdentificador: "uint16",
    bTipoDeDado: "uint8",
    szPrompt: koffi.array("char", 84),
    bNumOpcoesMenu: "uint8",
    vszTextoMenu: koffi.array(koffi.array("char", 41), 40),
    vszValorMenu: koffi.array(koffi.array("char", 256), 40),
    szMascaraDeCaptura: koffi.array("char", 41),
    bTiposEntradaPermitidos: "uint8",
    bTamanhoMinimo: "uint8",
    bTamanhoMaximo: "uint8",
    ulValorMinimo: "uint32",
    ulValorMaximo: "uint32",
    bOcultarDadosDigitados: "uint8",
    bValidacaoDado: "uint8",
    bAceitaNulo: "uint8",
    szValorInicial: koffi.array("char", 41),
    bTeclasDeAtalho: "uint8",
    szMsgValidacao: koffi.array("char", 84),
    szMsgConfirmacao: koffi.array("char", 84),
    szMsgDadoMaior: koffi.array("char", 84),
    szMsgDadoMenor: koffi.array("char", 84),
    bCapturarDataVencCartao: "uint8",
    ulTipoEntradaCartao: "uint32",
    bItemInicial: "uint8",
    bNumeroCapturas: "uint8",
    szMsgPrevia: koffi.array("char", 84),
    bTipoEntradaCodigoBarras: "uint8",
    bOmiteMsgAlerta: "uint8",
    bIniciaPelaEsquerda: "uint8",
    bNotificarCancelamento: "uint8",
    bAlinhaPelaDireita: "uint8",
  };
}

export function prepararTipoGetDataInstalacao(koffi, cache = null) {
  if (cache?.tipo) return cache.tipo;
  if (!tipoGetDataInstalacao) {
    tipoGetDataInstalacao = koffi.struct("PW_GetDataInstalacao", definicaoGetDataInstalacao(koffi));
  }
  if (cache) cache.tipo = tipoGetDataInstalacao;
  return tipoGetDataInstalacao;
}

export async function abrirInstalacaoNativa(arquivo) {
  const koffi = (await import("koffi")).default;
  prepararTipoGetDataInstalacao(koffi);
  const lib = koffi.load(arquivo);
  const init = lib.func(assinaturaNativa("PW_iInit"));
  const setEnvironment = lib.func(assinaturaNativa("PW_iSetEnvironment"));
  const newTransac = lib.func(assinaturaNativa("PW_iNewTransac"));
  const addParam = lib.func(assinaturaNativa("PW_iAddParam"));
  const execTransac = lib.func(assinaturaNativa("PW_iExecTransac"));
  const getResult = lib.func(assinaturaNativa("PW_iGetResult"));
  const ppGetCard = lib.func(assinaturaNativa("PW_iPPGetCard"));
  const ppGetData = lib.func(assinaturaNativa("PW_iPPGetData"));
  const ppGetPin = lib.func(assinaturaNativa("PW_iPPGetPIN"));
  const ppGoOnChip = lib.func(assinaturaNativa("PW_iPPGoOnChip"));
  const ppFinishChip = lib.func(assinaturaNativa("PW_iPPFinishChip"));
  const ppConfirmData = lib.func(assinaturaNativa("PW_iPPConfirmData"));
  const ppRemoveCard = lib.func(assinaturaNativa("PW_iPPRemoveCard"));
  const ppGenericCmd = lib.func(assinaturaNativa("PW_iPPGenericCMD"));
  const ppPositiveConfirmation = lib.func(assinaturaNativa("PW_iPPPositiveConfirmation"));
  const confirmation = lib.func(assinaturaNativa("PW_iConfirmation"));
  const ppEventLoop = lib.func(assinaturaNativa("PW_iPPEventLoop"));
  const ppAbort = lib.func(assinaturaNativa("PW_iPPAbort"));
  const end = lib.func(assinaturaNativa("PW_End"));
  return {
    async init(diretorio) {
      return init(diretorio);
    },
    async setEnvironment(codigo) {
      return setEnvironment(codigo);
    },
    async newTransac(operacao) {
      return newTransac(operacao);
    },
    async addParam(identificador, valor) {
      return addParam(identificador, valor);
    },
    async execTransac(quantidade) {
      const { executarExecTransacOficial } = await import("./tef-venda-nativa.mjs");
      const oficial = await executarExecTransacOficial(execTransac, quantidade);
      return {
        codigo: oficial.codigo,
        capturas: oficial.captura,
        leitura: oficial.leitura,
        quantidade: oficial.quantidade,
      };
    },
    async getResult(info) {
      const saida = Buffer.alloc(128);
      const codigo = getResult(info, saida, saida.length);
      return { codigo, valor: saida.toString("latin1").split("\0")[0] };
    },
    async confirmation(status, reqNum, locRef, extRef, virtMerch, authSyst) {
      return confirmation(status, reqNum ?? "", locRef ?? "", extRef ?? "", virtMerch ?? "", authSyst ?? "");
    },
    async ppGetCard(indice) {
      return ppGetCard(indice);
    },
    async ppGetData(indice) {
      return ppGetData(indice);
    },
    async ppGetPin(indice) {
      return ppGetPin(indice);
    },
    async ppGoOnChip(indice) {
      return ppGoOnChip(indice);
    },
    async ppFinishChip(indice) {
      return ppFinishChip(indice);
    },
    async ppConfirmData(indice) {
      return ppConfirmData(indice);
    },
    async ppRemoveCard() {
      return ppRemoveCard();
    },
    async ppGenericCmd(indice) {
      return ppGenericCmd(indice);
    },
    async ppPositiveConfirmation(indice) {
      return ppPositiveConfirmation(indice);
    },
    async ppAbort() {
      return ppAbort();
    },
    async ppEventLoop() {
      const display = Buffer.alloc(128);
      const codigo = ppEventLoop(display, display.length);
      return { codigo, display: display.toString("latin1").split("\0")[0] };
    },
    async end() {
      end();
      lib.unload();
    },
  };
}
