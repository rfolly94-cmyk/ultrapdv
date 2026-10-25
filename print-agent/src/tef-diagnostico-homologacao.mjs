import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { assinaturaNativa, horarioIdle } from "./tef-pgweb.mjs";
import { liberarHomologacao, ocupacaoHomologacao, reservarHomologacao } from "./tef-homologacao-ocupacao.mjs";

export const FUNCOES_DIAGNOSTICO = Object.freeze([
  "LoadLibrary",
  "PW_iSetEnvironment",
  "PW_iInit",
  "PW_iPPCommTest",
  "PW_iPPEventLoop",
  "PW_iGetResult",
  "PW_iIdleProc",
]);

export const FUNCOES_BLOQUEADAS = Object.freeze([
  "PW_iNewTransac",
  "PW_iExecTransac",
  "PW_iAddParam",
  "PW_iConfirmation",
  "PW_GetData",
  "PW_iGetData",
]);

export const ENVRMNT_PROD = 0;
export const ENVRMNT_TEST = 1;
export const PORTA_AUTOMATICA = 0;
export const PWRET_OK = 0;
export const PWRET_NOTINST = -2498;
export const PWRET_DISPLAY = -2495;
export const PWRET_INVCALL = -2494;
export const PWRET_NOTHING = -2493;
export const PWRET_PPNOTFOUND = -2489;
export const PWRET_DLLNOTINIT = -2487;
export const PWRET_WRITERR = -2485;
export const PWRET_PPCOMERR = -2484;

let ultimaComunicacaoPinpad = null;
let diagnosticoEmCurso = null;

export function esquecerComunicacaoPinpadHomologacao() {
  ultimaComunicacaoPinpad = null;
}

function comunicacaoConfirmadaConhecida(deps) {
  if (Object.prototype.hasOwnProperty.call(deps, "comunicacaoConfirmada")) {
    return deps.comunicacaoConfirmada;
  }
  if (deps.memoria) {
    return deps.memoria.atual ?? null;
  }
  return ultimaComunicacaoPinpad;
}

function lembrarComunicacao(deps, registro) {
  ultimaComunicacaoPinpad = registro;
  if (deps.memoria) {
    deps.memoria.atual = registro;
  }
}

export function chamadaPermitidaNoDiagnostico(nome) {
  return FUNCOES_DIAGNOSTICO.includes(nome);
}

export function pinpadEmOperacaoFinanceira(gerenciador) {
  const acao = gerenciador?.pendente?.acao;
  return (
    acao === "pagamento" ||
    acao === "confirmar" ||
    acao === "desfazer" ||
    acao === "instalar" ||
    gerenciador?.transacaoPendente != null
  );
}

export function diretorioExclusivoHomologacao(raiz) {
  const diretorio = path.win32.resolve(String(raiz ?? ""), "TEF", "Homologacao", "PGWeb");
  const normal = diretorio.toLowerCase();
  if (normal.includes("\\producao\\") || normal.includes("\\paygo\\") || !normal.includes("\\homologacao\\")) {
    return "";
  }
  return diretorio;
}

export async function garantirDiretorioHomologacao(diretorio, criar = mkdir) {
  const normal = path.win32.normalize(String(diretorio ?? "")).toLowerCase();
  if (!normal.includes("\\homologacao\\") || normal.includes("\\producao\\") || normal.includes("\\paygo\\")) {
    throw Object.assign(new Error("Diretório de homologação recusado."), { code: "DIRETORIO_PRODUCAO" });
  }
  await criar(diretorio, { recursive: true });
  return diretorio;
}

function recusa(codigo, mensagem, extra = {}) {
  return {
    ok: false,
    codigo,
    mensagem,
    pago: false,
    executado: false,
    porta: null,
    chamadas: [],
    ...extra,
  };
}

export async function pontoHomologacaoInstalado(diretorio) {
  const base = path.win32.join(String(diretorio ?? ""), "Data");
  try {
    await access(path.win32.join(base, "certificado.crt"));
    await access(path.win32.join(base, "check.pos"));
    return true;
  } catch {
    return false;
  }
}

const STATUS_TRANSACAO_ATIVA = new Set([
  "iniciada",
  "autorizada",
  "aguardando_captura",
  "aguardando_confirmacao",
  "pagamento_em_andamento",
  "desfazimento_pendente",
]);

export async function transacaoHomologacaoAtiva(deps = {}) {
  if (deps.transacaoAtiva === true || deps.pinpadOcupado === true || pinpadEmOperacaoFinanceira(deps.gerenciador)) {
    return true;
  }
  const raiz = String(deps.raiz ?? "");
  if (!raiz.toLowerCase().includes("\\conector-homologacao")) return false;
  try {
    const bruto = await readFile(path.win32.join(raiz, "tef-journal-venda-100.json"), "utf8");
    const journal = JSON.parse(bruto);
    return journal?.sessaoNativa === "residente" || STATUS_TRANSACAO_ATIVA.has(journal?.status);
  } catch {
    return false;
  }
}

function mensagemFalhaPinpad(codigo, funcao = "") {
  if (codigo === PWRET_PPNOTFOUND) {
    return "PinPad não encontrado. A busca usou a porta já configurada e não trocou a COM. PW_iPPCommTest retornou PWRET_PPNOTFOUND (-2489).";
  }
  if (codigo === PWRET_PPCOMERR) {
    return "Falha na comunicação com o PinPad. PW_iPPCommTest retornou PWRET_PPCOMERR (-2484).";
  }
  if (codigo === PWRET_DLLNOTINIT) {
    return "Biblioteca não inicializada. PW_iInit ainda não retornou PWRET_OK. Código -2487.";
  }
  if (codigo === PWRET_INVCALL && funcao && funcao !== "PW_iSetEnvironment") {
    return `${funcao} recusou a chamada. Código -2494. A sessão já estava inicializada. PW_iSetEnvironment não foi chamado e o perfil não foi alterado.`;
  }
  if (codigo === PWRET_INVCALL) {
    return "PW_iSetEnvironment recusou a chamada. Código -2494. A função só é válida antes de PW_iInit e antes da instalação do ponto.";
  }
  return "";
}

function faseFalhaPinpad(codigo) {
  if (codigo === PWRET_PPNOTFOUND) return "descoberta";
  if (codigo === PWRET_PPCOMERR) return "comunicacao";
  if (codigo === PWRET_DLLNOTINIT) return "biblioteca";
  if (codigo === PWRET_INVCALL || codigo === PWRET_NOTINST) return "ambiente";
  return "comunicacao";
}

function portaComunicacaoValida(porta) {
  return Number.isInteger(porta) && porta > 0 && porta < 255;
}

export function textoPinpadUltraPdv(versao) {
  const limpa = String(versao ?? "").replace(/[^\d.]/g, "").slice(0, 16);
  return limpa ? `UltraPDV\r${limpa}` : "UltraPDV";
}

async function apresentarIdentidadePinpad(biblioteca, versao) {
  const texto = textoPinpadUltraPdv(versao);
  const exibicao = { texto, display: null, ociosa: null };
  if (typeof biblioteca?.ppSetIdleImage === "function" && biblioteca.ociosaDefinida !== true) {
    try {
      exibicao.ociosa = await biblioteca.ppSetIdleImage(texto);
    } catch {
      exibicao.ociosa = null;
    }
    biblioteca.ociosaDefinida = true;
  }
  if (typeof biblioteca?.ppDisplay === "function") {
    try {
      exibicao.display = await biblioteca.ppDisplay(texto);
    } catch {
      exibicao.display = null;
    }
  }
  return exibicao;
}

async function concluirTesteComunicacao(biblioteca, registrar, portaPreferida = PORTA_AUTOMATICA) {
  const inicial = portaPreferida === PORTA_AUTOMATICA ? PORTA_AUTOMATICA : portaPreferida;
  let teste = await biblioteca.ppCommTest(inicial);
  registrar("PW_iPPCommTest");
  if (inicial !== PORTA_AUTOMATICA && (teste?.codigo !== PWRET_OK || !portaComunicacaoValida(teste?.porta))) {
    teste = await biblioteca.ppCommTest(PORTA_AUTOMATICA);
    registrar("PW_iPPCommTest");
  }
  let voltas = 0;
  while ((teste?.codigo === PWRET_NOTHING || teste?.codigo === PWRET_DISPLAY) && voltas < 8) {
    voltas += 1;
    teste = await biblioteca.ppCommTest(PORTA_AUTOMATICA);
    registrar("PW_iPPCommTest");
  }
  if (teste?.codigo === PWRET_OK && portaComunicacaoValida(teste.porta)) {
    return { teste, evento: null };
  }
  if (
    teste?.codigo !== PWRET_OK ||
    teste?.porta === 255 ||
    typeof biblioteca.ppEventLoop !== "function"
  ) {
    return { teste, evento: null };
  }
  let evento = null;
  for (let volta = 0; volta < 8; volta += 1) {
    evento = await biblioteca.ppEventLoop();
    registrar("PW_iPPEventLoop");
    if (evento?.codigo !== PWRET_NOTHING && evento?.codigo !== PWRET_DISPLAY) break;
  }
  return { teste, evento };
}

function nomeCom(porta) {
  return Number.isInteger(porta) && porta > 0 && porta < 255 ? `COM${porta}` : "";
}

export function criarAgendadorOciosidadeHomologacao({
  lerBiblioteca,
  bloqueado,
  agendar,
  cancelar = clearTimeout,
} = {}) {
  let timer = null;
  let proxima = null;
  let ocupado = false;
  const agendador = {
    async sincronizar(valor) {
      proxima = horarioIdle(String(valor ?? "").trim());
      agendador.programar();
    },
    programar() {
      if (timer) cancelar(timer);
      timer = null;
      if (!(proxima instanceof Date) || typeof agendar !== "function") return;
      const atraso = Math.max(0, proxima.getTime() - Date.now());
      timer = agendar(() => {
        void agendador.pulsar();
      }, atraso);
    },
    async pulsar(agora = new Date()) {
      if (ocupado) return { executou: false, motivo: "concorrente" };
      if (typeof bloqueado === "function" && (await bloqueado())) {
        return { executou: false, motivo: "transacao" };
      }
      const biblioteca = typeof lerBiblioteca === "function" ? lerBiblioteca() : null;
      if (!biblioteca?.inicializada || typeof biblioteca.idleProc !== "function") {
        return { executou: false, motivo: "biblioteca" };
      }
      if (!(proxima instanceof Date) || agora.getTime() < proxima.getTime()) {
        return { executou: false, motivo: "aguardando" };
      }
      ocupado = true;
      try {
        const codigo = await biblioteca.idleProc();
        const lido = typeof biblioteca.getResult === "function" ? await biblioteca.getResult(0x7f04) : { codigo: -2496, valor: "" };
        proxima = lido?.codigo === 0 ? horarioIdle(String(lido.valor ?? "").trim()) : null;
        return { executou: true, codigo, proxima };
      } finally {
        ocupado = false;
        agendador.programar();
      }
    },
  };
  return agendador;
}

async function promoverSessaoResidente(biblioteca, diretorio, guardar) {
  if (!biblioteca || biblioteca.inicializada !== true) return biblioteca;
  try {
    if (typeof biblioteca.bibliotecaNativa?.func === "function") {
      if (!biblioteca.arquitetura) biblioteca.arquitetura = "x64";
      if (!biblioteca.diretorio) biblioteca.diretorio = diretorio;
      const { completarInstanciaResidente } = await import("./tef-menu-conector.mjs");
      const promovida = completarInstanciaResidente(biblioteca);
      if (promovida) biblioteca = promovida;
    }
  } catch {
    if (biblioteca.bibliotecaNativa) {
      biblioteca.residente = false;
      biblioteca.causaSessao = "incompleta";
    }
  }
  if (typeof guardar === "function") guardar(biblioteca);
  return biblioteca;
}

export async function executarDiagnosticoHomologacao(pedido = {}, deps = {}) {
  const acao = pedido.acao === "testar" ? "testar" : pedido.acao === "identificar" ? "identificar" : "";
  if (!acao) {
    return recusa("DIAGNOSTICO_ACAO", "A ação do diagnóstico de homologação é identificar ou testar.");
  }
  if (diagnosticoEmCurso) {
    return recusa("PINPAD_OCUPADO", "O diagnóstico de homologação já está em execução.");
  }
  diagnosticoEmCurso = Promise.resolve();
  try {
    return await executarDiagnosticoReservado(acao, deps);
  } finally {
    diagnosticoEmCurso = null;
  }
}

function diretorioProducaoDoPedido(deps) {
  const diretorio = path.win32.resolve(String(deps.diretorio ?? ""));
  const normal = diretorio.toLowerCase();
  if (!normal.includes("\\producao\\pgweb") || normal.includes("\\homologacao\\")) return "";
  return diretorio;
}

async function executarDiagnosticoReservado(acao, deps) {
  const producao = deps.ambiente === "producao";
  const diretorio = producao ? diretorioProducaoDoPedido(deps) : diretorioExclusivoHomologacao(deps.raiz);
  if (!diretorio) {
    return recusa(
      "DIRETORIO_PRODUCAO",
      producao
        ? "O diagnóstico de produção recusou o diretório informado."
        : "O diagnóstico de homologação recusou o diretório de produção."
    );
  }
  const nomeAmbiente = producao ? "produção" : "homologação";
  const pontoNoDisco = await pontoHomologacaoInstalado(diretorio);
  const pontoInstalado = deps.pontoInstalado === true || pontoNoDisco;
  if (deps.instancia?.ocupada === true || (await transacaoHomologacaoAtiva(deps))) {
    return recusa("TRANSACAO_EM_ANDAMENTO", "Transação em andamento", {
      diretorio,
      acao,
      fase: "transacao",
      pontoInstalado,
      dllInicializada: false,
      pinpadConectado: false,
    });
  }
  if (deps.executar !== true) {
    return recusa("DIAGNOSTICO_NAO_EXECUTADO", "O diagnóstico real não é executado automaticamente.", {
      diretorio,
      acao,
    });
  }
  const dll = typeof deps.verificarDll === "function" ? await deps.verificarDll() : { ok: false };
  if (!dll?.ok || dll.arquitetura !== "x64" || dll.integridade !== true) {
    return recusa("DLL_DIVERGENTE", "A DLL x64 oficial não teve o hash confirmado. Ela não foi carregada.", {
      diretorio,
      acao,
    });
  }
  if (typeof deps.abrir !== "function") {
    return recusa("TRANSPORTE_NATIVO_AUSENTE", "O transporte nativo do diagnóstico não está neste processo.", {
      diretorio,
      acao,
    });
  }
  if (ocupacaoHomologacao()?.origem === "com7") {
    return recusa(
      "PORTA_RESERVADA",
      "O PinPad está reservado por uma operação neste computador. Nenhuma nova biblioteca foi carregada e a porta não foi aberta.",
      { diretorio, acao, sessaoAberta: true }
    );
  }
  if (ocupacaoHomologacao()?.origem === "instalacao") {
    return recusa(
      "SESSAO_INSTALACAO_ATIVA",
      "A instalação de homologação está aberta. O diagnóstico não chamou PW_iInit nem PW_End.",
      { diretorio, acao, sessaoAberta: true }
    );
  }
  const reserva = reservarHomologacao("diagnostico");
  if (!reserva.ok) {
    return recusa(
      "SESSAO_INSTALACAO_ATIVA",
      "A instalação de homologação está aberta. O diagnóstico não chamou PW_iInit nem PW_End.",
      { diretorio, acao, sessaoAberta: true }
    );
  }

  const chamadas = [];
  let biblioteca = null;
  let initCodigo = null;
  const registrar = (nome) => {
    if (!chamadaPermitidaNoDiagnostico(nome)) {
      throw Object.assign(new Error("Função financeira bloqueada no diagnóstico."), {
        code: "PGWEB_FUNCAO_BLOQUEADA",
      });
    }
    chamadas.push(nome);
  };
  try {
    const criarDiretorio =
      deps.criarDiretorio ??
      (producao
        ? async (pasta) => {
            await mkdir(pasta, { recursive: true });
            return pasta;
          }
        : (pasta) => garantirDiretorioHomologacao(pasta));
    try {
      await criarDiretorio(diretorio);
    } catch {
      return recusa(
        "PWRET_WRITERR",
        producao
          ? "O diretório de trabalho da produção não foi criado. PW_iInit não foi chamado. Código -2485."
          : "O diretório de trabalho da homologação não foi criado. PW_iInit não foi chamado. Código -2485.",
        { codigoBiblioteca: PWRET_WRITERR, diretorio, acao }
      );
    }
    const pontoInstaladoNaExecucao = deps.pontoInstalado === true || (await pontoHomologacaoInstalado(diretorio));
    let residente = deps.instancia?.inicializada === true ? deps.instancia : null;
    if (producao && residente) {
      const atual = path.win32.normalize(String(residente.diretorio ?? "")).toLowerCase();
      const pedido = path.win32.normalize(diretorio).toLowerCase();
      const outroAmbiente = residente.producao !== true || (atual !== "" && atual !== pedido);
      if (outroAmbiente) {
        if (typeof residente.end !== "function") {
          return recusa(
            "SESSAO_OUTRO_AMBIENTE",
            "A sessão ativa está em outro ambiente. Feche o UltraPDV Connector e abra de novo. PW_iSetEnvironment não foi chamado.",
            { diretorio, acao, pontoInstalado: true, dllInicializada: true, pinpadConectado: false, chamadas }
          );
        }
        try {
          await residente.end();
          chamadas.push("PW_End");
        } catch {
          return recusa(
            "SESSAO_OUTRO_AMBIENTE",
            "Não foi possível encerrar a sessão do outro ambiente. Feche o UltraPDV Connector e abra de novo. PW_iSetEnvironment não foi chamado.",
            { diretorio, acao, chamadas }
          );
        }
        residente = null;
        if (typeof deps.guardarInstancia === "function") deps.guardarInstancia(null);
      }
    }
    if (residente) {
      biblioteca = residente;
      initCodigo = PWRET_OK;
    } else {
      biblioteca = await deps.abrir(dll.arquivo);
      registrar("LoadLibrary");
      biblioteca.producao = producao;
      biblioteca.homologacao = !producao;
      biblioteca.diretorio = diretorio;
      let instalacaoPendente = false;
      if (!pontoInstaladoNaExecucao) {
        const codigoAmbiente = producao ? ENVRMNT_PROD : ENVRMNT_TEST;
        let ambiente = await biblioteca.setEnvironment(codigoAmbiente);
        registrar("PW_iSetEnvironment");
        if (ambiente === PWRET_NOTINST && typeof biblioteca.end === "function") {
          try {
            await biblioteca.end();
            chamadas.push("PW_End");
          } catch {
            return recusa(
              "PW_iSetEnvironment",
              `PW_iSetEnvironment retornou ${ambiente}. A sessão anterior não encerrou e PW_iInit não foi chamado.`,
              {
                executado: true,
                codigoBiblioteca: ambiente,
                fase: "ambiente",
                chamadas,
                diretorio,
                pontoInstalado: false,
                dllInicializada: false,
                pinpadConectado: false,
              }
            );
          }
          biblioteca = await deps.abrir(dll.arquivo);
          registrar("LoadLibrary");
          biblioteca.producao = producao;
          biblioteca.homologacao = !producao;
          biblioteca.diretorio = diretorio;
          ambiente = await biblioteca.setEnvironment(codigoAmbiente);
          registrar("PW_iSetEnvironment");
        }
        if (ambiente === PWRET_NOTINST) {
          instalacaoPendente = true;
        } else if (ambiente !== PWRET_OK) {
          return recusa(
            "PW_iSetEnvironment",
            mensagemFalhaPinpad(ambiente) ||
              `PW_iSetEnvironment não retornou PWRET_OK. Código ${ambiente}. PW_iInit não foi chamado.`,
            {
              executado: true,
              codigoBiblioteca: ambiente,
              fase: faseFalhaPinpad(ambiente),
              chamadas,
              diretorio,
              pontoInstalado: false,
              dllInicializada: false,
              pinpadConectado: false,
            }
          );
        }
      }
      initCodigo = await biblioteca.init(diretorio);
      registrar("PW_iInit");
      if (initCodigo === PWRET_INVCALL && (pontoInstaladoNaExecucao || instalacaoPendente)) {
        biblioteca.inicializada = true;
      } else if (initCodigo !== PWRET_OK) {
        return recusa(
          "PW_iInit",
          initCodigo === PWRET_DLLNOTINIT
            ? mensagemFalhaPinpad(PWRET_DLLNOTINIT, "PW_iInit")
            : initCodigo === PWRET_INVCALL
              ? mensagemFalhaPinpad(PWRET_INVCALL, "PW_iInit")
              : `Falha na inicialização da biblioteca. PW_iInit não retornou PWRET_OK. Código ${initCodigo}.`,
          {
            executado: true,
            codigoBiblioteca: initCodigo,
            fase: "inicializacao",
            chamadas,
            diretorio,
            pontoInstalado: pontoInstaladoNaExecucao,
            dllInicializada: false,
            pinpadConectado: false,
          }
        );
      } else {
        biblioteca.inicializada = true;
      }
      if (typeof deps.guardarInstancia === "function") deps.guardarInstancia(biblioteca);
      if (typeof biblioteca.getResult === "function" && typeof deps.sincronizarOciosidade === "function") {
        const lido = await biblioteca.getResult(0x7f04);
        registrar("PW_iGetResult");
        if (lido?.codigo === PWRET_OK) await deps.sincronizarOciosidade(lido.valor);
      }
    }
    biblioteca = await promoverSessaoResidente(biblioteca, diretorio, deps.guardarInstancia);
    if (acao === "identificar") {
      const anterior = comunicacaoConfirmadaConhecida(deps);
      const preservada = anterior?.comunicacao === "confirmada";
      return {
        ok: true,
        codigo: "PWRET_OK",
        mensagem: preservada
          ? `A biblioteca de ${nomeAmbiente} foi identificada. A comunicação já confirmada permanece.`
          : `A biblioteca de ${nomeAmbiente} foi identificada. Esta consulta não testa a comunicação do PinPad.`,
        pago: false,
        executado: true,
        comunicacao: preservada ? "confirmada" : "nao_executada",
        comunicacaoDestaConsulta: "nao_executada",
        porta: preservada ? anterior.porta : null,
        portaNome: preservada ? anterior.portaNome : "",
        identificacao: preservada
          ? `Comunicação já confirmada em ${anterior.portaNome || `COM${anterior.porta}`}. Esta consulta não leu o modelo do PinPad.`
          : "Biblioteca inicializada. Esta consulta não testa a comunicação do PinPad.",
        pontoInstalado: pontoInstaladoNaExecucao,
        dllInicializada: true,
        pinpadConectado: preservada,
        chamadas,
        diretorio,
      };
    }
    const portaSalva = portaComunicacaoValida(deps.portaSalva) ? deps.portaSalva : PORTA_AUTOMATICA;
    const { teste, evento } = await concluirTesteComunicacao(
      biblioteca,
      registrar,
      deps.pinpadOcupado === true ? PORTA_AUTOMATICA : portaSalva
    );
    if (teste?.codigo === PWRET_INVCALL && residente) {
      const anterior = comunicacaoConfirmadaConhecida(deps);
      const portaAnterior = portaComunicacaoValida(anterior?.porta) ? anterior.porta : null;
      if (portaAnterior) {
        const porta = anterior.portaNome || nomeCom(portaAnterior);
        return {
          ok: true,
          codigo: "PWRET_OK",
          codigoBiblioteca: PWRET_INVCALL,
          mensagem: `A sessão já está inicializada. PW_iPPCommTest retornou -2494 e PW_iSetEnvironment não foi chamado. A comunicação confirmada permanece em ${porta}.`,
          pago: false,
          executado: true,
          comunicacao: "confirmada",
          porta: portaAnterior,
          portaNome: porta,
          pontoInstalado: pontoInstaladoNaExecucao,
          dllInicializada: true,
          pinpadConectado: true,
          identificacao: `Sessão já inicializada. Porta preservada ${porta}.`,
          chamadas,
          diretorio,
        };
      }
    }
    const portaValida = portaComunicacaoValida(teste?.porta);
    const capturaPendenteFalhou = Boolean(evento) && evento.codigo !== PWRET_OK;
    if (teste?.codigo !== PWRET_OK || !portaValida || capturaPendenteFalhou) {
      const semPorta = teste?.codigo === PWRET_OK && !portaValida && !capturaPendenteFalhou;
      const codigoFalha = teste?.codigo !== PWRET_OK ? teste?.codigo : capturaPendenteFalhou ? evento.codigo : teste?.codigo;
      return recusa(
        "PW_iPPCommTest",
        semPorta
          ? "PW_iPPCommTest retornou PWRET_OK sem informar a COM utilizada."
          : mensagemFalhaPinpad(codigoFalha, "PW_iPPCommTest") ||
            `PW_iPPCommTest não retornou PWRET_OK. Código ${codigoFalha ?? "ausente"}.`,
        {
          executado: true,
          codigoBiblioteca: codigoFalha ?? null,
          fase: semPorta ? "comunicacao" : faseFalhaPinpad(codigoFalha),
          chamadas,
          diretorio,
          porta: null,
          pontoInstalado: pontoInstaladoNaExecucao,
          dllInicializada: true,
          pinpadConectado: false,
        }
      );
    }
    const porta = nomeCom(teste.porta);
    if (Number.isInteger(teste.porta) && teste.porta > 0 && teste.porta < 255) {
      lembrarComunicacao(deps, {
        comunicacao: "confirmada",
        porta: teste.porta,
        portaNome: porta,
      });
      if (deps.pinpadOcupado !== true && typeof deps.persistirPorta === "function") {
        await deps.persistirPorta({ portaDescoberta: teste.porta, portaSalva: deps.portaSalva ?? null, transacaoAtiva: false });
      }
    }
    const exibicao = await apresentarIdentidadePinpad(biblioteca, deps.versaoPinpad);
    return {
      ok: true,
      codigo: "PWRET_OK",
      codigoBiblioteca: PWRET_OK,
      mensagem: `Pinpad conectado e comunicação confirmada. Porta utilizada ${porta}.`,
      pago: false,
      executado: true,
      comunicacao: "confirmada",
      porta: teste.porta,
      portaNome: porta,
      pontoInstalado: pontoInstaladoNaExecucao,
      dllInicializada: true,
      pinpadConectado: true,
      identificacao: teste.mensagem || (porta ? `PinPad respondeu em ${porta}.` : ""),
      exibicao,
      chamadas,
      diretorio,
    };
  } finally {
    liberarHomologacao("diagnostico");
  }
}

export async function abrirDiagnosticoNativo(arquivo) {
  let koffi;
  try {
    koffi = (await import("koffi")).default;
  } catch {
    throw Object.assign(new Error("O transporte nativo koffi não está instalado neste Connector."), {
      code: "TRANSPORTE_NATIVO_AUSENTE",
    });
  }
  const lib = koffi.load(arquivo);
  const setEnvironment = lib.func(assinaturaNativa("PW_iSetEnvironment"));
  const init = lib.func(assinaturaNativa("PW_iInit"));
  const ppCommTest = lib.func(assinaturaNativa("PW_iPPCommTest"));
  const ppDisplay = lib.func(assinaturaNativa("PW_iPPDisplay"));
  const ppSetIdleImage = lib.func(assinaturaNativa("PW_iPPSetIdleImage"));
  const ppEventLoop = lib.func(assinaturaNativa("PW_iPPEventLoop"));
  const getResult = lib.func(assinaturaNativa("PW_iGetResult"));
  const idleProc = lib.func(assinaturaNativa("PW_iIdleProc"));
  const end = lib.func(assinaturaNativa("PW_End"));
  return {
    homologacao: true,
    bibliotecaNativa: lib,
    async setEnvironment(codigo) {
      return setEnvironment(codigo);
    },
    async init(diretorio) {
      return init(diretorio);
    },
    async ppCommTest(porta) {
      const mensagem = Buffer.alloc(256);
      const portaSaida = Buffer.from([porta & 0xff]);
      const codigo = ppCommTest(mensagem, mensagem.length, portaSaida);
      return { codigo, mensagem: mensagem.toString("latin1").split("\0")[0], porta: portaSaida[0] };
    },
    async ppDisplay(texto) {
      return ppDisplay(String(texto ?? ""));
    },
    async ppSetIdleImage(texto) {
      return ppSetIdleImage(String(texto ?? ""), "");
    },
    async ppEventLoop() {
      const display = Buffer.alloc(128);
      const codigo = ppEventLoop(display, display.length);
      return { codigo, display: display.toString("latin1").split("\0")[0] };
    },
    async getResult(info) {
      const saida = Buffer.alloc(128);
      const codigo = getResult(info, saida, saida.length);
      return { codigo, valor: saida.toString("latin1").split("\0")[0] };
    },
    async idleProc() {
      return idleProc();
    },
    async end() {
      end();
      lib.unload();
    },
  };
}
