import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  arquivoConfigAtual,
  carregarConfigLocal,
  pastaConfigMaquina,
  salvarConfigLocal,
} from "./config-local.mjs";
import { pastaConectorHomologacao } from "./tef-perfil-conector.mjs";
import { continuarCaptura, normalizarRespostaMotor, pedidoLocalDoMotor } from "./tef-csharp-ponte.mjs";
import {
  escolherImpressora,
  imprimirPdfComSumatra,
  impressoraExiste,
  impressoraSegura,
  mensagemErroImpressora,
} from "./imprimir.mjs";
import {
  abrirGaveta,
  configuracaoGavetaDeConfig,
  sanitizarGavetaHabilitada,
  sanitizarPinoGaveta,
  MENSAGEM_GAVETA_DESABILITADA,
} from "./gaveta.mjs";
import { obterOuCriarDispositivoId } from "./identidade.mjs";
import {
  consultarSaudeLocal,
  descobrirSaudeConector,
  gravarPid,
  removerPid,
  HOST_LOCAL,
} from "./instancia.mjs";
import { registrarLog } from "./log.mjs";
import { localizarMotorPdf, motorParaHealth } from "./motor.mjs";
import {
  avisarInstanciaExistente,
  obterMutexExclusivo,
} from "./mutex.mjs";
import { carregarOrigens, ORIGENS_FIXAS, origemPermitidaCors } from "./origens.mjs";
import {
  candidatosPorta,
  escolherPortaLivre,
  portaOcupadaLoopback,
  portaValida,
  mensagemPortaOcupada,
  mensagemPortaForaDaFaixa,
  PORTA_PADRAO,
} from "./portas.mjs";
import {
  CODIGO_SAIDA_REINICIO,
  montarDiagnosticoConector,
  planejarAlteracaoPorta,
  planejarEncerramento,
  planejarReinicio,
  planejarRollbackPorta,
} from "./conector-ciclo.mjs";
import { gerarPdfTesteConector } from "./pdf-teste.mjs";
import { pastaDados, resolverRaizAgente } from "./raiz.mjs";
import {
  abrirDiagnosticoNativo,
  criarAgendadorOciosidadeHomologacao,
  executarDiagnosticoHomologacao,
  pinpadEmOperacaoFinanceira,
  pontoHomologacaoInstalado,
  transacaoHomologacaoAtiva,
} from "./tef-diagnostico-homologacao.mjs";
import { liberarHomologacao, ocupacaoHomologacao, reservarHomologacao } from "./tef-homologacao-ocupacao.mjs";
import { arquivoPortaPinpad, gravarPortaPinpad, lerPortaPinpad, listarPortasSeriaisWindows } from "./tef-porta-computador.mjs";
import { abrirInstalacaoNativa, encerrarInstalacaoSemConfirmacao, executarInstalacaoIsolada, instalacaoHomologacaoConcluida } from "./tef-instalacao-homologacao.mjs";
import { verificarDllPgWeb } from "./tef-dll.mjs";
import {
  MENSAGEM_TEF_NAO_INSTALADO,
  GerenciadorPgWeb,
  apresentarStatusTef,
  autorizacaoDoVinculo,
  pedidoHttpInstalacao,
  semSegredoTecnico,
  validarPayloadHttpTef,
} from "./tef.mjs";
import {
  apresentarVinculoTef,
  arquivoVinculoTef,
  gravarVinculoTef,
  lerVinculoTef,
  removerVinculoTef,
  validarVinculoTef,
  vinculoConfere,
} from "./tef-vinculo.mjs";
import {
  arquivoChaveTef,
  assinarAmbienteTef,
  assinarModalidadeTef,
  assinarIdentidadeTef,
  assinarPareamentoTef,
  assinarProvaTef,
  dadosFiscaisProvaTef,
  hashCodigoPareamento,
  hashComprovanteTef,
  juntarComprovanteTef,
  lerOuCriarChaveTef,
} from "./tef-prova.mjs";
import {
  arquivoPareamentoTef,
  conferirCodigoPareamento,
  consumirPareamento,
  garantirPareamento,
  gravarPareamentoTef,
  lerPareamentoTef,
} from "./tef-pareamento.mjs";
import {
  arquivoRecuperacaoTef,
  cobrancaBloqueadaPorRecuperacao,
  gravarRecuperacaoTef,
  lerRecuperacaoTef,
  registroRecuperacaoTef,
  removerRecuperacaoTef,
} from "./tef-recuperacao.mjs";
import { arquivoPendenciaTef, lerPendenciaTef } from "./tef-pendencia.mjs";
import { criarServicoPastaTef } from "./tef-pasta.mjs";
import { iniciarTray } from "./tray.mjs";
import { APP_CONECTOR, carregarVersao, NOME_CONECTOR, SERVICO_CONECTOR } from "./versao.mjs";

function pedidoHomologacaoIsolado(pathname) {
  return (
    pathname === "/tef/homologacao/pinpad" ||
    pathname === "/tef/homologacao/instalacao" ||
    pathname === "/tef/homologacao/identidade" ||
    pathname === "/tef/homologacao/identidade/apresentar" ||
    pathname === "/tef/homologacao/menu" ||
    pathname === "/tef/homologacao/comprovacao" ||
    pathname === "/tef/venda"
  );
}

const HOST = HOST_LOCAL;
const MAX_BODY = 8 * 1024 * 1024;
const RAIZ = resolverRaizAgente();
const VERSAO_INFO = carregarVersao(RAIZ);
const PAGINA_STATUS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "pagina-status.html"),
  "utf8"
);

const CABECALHOS_CORS_PERMITIDOS = [
  "Content-Type",
  "Cache-Control",
  "Pragma",
  "x-ultrapdv-empresa",
  "x-ultrapdv-terminal",
  "x-ultrapdv-desafio",
  "x-ultrapdv-identificador",
  "x-ultrapdv-valor-centavos",
  "x-ultrapdv-autorizacao",
  "x-ultrapdv-estabelecimento",
  "x-ultrapdv-dispositivo",
].join(", ");

function aplicarCors(headers, origem, origens) {
  if (origem && origemPermitidaCors(origem, origens)) {
    headers["Access-Control-Allow-Origin"] = origem;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Private-Network"] = "true";
  }
  return headers;
}

function respostaOperacaoTef(resultado) {
  const corpo = {
    ok: resultado?.ok === true,
    tef: apresentarStatusTef(resultado?.tef),
  };
  if (resultado?.codigo && resultado.codigo !== "ok") {
    corpo.codigo = resultado.codigo;
  }
  if (!corpo.ok) {
    corpo.erro = resultado?.erro || MENSAGEM_TEF_NAO_INSTALADO;
  }
  if (
    resultado?.resultado &&
    typeof resultado.resultado === "object" &&
    !Array.isArray(resultado.resultado)
  ) {
    corpo.resultado = semSegredoTecnico(resultado.resultado);
  }
  if (resultado && Object.prototype.hasOwnProperty.call(resultado, "evidencia")) {
    corpo.evidencia = resultado.evidencia && typeof resultado.evidencia === "object"
      ? resultado.evidencia
      : null;
  }
  return {
    status: Number(resultado?.statusHttp) || (corpo.ok ? 200 : 503),
    corpo,
  };
}

function json(res, status, corpo, origem, origens) {
  const headers = aplicarCors(
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    origem,
    origens
  );
  res.writeHead(status, headers);
  res.end(JSON.stringify(corpo));
}

function corpoIdentidadeConector({ porta, versao, nome }) {
  return {
    ok: true,
    app: APP_CONECTOR,
    servico: SERVICO_CONECTOR,
    nome,
    versao,
    version: versao,
    port: porta,
    porta,
  };
}

function portaDoHost(req, fallback) {
  const host = String(req.headers.host || "");
  const m = host.match(/:(\d+)$/);
  return m ? Number(m[1]) : fallback;
}

function origemPainelLocal(origem, porta) {
  return (
    origem === `http://127.0.0.1:${porta}` ||
    origem === `http://localhost:${porta}`
  );
}

function origemPermitida(req, origens, porta) {
  const origem = String(req.headers.origin || "").trim();
  if (!origem) {
    return { ok: true, origem: "" };
  }
  if (
    origemPermitidaCors(origem, origens) ||
    origemPainelLocal(origem, porta)
  ) {
    return { ok: true, origem };
  }
  return { ok: false, origem };
}

function podeAdministrar(origem, porta) {
  return !origem || origemPainelLocal(origem, porta);
}

function hostLocal(req) {
  const host = String(req.headers.host || "")
    .split(":")[0]
    .toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

function lerBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let tamanho = 0;
    req.on("data", (chunk) => {
      tamanho += chunk.length;
      if (tamanho > MAX_BODY) {
        reject(new Error("Documento excede o limite de 8 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function spawnTexto(comando, args) {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    let erro = "";
    filho.stdout.on("data", (data) => {
      saida += data.toString("utf8");
    });
    filho.stderr.on("data", (data) => {
      erro += data.toString("utf8");
    });
    filho.on("error", reject);
    filho.on("close", (code) => {
      if (code === 0) {
        resolve(saida);
      } else {
        reject(new Error(erro.trim() || `Comando falhou (${code}).`));
      }
    });
  });
}

export async function listarImpressoras() {
  const script =
    "Get-Printer | Select-Object Name,Default | ConvertTo-Json -Compress";
  const saida = await spawnTexto("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
  const parsed = JSON.parse(saida || "[]");
  const lista = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return lista
    .map((item) => ({
      nome: String(item.Name ?? "").trim(),
      padrao: Boolean(item.Default),
    }))
    .filter((item) => item.nome);
}

export function abrirPainelNoNavegador(porta) {
  const url = `http://127.0.0.1:${porta}/`;
  if (process.platform === "win32") {
    execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true });
  }
}

export function criarServidor(deps = {}) {
  const localizar = deps.localizarMotorPdf ?? localizarMotorPdf;
  const listar = deps.listarImpressoras ?? listarImpressoras;
  const imprimir = deps.imprimirPdfComSumatra ?? imprimirPdfComSumatra;
  const origensBase = deps.origens ?? ORIGENS_FIXAS;
  const nome = deps.nome ?? NOME_CONECTOR;
  const versao = deps.versao ?? VERSAO_INFO.version;
  const estado = deps.estado ?? { porta: PORTA_PADRAO, status: "conectado" };
  const obterId =
    deps.obterDispositivoId ??
    (async () => obterOuCriarDispositivoId({ pasta: pastaDados(RAIZ) }));
  const encerrar = deps.encerrarProcesso ?? (() => process.exit(0));
  const aoAlterarPorta = deps.aoAlterarPorta;
  const aoReiniciar = deps.aoReiniciar;
  const aoSalvarImpressora = deps.aoSalvarImpressora;
  const obterConfig =
    deps.obterConfigLocal ??
    (async () => ({
      lastPrinter: null,
      lastPaper: "80mm",
      drawerEnabled: false,
      drawerPin: 0,
    }));
  const gerenciadorTef =
    deps.gerenciadorTef ??
    new GerenciadorPgWeb({
      localizar: deps.localizarTefNativo,
      spawn: deps.spawnTef,
      registrarLog: deps.registrarLogTef,
      criarId: deps.criarIdTef,
      agendar: deps.agendarTef,
      cancelarAgendamento: deps.cancelarAgendamentoTef,
      limiteEncerramentoMs: deps.limiteEncerramentoTefMs,
      arquivoPendencia: deps.arquivoPendenciaTef,
    });
  const consultarStatusTef = deps.statusTef ?? (() => gerenciadorTef.consultar());
  const executarTesteTef = deps.testarTef ?? (() => gerenciadorTef.testar());
  const diagnosticarPinpadTef =
    deps.diagnosticarPinpadTef ??
    ((testar) => gerenciadorTef.diagnosticarPinpad(testar));
  const modoHomologacao = deps.diagnosticoHomologacao === true;
  async function bloqueioCiclo() {
    if (typeof deps.bloqueioCiclo === "function") return deps.bloqueioCiclo();
    if (pinpadEmOperacaoFinanceira(gerenciadorTef) || gerenciadorTef?.pendente) {
      return { permitido: false, motivo: "transacao" };
    }
    if (ocupacaoHomologacao()) return { permitido: false, motivo: "ocupacao" };
    const ativa = await transacaoHomologacaoAtiva({
      raiz: pastaConectorHomologacao(),
      gerenciador: gerenciadorTef,
    });
    if (ativa) return { permitido: false, motivo: "transacao" };
    return { permitido: true, motivo: "ocioso" };
  }
  let instanciaPinpadHomologacao = null;
  const agendadorOciosidade = criarAgendadorOciosidadeHomologacao({
        lerBiblioteca: () => instanciaPinpadHomologacao,
        bloqueado: async () =>
          ocupacaoHomologacao() != null ||
          (await transacaoHomologacaoAtiva({
            raiz: pastaConectorHomologacao(),
            gerenciador: gerenciadorTef,
          })),
        agendar(fn, ms) {
          const timer = setTimeout(fn, ms);
          timer.unref?.();
          return timer;
        },
      });
  const executarDiagnosticoHomologacaoTef =
    deps.executarDiagnosticoHomologacao ??
    (async (pedido, opcoes = {}) => {
      const producao = opcoes.ambiente === "producao";
      const { diretorioProducaoPgWeb } = await import("./tef-diretorio.mjs");
      const diretorioProducao = producao ? diretorioProducaoPgWeb() : "";
      const diretorioDll = path.join(resolverRaizAgente(), "bin", "tef");
      const arquivoPorta = arquivoPortaPinpad();
      const portaSalva = await lerPortaPinpad(arquivoPorta);
      const resultado = await executarDiagnosticoHomologacao(pedido, {
        executar: true,
        ambiente: producao ? "producao" : "homologacao",
        diretorio: diretorioProducao,
        raiz: producao ? "" : pastaConectorHomologacao(),
        portaSalva: portaSalva?.porta ?? null,
        persistirPorta: (entrada) => gravarPortaPinpad(arquivoPorta, entrada),
        versaoPinpad: VERSAO_INFO.version,
        pinpadOcupado: pinpadEmOperacaoFinanceira(gerenciadorTef),
        verificarDll: async () => ({
          ...(await verificarDllPgWeb(diretorioDll)),
          arquivo: path.join(diretorioDll, "PGWebLib.dll"),
        }),
        abrir: abrirDiagnosticoNativo,
        encerrarInstalacaoSemConfirmacao: async () => {
          const encerrada = await encerrarInstalacaoSemConfirmacao();
          if (encerrada.ok) instanciaPinpadHomologacao = null;
          return encerrada;
        },
        pontoInstalado: producao ? await pontoHomologacaoInstalado(diretorioProducao) : instalacaoHomologacaoConcluida(),
        instancia: instanciaPinpadHomologacao,
        guardarInstancia(biblioteca) {
          instanciaPinpadHomologacao = biblioteca;
        },
        sincronizarOciosidade: (valor) => agendadorOciosidade?.sincronizar(valor),
      });
      const portasDisponiveis = await listarPortasSeriaisWindows();
      if (resultado && typeof resultado === "object") {
        const publico = { ...resultado, portasDisponiveis };
        delete publico.diretorio;
        return publico;
      }
      return resultado;
    });
  const executarInicializacaoTef =
    deps.inicializarTef ??
    (async () => {
      const vinculo = await lerVinculo();
      const dispositivoLocal = String(await obterId());
      return gerenciadorTef.inicializar(autorizacaoDoVinculo(vinculo, dispositivoLocal));
    });
  const executarInstalacaoTef =
    deps.instalarTef ??
    (async (credencial, opcoes = {}) => {
      const vinculo = await lerVinculo();
      const dispositivoLocal = String(await obterId());
      const chave = await lerChave();
      const autorizado = autorizacaoDoVinculo(vinculo, dispositivoLocal, chave?.privada);
      if (!autorizado) {
        return gerenciadorTef.instalar(null);
      }
      return gerenciadorTef.instalar({
        ...autorizado,
        credencial,
        provisionarNovo: opcoes?.provisionarNovo === true,
      });
    });
  const executarPagamentoTef =
    deps.pagarTef ?? ((dados) => gerenciadorTef.pagar(dados));
  const executarConfirmacaoTef =
    deps.confirmarTef ?? ((dados) => gerenciadorTef.confirmar(dados));
  const executarDesfazimentoTef =
    deps.desfazerTef ?? ((dados) => gerenciadorTef.desfazer(dados));
  const arquivoVinculo = deps.arquivoVinculoTef ?? arquivoVinculoTef();
  const lerVinculo =
    deps.lerVinculoTef ?? (() => lerVinculoTef(arquivoVinculo));
  const gravarVinculo =
    deps.gravarVinculoTef ??
    ((vinculo) => gravarVinculoTef(arquivoVinculo, vinculo));
  const removerVinculo =
    deps.removerVinculoTef ?? (() => removerVinculoTef(arquivoVinculo));
  const exigirVinculoTef = deps.exigirVinculoTef !== false;
  const lerChave =
    deps.lerChaveTef ??
    (() => lerOuCriarChaveTef(deps.arquivoChaveTef ?? arquivoChaveTef()));
  const arquivoPareamento = deps.arquivoPareamentoTef ?? arquivoPareamentoTef();
  const lerPareamento =
    deps.lerPareamentoTef ?? (() => lerPareamentoTef(arquivoPareamento));
  const gravarPareamento =
    deps.gravarPareamentoTef ??
    ((pareamento) => gravarPareamentoTef(arquivoPareamento, pareamento));
  const arquivoRecuperacao = deps.arquivoRecuperacaoTef ?? arquivoRecuperacaoTef();
  const lerRecuperacao =
    deps.lerRecuperacaoTef ?? (() => lerRecuperacaoTef(arquivoRecuperacao));
  const gravarRecuperacao =
    deps.gravarRecuperacaoTef ??
    ((registro) => gravarRecuperacaoTef(arquivoRecuperacao, registro));
  const removerRecuperacao =
    deps.removerRecuperacaoTef ?? (() => removerRecuperacaoTef(arquivoRecuperacao));
  const servicoPasta =
    deps.servicoPastaTef ??
    criarServicoPastaTef({
      arquivo: deps.arquivoPastaTef,
      raizExecutavel: path.join(RAIZ, "bin", "tef"),
    });
  function origemLoopback(origem) {
    if (!origem) {
      return true;
    }
    try {
      const endereco = new URL(origem);
      return endereco.hostname === "127.0.0.1" || endereco.hostname === "localhost";
    } catch {
      return false;
    }
  }
  function headerTef(req, nome) {
    const valor = req.headers[nome];
    return String(Array.isArray(valor) ? valor[0] ?? "" : valor ?? "").trim();
  }
  async function contextoFinanceiroTef(req) {
    const vinculo = await lerVinculo();
    const conferencia = vinculoConfere(vinculo, req.headers);
    if (!conferencia.ok) {
      return conferencia;
    }
    if (exigirVinculoTef && !vinculo) {
      return { ok: false, erro: "Terminal TEF não vinculado." };
    }
    const desafio = headerTef(req, "x-ultrapdv-desafio");
    if (exigirVinculoTef && !/^[a-f0-9]{32,128}$/i.test(desafio)) {
      return { ok: false, erro: "Desafio TEF ausente." };
    }
    return { ok: true, desafio };
  }
  async function montarContextoPasta(req, origemInformada) {
    if (!origemInformada) {
      return { ok: false, status: 403, erro: "Abra esta tela pelo UltraPDV." };
    }
    if (!hostLocal(req)) {
      return {
        ok: false,
        status: 403,
        erro: "A pasta só pode ser escolhida neste computador.",
      };
    }
    const dispositivo = headerTef(req, "x-ultrapdv-dispositivo");
    const local = String(await obterId());
    if (!dispositivo || dispositivo !== local) {
      return {
        ok: false,
        status: 403,
        erro: "Este computador não está vinculado ao UltraPDV.",
      };
    }
    const financeiro = await contextoFinanceiroTef(req);
    if (!financeiro.ok) {
      return { ok: false, status: 403, erro: financeiro.erro };
    }
    const vinculo = await lerVinculo();
    if (!vinculo?.ambiente) {
      return {
        ok: false,
        status: 403,
        erro: "Vincule este computador antes de escolher a pasta.",
      };
    }
    const statusTef = await consultarStatusTef();
    const pendencia = await lerPendenciaTef(
      deps.arquivoPendenciaTef ?? gerenciadorTef.arquivoPendencia ?? arquivoPendenciaTef()
    );
    const recuperacao = await lerRecuperacao();
    return {
      ok: true,
      ctx: {
        ambiente: vinculo.ambiente === "producao" ? "producao" : "homologacao",
        inicializado:
          statusTef?.inicializado === true || gerenciadorTef.inicializado === true,
        emUso:
          gerenciadorTef.pendente != null ||
          statusTef?.processo === "executando" ||
          statusTef?.processo === "iniciando",
        journal: pendencia?.ok ? pendencia.registro : null,
        journalIlegivel: pendencia?.ok !== true,
        recuperacao,
        diretorioTrabalho:
          statusTef?.diretorioTrabalho ?? gerenciadorTef.diretorioTrabalho ?? "",
        diretorioPwInit:
          statusTef?.diretorioPwInit ?? gerenciadorTef.diretorioPwInit ?? "",
        retornoPwInit: statusTef?.retornoPwInit ?? gerenciadorTef.retornoPwInit,
        retornoPwInitNome:
          statusTef?.retornoPwInitNome ?? gerenciadorTef.retornoPwInitNome ?? "",
      },
    };
  }
  async function anexarProvaTef(corpo, campos) {
    if (!campos.desafio) {
      return corpo;
    }
    const chave = await lerChave();
    if (!chave?.privada) {
      return corpo;
    }
    const assinado = {
      ...corpo,
      prova: assinarProvaTef(chave.privada, campos),
    };
    if (campos.acao === "pagamento" && campos.ambiente) {
      assinado.provaAmbiente = assinarAmbienteTef(chave.privada, campos.ambiente);
    }
    if (campos.acao === "pagamento" && campos.modalidade) {
      assinado.provaModalidade = assinarModalidadeTef(chave.privada, campos.modalidade);
    }
    return assinado;
  }
  const aoTestarImpressao = deps.aoTestarImpressao ?? (async (input) => {
    const motor = await localizar();
    const impressoras = await listar();
    const cfg = await obterConfig();
    const impressora = escolherImpressora({
      pedida: input.impressora,
      lastPrinter: cfg.lastPrinter,
      impressoras,
    });
    if (!impressora) {
      throw new Error(mensagemErroImpressora({
        pedida: input.impressora,
        lastPrinter: cfg.lastPrinter,
      }));
    }
    const papel = input.papel || cfg.lastPaper || "80mm";
    const pdf = gerarPdfTesteConector({
      porta: estado.porta,
      versao,
      impressora,
      papel,
    });
    await imprimir({
      motor,
      impressora,
      copias: 1,
      papel,
      pdfBase64: pdf.toString("base64"),
      impressoras,
    });
    return { ok: true, impressora, papel };
  });

  const sessoesMotorCsharp = new Map();

  function caminhoMotorCsharp() {
    const candidatos = [
      process.env.ULTRAPDV_TEF_HOST,
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../UltraPDV.TEF/src/UltraPDV.TEF.Host/bin/Release/net8.0/UltraPDV.TEF.Host.exe"),
      "C:\\ultrapdv\\UltraPDV.TEF\\src\\UltraPDV.TEF.Host\\bin\\Release\\net8.0\\UltraPDV.TEF.Host.exe",
    ].filter(Boolean);
    for (const candidato of candidatos) {
      try {
        readFileSync(candidato);
        return candidato;
      } catch {
        continue;
      }
    }
    return null;
  }

  function terminalDaEmpresa(raiz, empresaId) {
    const pasta = path.resolve(raiz, String(empresaId).replace(/-/g, ""));
    const arquivo = path.join(pasta, "terminal.json");
    try {
      const salvo = JSON.parse(readFileSync(arquivo, "utf8"));
      if (/^[0-9a-f-]{36}$/i.test(salvo.terminalId ?? "")) {
        return salvo.terminalId;
      }
    } catch {
      /* o primeiro uso deste computador cria o terminal da empresa */
    }
    const terminalId = crypto.randomUUID();
    mkdirSync(pasta, { recursive: true });
    writeFileSync(arquivo, JSON.stringify({ terminalId }));
    return terminalId;
  }

  function abrirSessaoMotor(exe) {
    const child = spawn(exe, [], { windowsHide: true });
    const sessao = {
      id: crypto.randomUUID(),
      child,
      pendentes: [],
      espera: [],
      buffer: "",
    };
    const entregar = (linha) => {
      const resolver = sessao.espera.shift();
      if (resolver) {
        resolver(linha);
      } else {
        sessao.pendentes.push(linha);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (parte) => {
      sessao.buffer += parte;
      let quebra = sessao.buffer.indexOf("\n");
      while (quebra >= 0) {
        const linha = sessao.buffer.slice(0, quebra).replace(/\r$/, "");
        sessao.buffer = sessao.buffer.slice(quebra + 1);
        if (linha.trim()) {
          entregar(linha);
        }
        quebra = sessao.buffer.indexOf("\n");
      }
    });
    child.stdout.on("end", () => {
      if (sessao.buffer.trim()) {
        entregar(sessao.buffer.trim());
        sessao.buffer = "";
      }
    });
    child.on("error", () => entregar(null));
    child.on("close", () => {
      sessoesMotorCsharp.delete(sessao.id);
      entregar(null);
    });
    sessoesMotorCsharp.set(sessao.id, sessao);
    return sessao;
  }

  function proximaLinhaMotor(sessao, timeoutMs) {
    if (sessao.pendentes.length > 0) {
      return Promise.resolve(sessao.pendentes.shift());
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      sessao.espera.push((linha) => {
        clearTimeout(timer);
        resolve(linha);
      });
    });
  }

  async function lerLinhaProtocolo(sessao, prazo) {
    while (Date.now() < prazo) {
      const linha = await proximaLinhaMotor(sessao, Math.max(1, prazo - Date.now()));
      if (!linha) {
        return null;
      }
      try {
        const bruto = JSON.parse(linha);
        if (bruto && typeof bruto === "object" && (bruto.tipo === "captura" || bruto.tipo === "resultado")) {
          return bruto;
        }
      } catch {
        /* a DLL pode escrever texto fora do protocolo; a próxima linha segue a instalação */
      }
    }
    return null;
  }

  async function lerResultadoMotor(sessao) {
    const prazo = Date.now() + 180000;
    while (Date.now() < prazo) {
      const bruto = await lerLinhaProtocolo(sessao, prazo);
      if (!bruto) {
        break;
      }
      const normalizada = normalizarRespostaMotor(bruto, sessao.id);
      if (normalizada.fase !== "captura") {
        sessao.child.kill();
        sessoesMotorCsharp.delete(sessao.id);
      }
      return normalizada;
    }
    return {
      ok: false,
      fase: "resultado",
      pagamentoRecebido: false,
      confirmada: false,
      nativo: false,
      codigo: "MOTOR_TIMEOUT",
      erro: "O motor C# não respondeu. Nenhuma cobrança foi confirmada.",
    };
  }

  async function executarMotorCsharp(corpo) {
    const exe = caminhoMotorCsharp();
    if (!exe) {
      return {
        ok: false,
        pagamentoRecebido: false,
        confirmada: false,
        nativo: false,
        codigo: "MOTOR_LOCAL_AUSENTE",
        erro: "O motor C# não está disponível neste Connector. Nenhuma cobrança foi iniciada.",
      };
    }
    if (corpo?.comando === "responder") {
      const sessao = sessoesMotorCsharp.get(corpo.sessao);
      const continuacao = continuarCaptura(sessao, corpo);
      if (!continuacao.continuar) {
        return {
          ok: false,
          pagamentoRecebido: false,
          confirmada: false,
          nativo: false,
          codigo: continuacao.codigo,
          erro: continuacao.erro,
        };
      }
      sessao.child.stdin.write(`${JSON.stringify({ valor: continuacao.valor, cancelar: continuacao.cancelar })}\n`);
      return comIdentidadeMotor(await lerResultadoMotor(sessao), sessao.terminalId);
    }

    const raiz = process.env.ULTRAPDV_TEF_RAIZ || "C:\\ProgramData\\UltraPDV\\tef-empresas";
    const empresaId = typeof corpo?.empresaId === "string" ? corpo.empresaId : "";
    const comando = corpo?.comando === "status" || !corpo?.comando ? "status" : corpo.comando;
    let preparado;
    try {
      if (comando !== "status" && !/^[0-9a-f-]{36}$/i.test(empresaId)) {
        throw new Error("EMPRESA_INVALIDA");
      }
      const terminalId = comando === "status" ? null : terminalDaEmpresa(raiz, empresaId);
      preparado = pedidoLocalDoMotor({ ...(corpo ?? {}), comando, terminalId }, { raiz });
    } catch {
      return {
        ok: false,
        pagamentoRecebido: false,
        confirmada: false,
        nativo: false,
        codigo: "EMPRESA_INVALIDA",
        erro: "A empresa ativa não pôde ser isolada. Nenhuma cobrança foi iniciada.",
      };
    }
    if (preparado.bloqueado) {
      return {
        ok: false,
        pagamentoRecebido: false,
        confirmada: false,
        nativo: false,
        codigo: "PRODUCAO_NAO_AUTORIZADA",
        erro: "Produção não está autorizada. Nenhuma cobrança foi iniciada.",
      };
    }
    if (preparado.pedido.diretorio) {
      mkdirSync(preparado.pedido.diretorio, { recursive: true });
    }
    const sessao = abrirSessaoMotor(exe);
    sessao.comando = preparado.pedido.comando;
    sessao.operacaoNativa = preparado.pedido.operacaoNativa || "";
    sessao.chave = preparado.pedido.chave || "";
    sessao.terminalId = preparado.pedido.terminalId || "";
    sessao.child.stdin.write(`${JSON.stringify(preparado.pedido)}\n`);
    return comIdentidadeMotor(await lerResultadoMotor(sessao), sessao.terminalId);
  }

  async function comIdentidadeMotor(resultado, terminalId) {
    let dispositivoId = "";
    try {
      dispositivoId = String(await obterId());
    } catch {
      dispositivoId = "";
    }
    return {
      ...resultado,
      terminalId: terminalId || null,
      dispositivoId,
    };
  }

  function lerCorpoJson(req) {
    return new Promise((resolve) => {
      const partes = [];
      req.on("data", (parte) => partes.push(parte));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}"));
        } catch {
          resolve({});
        }
      });
      req.on("error", () => resolve({}));
    });
  }

  return http.createServer(async (req, res) => {
    const portaReq = portaDoHost(req, estado.porta);
    const origens = [
      ...origensBase,
      `http://127.0.0.1:${portaReq}`,
      `http://localhost:${portaReq}`,
    ];
    const origemCheck = origemPermitida(req, origens, portaReq);
    if (!origemCheck.ok) {
      json(res, 403, { ok: false, erro: "Origem não permitida." }, "", origens);
      return;
    }

    if (!hostLocal(req)) {
      json(
        res,
        403,
        { ok: false, erro: "Somente localhost." },
        origemCheck.origem,
        origens
      );
      return;
    }

    if (req.method === "OPTIONS") {
      const headers = aplicarCors(
        {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": CABECALHOS_CORS_PERMITIDOS,
          "Access-Control-Max-Age": "600",
        },
        origemCheck.origem,
        origens
      );
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${HOST}:${portaReq}`);
    if (url.pathname === "/tef/csharp") {
      const corpo = req.method === "POST" ? await lerCorpoJson(req) : { comando: "status" };
      const resultado = await executarMotorCsharp(corpo);
      json(res, 200, resultado, origemCheck.origem, origens);
      return;
    }
    if (url.pathname === "/tef" || url.pathname.startsWith("/tef/")) {
      json(
        res,
        410,
        {
          ok: false,
          codigo: "TEF_DESATIVADO",
          erro: "A integração operacional do TEF foi desativada neste Connector. Impressão e gaveta permanecem. Nenhuma cobrança, instalação ou comunicação com PinPad foi iniciada.",
        },
        origemCheck.origem,
        origens
      );
      return;
    }
    if (
      modoHomologacao &&
      url.pathname.startsWith("/tef/") &&
      !pedidoHomologacaoIsolado(url.pathname)
    ) {
      json(
        res,
        403,
        { ok: false, erro: "Este Connector de homologação não executa operação financeira." },
        origemCheck.origem,
        origens
      );
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(PAGINA_STATUS);
        return;
      }

      if (
        req.method === "GET" &&
        (url.pathname === "/status" || url.pathname === "/health")
      ) {
        const identidade = corpoIdentidadeConector({
          porta: portaReq,
          versao,
          nome,
        });
        if (url.pathname === "/status") {
          json(res, 200, identidade, origemCheck.origem, origens);
          return;
        }
        const motor = await localizar();
        const dispositivoId = await obterId();
        const cfg = await obterConfig();
        json(
          res,
          200,
          {
            ...identidade,
            dispositivoId,
            lastPrinter: cfg.lastPrinter || null,
            lastPaper: cfg.lastPaper || "80mm",
            drawerEnabled: sanitizarGavetaHabilitada(cfg.drawerEnabled),
            drawerPin: sanitizarPinoGaveta(cfg.drawerPin),
            motorImpressao: motorParaHealth(motor),
            ...(modoHomologacao ? { diagnosticoHomologacao: true, financeiro: false } : {}),
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/printers") {
        const impressoras = await listar();
        json(res, 200, { ok: true, impressoras }, origemCheck.origem, origens);
        return;
      }

      if (req.method === "POST" && url.pathname === "/shutdown") {
        if (!podeAdministrar(origemCheck.origem, portaReq)) {
          json(
            res,
            403,
            { ok: false, erro: "Shutdown recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const brutoSaida = await lerBody(req);
        let modoSaida = "aplicativo";
        try {
          const pedidoSaida = JSON.parse(brutoSaida.toString("utf8") || "{}");
          if (pedidoSaida?.modo) modoSaida = String(pedidoSaida.modo);
        } catch {
          modoSaida = "aplicativo";
        }
        const saida = planejarEncerramento(modoSaida, await bloqueioCiclo());
        if (!saida.encerraProcesso) {
          json(res, saida.status || 200, saida, origemCheck.origem, origens);
          return;
        }
        json(res, 200, { ok: true, status: "encerrando", concluido: false }, origemCheck.origem, origens);
        setTimeout(() => encerrar(), 50);
        return;
      }

      if (req.method === "POST" && url.pathname === "/restart") {
        if (!podeAdministrar(origemCheck.origem, portaReq)) {
          json(
            res,
            403,
            { ok: false, erro: "Reinício recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const reinicio = planejarReinicio(await bloqueioCiclo(), {
          supervisor: process.env.ULTRAPDV_SUPERVISOR === "1",
        });
        if (!reinicio.ok) {
          json(res, 409, reinicio, origemCheck.origem, origens);
          return;
        }
        json(res, 200, reinicio, origemCheck.origem, origens);
        if (aoReiniciar) {
          setTimeout(() => {
            void aoReiniciar(reinicio);
          }, 80);
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/config/port") {
        if (!podeAdministrar(origemCheck.origem, portaReq)) {
          json(
            res,
            403,
            { ok: false, erro: "Alteração de porta recusada." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const bruto = await lerBody(req);
        let payload = {};
        try {
          payload = JSON.parse(bruto.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        if (payload.usarProxima !== true && !portaValida(payload.porta)) {
          json(
            res,
            400,
            { ok: false, erro: mensagemPortaForaDaFaixa() },
            origemCheck.origem,
            origens
          );
          return;
        }
        const bloqueioPorta = await bloqueioCiclo();
        if (bloqueioPorta.permitido !== true) {
          json(
            res,
            409,
            planejarAlteracaoPorta({
              porta: payload.porta,
              portaAtual: portaReq,
              bloqueio: bloqueioPorta,
            }),
            origemCheck.origem,
            origens
          );
          return;
        }
        if (!aoAlterarPorta) {
          json(res, 501, { ok: false, erro: "Indisponível." }, origemCheck.origem, origens);
          return;
        }
        const resultado = await aoAlterarPorta(payload, portaReq);
        json(
          res,
          resultado.status || (resultado.ok ? 200 : 409),
          resultado,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/config/printer") {
        if (!podeAdministrar(origemCheck.origem, portaReq)) {
          json(
            res,
            403,
            { ok: false, erro: "Alteração de impressora recusada." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const brutoCfg = await lerBody(req);
        let payloadCfg = {};
        try {
          payloadCfg = JSON.parse(brutoCfg.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const impressoras = await listar();
        const nomeImpressora = impressoraSegura(payloadCfg.impressora);
        if (!impressoraExiste(impressoras, nomeImpressora)) {
          json(
            res,
            400,
            { ok: false, erro: "Selecione uma impressora instalada neste computador." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const papel = ["58mm", "80mm", "a4"].includes(payloadCfg.papel)
          ? payloadCfg.papel
          : "80mm";
        const patchImpressora = {
          impressora: nomeImpressora,
          papel,
        };
        if ("gavetaHabilitada" in payloadCfg || "drawerEnabled" in payloadCfg) {
          patchImpressora.drawerEnabled = sanitizarGavetaHabilitada(
            payloadCfg.gavetaHabilitada ?? payloadCfg.drawerEnabled
          );
        }
        if ("gavetaPino" in payloadCfg || "drawerPin" in payloadCfg) {
          patchImpressora.drawerPin = sanitizarPinoGaveta(
            payloadCfg.gavetaPino ?? payloadCfg.drawerPin
          );
        }
        if (!aoSalvarImpressora) {
          json(res, 501, { ok: false, erro: "Indisponível." }, origemCheck.origem, origens);
          return;
        }
        const salvo = await aoSalvarImpressora(patchImpressora);
        json(
          res,
          200,
          {
            ok: true,
            lastPrinter: salvo?.lastPrinter || nomeImpressora,
            lastPaper: salvo?.lastPaper || papel,
            drawerEnabled: sanitizarGavetaHabilitada(
              salvo?.drawerEnabled ?? patchImpressora.drawerEnabled
            ),
            drawerPin: sanitizarPinoGaveta(
              salvo?.drawerPin ?? patchImpressora.drawerPin
            ),
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/print/teste") {
        if (!podeAdministrar(origemCheck.origem, portaReq)) {
          json(
            res,
            403,
            { ok: false, erro: "Teste recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const bruto = await lerBody(req);
        let payload = {};
        try {
          payload = JSON.parse(bruto.toString("utf8") || "{}");
        } catch {
          payload = {};
        }
        let resultadoTeste;
        try {
          resultadoTeste = await aoTestarImpressao(payload);
        } catch (erroTeste) {
          json(
            res,
            409,
            { ok: false, impresso: false, erro: erroTeste instanceof Error ? erroTeste.message : "Falha no teste." },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (resultadoTeste?.ok !== true || !resultadoTeste.impressora) {
          json(
            res,
            409,
            { ok: false, impresso: false, erro: resultadoTeste?.erro || "A impressão de teste não foi confirmada." },
            origemCheck.origem,
            origens
          );
          return;
        }
        json(res, 200, { ok: true, impresso: true, ...resultadoTeste }, origemCheck.origem, origens);
        return;
      }

      if (req.method === "POST" && url.pathname === "/print") {
        const bruto = await lerBody(req);
        let payload;
        try {
          payload = JSON.parse(bruto.toString("utf8") || "{}");
        } catch {
          json(
            res,
            400,
            { ok: false, erro: "Payload inválido." },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          json(
            res,
            400,
            { ok: false, erro: "Payload recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (
          payload.comando ||
          payload.command ||
          payload.path ||
          payload.arquivo
        ) {
          json(
            res,
            400,
            { ok: false, erro: "Payload recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }

        const motor = await localizar();
        const impressoras = await listar();
        const cfg = await obterConfig();
        const impressora = escolherImpressora({
          pedida: payload.impressora,
          lastPrinter: cfg.lastPrinter,
          impressoras,
        });
        if (!impressora) {
          throw new Error(
            mensagemErroImpressora({
              pedida: payload.impressora,
              lastPrinter: cfg.lastPrinter,
            })
          );
        }
        const papel = payload.papel || cfg.lastPaper || "80mm";
        await imprimir({
          motor,
          impressora,
          copias: payload.copias,
          papel,
          pdfBase64: payload.pdfBase64 || payload.conteudo,
          impressoras,
        });
        if (deps.aoImpressaoOk) {
          await deps.aoImpressaoOk({
            impressora,
            papel,
          });
        }
        json(
          res,
          200,
          { ok: true, impressora, papel },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/drawer/open") {
        const brutoGaveta = await lerBody(req).catch(() => Buffer.from("{}"));
        let payloadGaveta = {};
        try {
          payloadGaveta = JSON.parse(brutoGaveta.toString("utf8") || "{}");
        } catch {
          payloadGaveta = {};
        }
        if (
          payloadGaveta &&
          typeof payloadGaveta === "object" &&
          !Array.isArray(payloadGaveta) &&
          (payloadGaveta.comando ||
            payloadGaveta.command ||
            payloadGaveta.path ||
            payloadGaveta.arquivo)
        ) {
          json(
            res,
            400,
            { ok: false, erro: "Payload recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }

        const adminLocal = podeAdministrar(origemCheck.origem, portaReq);
        const cfgGaveta = await obterConfig();
        const impressorasGaveta = await listar();
        const pedidaGaveta = adminLocal
          ? payloadGaveta?.impressora
          : null;
        const impressoraGaveta = escolherImpressora({
          pedida: pedidaGaveta,
          lastPrinter: cfgGaveta.lastPrinter,
          impressoras: impressorasGaveta,
        });
        if (!impressoraGaveta) {
          throw new Error(
            mensagemErroImpressora({
              pedida: pedidaGaveta,
              lastPrinter: cfgGaveta.lastPrinter,
            })
          );
        }

        const cfgAbrir = configuracaoGavetaDeConfig(cfgGaveta);
        if (adminLocal) {
          cfgAbrir.habilitada = true;
          if (payloadGaveta && ("pino" in payloadGaveta || "gavetaPino" in payloadGaveta)) {
            cfgAbrir.pino = sanitizarPinoGaveta(
              payloadGaveta.pino ?? payloadGaveta.gavetaPino
            );
          }
        }
        if (!cfgAbrir.habilitada) {
          json(
            res,
            400,
            { ok: false, erro: MENSAGEM_GAVETA_DESABILITADA },
            origemCheck.origem,
            origens
          );
          return;
        }

        const abrir =
          deps.aoAbrirGaveta ??
          ((alvo, config, extra) => abrirGaveta(alvo, config, extra));
        const resultadoGaveta = await abrir(impressoraGaveta, cfgAbrir, {
          impressoras: impressorasGaveta,
        });
        json(
          res,
          200,
          { ok: true, ...resultadoGaveta },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/tef/status") {
        const tef = apresentarStatusTef(await consultarStatusTef());
        const vinculoBruto = await lerVinculo();
        const vinculo = apresentarVinculoTef(vinculoBruto);
        const perfil = await gerenciadorTef.descreverPerfilAutonomo(vinculoBruto);
        if (perfil?.efetivo) {
          tef.perfilAutonomo = perfil;
        }
        json(res, 200, { ok: true, tef, vinculo }, origemCheck.origem, origens);
        return;
      }

      if (
        (req.method === "GET" && url.pathname === "/tef/pasta") ||
        (req.method === "POST" &&
          (url.pathname === "/tef/pasta/escolher" ||
            url.pathname === "/tef/pasta/recomendada" ||
            url.pathname === "/tef/pasta/salvar"))
      ) {
        const acessoPasta = await montarContextoPasta(req, origemCheck.origem);
        if (!acessoPasta.ok) {
          json(
            res,
            acessoPasta.status,
            { ok: false, pronto: false, erro: acessoPasta.erro },
            origemCheck.origem,
            origens
          );
          return;
        }
        let corpoPasta = {};
        if (req.method === "POST") {
          const brutoPasta = await lerBody(req);
          try {
            corpoPasta = JSON.parse(brutoPasta.toString("utf8") || "{}");
          } catch {
            json(
              res,
              400,
              { ok: false, pronto: false, erro: "Payload inválido." },
              origemCheck.origem,
              origens
            );
            return;
          }
        }
        const resultadoPasta =
          url.pathname === "/tef/pasta"
            ? await servicoPasta.consultar(acessoPasta.ctx)
            : url.pathname === "/tef/pasta/escolher"
              ? await servicoPasta.escolher(acessoPasta.ctx, corpoPasta)
              : url.pathname === "/tef/pasta/recomendada"
                ? await servicoPasta.recomendada(acessoPasta.ctx, corpoPasta)
                : await servicoPasta.salvar(acessoPasta.ctx, corpoPasta);
        const statusPasta =
          resultadoPasta.ok === true
            ? 200
            : resultadoPasta.codigo === "bloqueado"
              ? 409
              : resultadoPasta.codigo === "payload" || resultadoPasta.codigo === "selecao"
                ? 400
                : 422;
        json(res, statusPasta, resultadoPasta, origemCheck.origem, origens);
        return;
      }

      if (req.method === "GET" && url.pathname === "/tef/biblioteca/evidencia") {
        const prova = await gerenciadorTef.lerEvidenciaBiblioteca();
        json(
          res,
          prova.statusHttp,
          prova.ok
            ? { ok: true, versao: prova.versao, campos: prova.campos, assinatura: prova.assinatura }
            : { ok: false, erro: prova.erro },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/tef/identidade") {
        const chave = await lerChave();
        const dispositivoId = String(await obterId());
        json(
          res,
          200,
          {
            ok: true,
            dispositivoId,
            chavePublica: chave.publica,
            chaveId: chave.id,
            assinatura: assinarIdentidadeTef(chave.privada, dispositivoId),
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/tef/pareamento") {
        if (!origemLoopback(origemCheck.origem)) {
          json(
            res,
            403,
            { ok: false, erro: "O código de pareamento só aparece neste computador." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const emitido = garantirPareamento(await lerPareamento());
        await gravarPareamento(emitido);
        json(
          res,
          200,
          { ok: true, codigo: emitido.codigo, expiraEm: emitido.expiraEm },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/pareamento/apresentar") {
        let dadosCodigo;
        try {
          dadosCodigo = JSON.parse((await lerBody(req)).toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        if (
          !dadosCodigo ||
          Array.isArray(dadosCodigo) ||
          typeof dadosCodigo !== "object" ||
          Object.keys(dadosCodigo).some((chave) => chave !== "codigo")
        ) {
          json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
          return;
        }
        const conferenciaCodigo = conferirCodigoPareamento(
          await lerPareamento(),
          dadosCodigo.codigo
        );
        if (!conferenciaCodigo.ok) {
          if (conferenciaCodigo.atual) {
            await gravarPareamento(conferenciaCodigo.atual);
          }
          json(
            res,
            403,
            { ok: false, erro: conferenciaCodigo.erro },
            origemCheck.origem,
            origens
          );
          return;
        }
        const chaveApresentacao = await lerChave();
        const dispositivoApresentacao = String(await obterId());
        json(
          res,
          200,
          {
            ok: true,
            dispositivoId: dispositivoApresentacao,
            chavePublica: chaveApresentacao.publica,
            chaveId: chaveApresentacao.id,
            assinaturaPareamento: assinarPareamentoTef(
              chaveApresentacao.privada,
              hashCodigoPareamento(dadosCodigo.codigo),
              dispositivoApresentacao
            ),
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/chave/rotacionar") {
        if (!origemLoopback(origemCheck.origem)) {
          json(
            res,
            403,
            { ok: false, erro: "A chave só pode ser substituída neste computador." },
            origemCheck.origem,
            origens
          );
          return;
        }
        await gerenciadorTef.garantirPendencia?.();
        const statusRotacao = await consultarStatusTef();
        if (statusRotacao?.transacaoPendenteConfirmacao === true) {
          json(
            res,
            409,
            { ok: false, erro: "Há transação TEF pendente. Resolva antes de substituir a chave." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const { gerarChaveTef } = await import("./tef-prova.mjs");
        const novaChave = gerarChaveTef();
        const arquivoChave = deps.arquivoChaveTef ?? arquivoChaveTef();
        const fsChave = await import("node:fs/promises");
        await fsChave.mkdir(path.dirname(arquivoChave), { recursive: true });
        await fsChave.writeFile(arquivoChave, JSON.stringify(novaChave), {
          encoding: "utf8",
          mode: 0o600,
        });
        json(
          res,
          200,
          { ok: true, chaveId: novaChave.id },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/tef/recuperacao") {
        const vinculoRecuperacao = await lerVinculo();
        const conferenciaRecuperacao = vinculoConfere(vinculoRecuperacao, req.headers);
        if (!vinculoRecuperacao || !conferenciaRecuperacao.ok) {
          json(
            res,
            403,
            { ok: false, erro: "Terminal TEF não vinculado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const recuperacao = await lerRecuperacao();
        json(
          res,
          200,
          { ok: true, recuperacao },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/tef/menu") {
        json(res, 200, { ok: true, menu: gerenciadorTef.consultarMenuInterativo() }, origemCheck.origem, origens);
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/menu/responder") {
        // O menu jamais confirma uma transacao: apenas escolhe a opcao do provedor.
        let dados;
        try {
          const body = await lerBody(req);
          dados = JSON.parse(body.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload invalido." }, origemCheck.origem, origens);
          return;
        }
        if (!dados || Array.isArray(dados) || typeof dados !== "object" ||
            Object.keys(dados).some((k) => !["id", "solicitacaoId", "indice"].includes(k))) {
          json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
          return;
        }
        const resultado = gerenciadorTef.responderMenuInterativo(dados);
        json(res, resultado.ok ? 200 : 409, resultado, origemCheck.origem, origens);
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/teste") {
        const brutoTef = await lerBody(req);
        let payloadTef;
        try {
          payloadTef = JSON.parse(brutoTef.toString("utf8") || "{}");
        } catch {
          json(
            res,
            400,
            { ok: false, erro: "Payload inválido." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const validacaoTef = validarPayloadHttpTef(payloadTef);
        if (!validacaoTef.ok) {
          json(
            res,
            400,
            { ok: false, erro: validacaoTef.erro },
            origemCheck.origem,
            origens
          );
          return;
        }

        const resultadoTef = await executarTesteTef();
        const httpTef = respostaOperacaoTef(resultadoTef);
        json(res, httpTef.status, httpTef.corpo, origemCheck.origem, origens);
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/homologacao/comprovacao") {
        const brutoProva = await lerBody(req);
        let payloadProva;
        try {
          payloadProva = JSON.parse(brutoProva.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, pagamentoRecebido: false, podeFinalizar: false, nfcEEmitida: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const { readFile, writeFile, mkdir } = await import("node:fs/promises");
        const {
          auditarTiposSdk,
          avaliarCapacidadeComprovacao,
          avaliarComprovacaoFisica,
          coletarRetornosComprovacao,
          persistirEvidenciaComprovacao,
          ARQUIVO_EVIDENCIA_COMPROVACAO,
        } = await import("./tef-comprovacao-fisica.mjs");
        const { bibliotecaResidenteDoConector, completarInstanciaResidente, avaliarJournalMenu, lerEvidenciaSessaoHomologacao } = await import("./tef-menu-conector.mjs");
        if (instanciaPinpadHomologacao) {
          const promovidaProva = completarInstanciaResidente(instanciaPinpadHomologacao);
          if (promovidaProva) instanciaPinpadHomologacao = promovidaProva;
        }
        const raizProva = pastaConectorHomologacao();
        const arquivoProva = path.join(raizProva, ARQUIVO_EVIDENCIA_COMPROVACAO);
        const journalProva = await avaliarJournalMenu([
          path.join(raizProva, "tef-journal-teste-nativo.json"),
          path.join(raizProva, "tef-journal-venda-100.json"),
          path.join(raizProva, "tef-journal-resultado-desconhecido.json"),
        ]);
        let evidenciaExistente = null;
        try {
          evidenciaExistente = JSON.parse(await readFile(arquivoProva, "utf8"));
        } catch (erro) {
          if (erro?.code !== "ENOENT") evidenciaExistente = { encerrado: false, ilegivel: true };
        }
        const evidenciaSessaoProva = lerEvidenciaSessaoHomologacao(payloadProva.empresaId, payloadProva.terminalCodigo);
        const portaOcupadaProva = pinpadEmOperacaoFinanceira(gerenciadorTef) === true || ocupacaoHomologacao() != null;
        let reservaProva = false;
        if (payloadProva.executar === true && !portaOcupadaProva) {
          reservaProva = reservarHomologacao("comprovacao").ok === true;
        }
        const entradaProva = {
          ambiente: payloadProva.ambiente,
          frase: payloadProva.frase,
          empresaId: payloadProva.empresaId,
          terminalCodigo: payloadProva.terminalCodigo,
          dispositivoId: payloadProva.dispositivoId,
          posid: payloadProva.posid,
          valorCentavos: payloadProva.valorCentavos,
          biblioteca: bibliotecaResidenteDoConector(instanciaPinpadHomologacao),
          com7Exclusiva: payloadProva.executar === true ? reservaProva : !portaOcupadaProva,
          portaPinpadOcupada: portaOcupadaProva,
          journal: journalProva,
          evidenciaExistente,
          executar: payloadProva.executar === true,
          simulado: false,
          capturaEmCurso: evidenciaSessaoProva.capturaEmCurso,
          referencias: evidenciaSessaoProva.referencias,
          referenciasOrigem: evidenciaSessaoProva.referenciasOrigem,
        };
        const auditoriaProva = auditarTiposSdk({ kitPresente: false, headerLinux: "" });
        let resultadoProva;
        try {
          resultadoProva = entradaProva.executar
            ? await coletarRetornosComprovacao(entradaProva)
            : avaliarComprovacaoFisica(entradaProva);
        } finally {
          if (reservaProva) liberarHomologacao("comprovacao");
        }
        if (resultadoProva.executado === true) {
          await persistirEvidenciaComprovacao(arquivoProva, {
            ...resultadoProva,
            idempotencyKey: String(payloadProva.idempotencyKey ?? ""),
            encerrado: false,
          }, { readFile, writeFile, mkdir });
        }
        json(
          res,
          resultadoProva.ok === true ? 200 : 409,
          {
            ...resultadoProva,
            auditoria: auditoriaProva,
            capacidade: avaliarCapacidadeComprovacao(resultadoProva),
            pagamentoRecebido: false,
            podeFinalizar: false,
            nfcEEmitida: false,
            flagsAlteradas: false,
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/venda") {
        const brutoVenda = await lerBody(req);
        let payloadVenda;
        try {
          payloadVenda = JSON.parse(brutoVenda.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, pagamentoRecebido: false, comandoDll: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const {
          atenderMenuConector,
          bibliotecaResidenteDoConector,
          completarInstanciaResidente,
          executarTransacaoHomologacao,
          seguirCapturaPinpad,
          sessaoVendaEmMemoria,
          FRASE_MENU_CONECTOR,
          prepararTransporteHomologacao,
          avaliarJournalMenu,
          pontoHomologacaoNoDisco,
          lerChavePublicaHomologacao,
          recuperarSessaoAbertaSemExecucao,
          transacaoLocalAbertaSemExecucao,
        } = await import("./tef-menu-conector.mjs");
        const { verificarDllPgWeb } = await import("./tef-dll.mjs");
        const { diretorioProducaoPgWeb } = await import("./tef-diretorio.mjs");
        const { PGWEB2_PRODUCAO } = await import("./tef-pgweb.mjs");
        const { arquivoEtapaDaVenda, decidirPerfilExecucao, journalsDoPerfil, perfilSessaoAtiva } = await import("./tef-perfil-execucao.mjs");
        const ambienteVenda = payloadVenda.ambiente === "producao" ? "producao" : payloadVenda.ambiente === "homologacao" ? "homologacao" : "";
        if (!ambienteVenda || payloadVenda.frase !== FRASE_MENU_CONECTOR) {
          json(
            res,
            409,
            {
              ok: false,
              pagamentoRecebido: false,
              podeFinalizar: false,
              nfcEEmitida: false,
              comandoDll: false,
              codigo: "perfil",
              mensagem: "A venda precisa do ambiente gravado e da autorização do servidor. Nenhum comando foi enviado.",
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (instanciaPinpadHomologacao) {
          const promovidaVenda = completarInstanciaResidente(instanciaPinpadHomologacao);
          if (promovidaVenda) instanciaPinpadHomologacao = promovidaVenda;
        }
        let bibliotecaVenda = bibliotecaResidenteDoConector(instanciaPinpadHomologacao);
        const vinculoVenda = await lerVinculo();
        const decisaoPerfil = decidirPerfilExecucao({
          ambiente: ambienteVenda,
          vinculoAmbiente: vinculoVenda?.ambiente,
          sessao: perfilSessaoAtiva(bibliotecaVenda),
          producaoHabilitada: PGWEB2_PRODUCAO === true,
        });
        if (!decisaoPerfil.ok) {
          json(
            res,
            409,
            {
              ok: false,
              pagamentoRecebido: false,
              podeFinalizar: false,
              nfcEEmitida: false,
              comandoDll: false,
              novaCobranca: false,
              codigo: decisaoPerfil.codigo,
              mensagem: decisaoPerfil.mensagem,
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (!bibliotecaVenda || perfilSessaoAtiva(bibliotecaVenda) !== decisaoPerfil.ambiente) {
          if (payloadVenda.acao === "responder") {
            json(
              res,
              409,
              {
                ok: false,
                pagamentoRecebido: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                comandoDll: false,
                novaCobranca: false,
                codigo: "sessao",
                mensagem: "A captura desta venda não está mais nesta sessão. Nenhuma nova cobrança foi iniciada.",
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          const diretorioInicial =
            decisaoPerfil.ambiente === "producao"
              ? diretorioProducaoPgWeb()
              : path.join(pastaConectorHomologacao(), "TEF", "Homologacao", "PGWeb");
          const escopoVenda = {
            empresaId: payloadVenda.empresaId,
            terminalCodigo: payloadVenda.terminalCodigo,
            dispositivoId: payloadVenda.dispositivoId,
            ambiente: decisaoPerfil.ambiente,
          };
          const journalInicial = await avaliarJournalMenu(
            journalsDoPerfil(pastaConectorHomologacao(), diretorioInicial, decisaoPerfil.ambiente, escopoVenda),
            undefined,
            escopoVenda
          );
          const { garantirSessaoVenda } = await import("./tef-sessao-venda.mjs");
          const portaInicial = await lerPortaPinpad(arquivoPortaPinpad());
          const garantia = await garantirSessaoVenda(
            {
              ambiente: decisaoPerfil.ambiente,
              empresaId: payloadVenda.empresaId,
              posid: payloadVenda.posid,
              diretorio: diretorioInicial,
              biblioteca: instanciaPinpadHomologacao,
              pontoInstalado: await pontoHomologacaoNoDisco(diretorioInicial),
              portaSalva: portaInicial?.porta ?? null,
              transacaoAtiva:
                pinpadEmOperacaoFinanceira(gerenciadorTef) === true ||
                (await transacaoHomologacaoAtiva({
                  raiz: pastaConectorHomologacao(),
                  gerenciador: gerenciadorTef,
                })),
              pendencia:
                journalInicial.seguir === false && journalInicial.recuperavel !== true ? journalInicial : null,
              ocupacao: ocupacaoHomologacao(),
            },
            {
              arquivoDll: path.join(resolverRaizAgente(), "bin", "tef", "PGWebLib.dll"),
              abrir: abrirDiagnosticoNativo,
              persistirPorta: (entrada) => gravarPortaPinpad(arquivoPortaPinpad(), entrada),
              promover(biblioteca, diretorio) {
                biblioteca.arquitetura = "x64";
                biblioteca.diretorio = diretorio;
                const promovida = completarInstanciaResidente(biblioteca);
                if (promovida) instanciaPinpadHomologacao = promovida;
                return promovida;
              },
            }
          );
          if (garantia.ok !== true || !garantia.biblioteca) {
            json(
              res,
              409,
              {
                ok: false,
                pagamentoRecebido: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                comandoDll: false,
                novaCobranca: false,
                codigo: garantia.codigo,
                mensagem: garantia.mensagem,
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          instanciaPinpadHomologacao = garantia.biblioteca;
          bibliotecaVenda = bibliotecaResidenteDoConector(instanciaPinpadHomologacao);
          if (!bibliotecaVenda) {
            json(
              res,
              409,
              {
                ok: false,
                pagamentoRecebido: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                comandoDll: false,
                novaCobranca: false,
                codigo: "sessao",
                mensagem: "A PGWebLib iniciou, mas a sessão da venda não ficou disponível. Nenhuma cobrança foi iniciada.",
              },
              origemCheck.origem,
              origens
            );
            return;
          }
        }
        if (payloadVenda.acao === "responder") {
          const raizResposta = pastaConectorHomologacao();
          const diretorioResposta =
            ambienteVenda === "producao"
              ? diretorioProducaoPgWeb()
              : path.join(raizResposta, "TEF", "Homologacao", "PGWeb");
          const arquivoResposta = arquivoEtapaDaVenda(
            ambienteVenda === "producao" ? diretorioResposta : raizResposta,
            {
              empresaId: payloadVenda.empresaId,
              terminalCodigo: payloadVenda.terminalCodigo,
              dispositivoId: payloadVenda.dispositivoId,
              ambiente: decisaoPerfil.ambiente,
            }
          );
          const capturaId = Number(payloadVenda.capturaId);
          const valorResposta = String(payloadVenda.valor ?? "").trim();
          if (!Number.isInteger(capturaId) || capturaId < 0 || !valorResposta || "indice" in payloadVenda) {
            json(
              res,
              400,
              {
                ok: false,
                pagamentoRecebido: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                comandoDll: false,
                novaCobranca: false,
                mensagem: "A resposta precisa ser um vszValorMenu devolvido pela biblioteca. Nenhuma nova cobrança foi iniciada.",
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          const continuacao = await atenderMenuConector({
            ambiente: ambienteVenda,
            acao: "responder",
            empresaId: payloadVenda.empresaId,
            terminalCodigo: payloadVenda.terminalCodigo,
            frase: payloadVenda.frase,
            capturaId,
            valor: valorResposta,
            journal: { seguir: true, codigo: "journal" },
            transporte: bibliotecaVenda,
            sessaoResidenteAutorizada: true,
            arquivoEtapa: arquivoResposta,
            dispositivoId: payloadVenda.dispositivoId,
          });
          const pinpadContinuacao = await seguirCapturaPinpad(payloadVenda.empresaId, payloadVenda.terminalCodigo);
          const resultadoContinuacao = pinpadContinuacao ? { ...continuacao, ...pinpadContinuacao } : continuacao;
          json(
            res,
            resultadoContinuacao.ok === true ? 200 : 409,
            {
              ...resultadoContinuacao,
              comandoDll: continuacao.comandoDll === true || Number(continuacao.novas) === 1 || resultadoContinuacao.comandoDll === true,
              pagamentoRecebido: resultadoContinuacao.pagamentoRecebido === true,
              podeFinalizar: resultadoContinuacao.pagamentoRecebido === true && ambienteVenda === "producao",
              nfcEEmitida: false,
              novaCobranca: false,
              journalApagado: false,
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        const memoriaVenda = sessaoVendaEmMemoria(payloadVenda.empresaId, payloadVenda.terminalCodigo);
        if (memoriaVenda.ativa) {
          if (memoriaVenda.pinpad) {
            const pinpadMemoria = await seguirCapturaPinpad(payloadVenda.empresaId, payloadVenda.terminalCodigo);
            json(
              res,
              pinpadMemoria?.ok === true ? 200 : 409,
              {
                ...pinpadMemoria,
                novaCobranca: false,
                journalApagado: false,
                pagamentoRecebido: pinpadMemoria?.pagamentoRecebido === true,
                podeFinalizar: pinpadMemoria?.pagamentoRecebido === true && ambienteVenda === "producao",
                nfcEEmitida: false,
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          json(
            res,
            409,
            {
              ok: false,
              codigo: "ocupada",
              pagamentoRecebido: false,
              podeFinalizar: false,
              nfcEEmitida: false,
              comandoDll: false,
              novaCobranca: false,
              journalApagado: false,
              mensagem: "Há captura em andamento nesta sessão. Nenhuma nova cobrança foi iniciada.",
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        const raizVenda = pastaConectorHomologacao();
        const diretorioVenda =
          ambienteVenda === "producao"
            ? diretorioProducaoPgWeb()
            : path.join(raizVenda, "TEF", "Homologacao", "PGWeb");
        const escopoVenda = {
          empresaId: payloadVenda.empresaId,
          terminalCodigo: payloadVenda.terminalCodigo,
          dispositivoId: payloadVenda.dispositivoId,
          ambiente: decisaoPerfil.ambiente,
        };
        const arquivoEtapaVenda = arquivoEtapaDaVenda(
          decisaoPerfil.ambiente === "producao" ? diretorioVenda : raizVenda,
          escopoVenda
        );
        let journalVenda = await avaliarJournalMenu(
          journalsDoPerfil(raizVenda, diretorioVenda, decisaoPerfil.ambiente, escopoVenda),
          undefined,
          escopoVenda
        );
        const sessaoLocalVenda = transacaoLocalAbertaSemExecucao(payloadVenda.empresaId, payloadVenda.terminalCodigo);
        const pendenciaRecuperavel =
          journalVenda.codigo === "sessao_aberta" ||
          journalVenda.codigo === "reconciliacao" ||
          sessaoLocalVenda === true;
        if (pendenciaRecuperavel) {
          if (journalVenda.codigo === "sessao_aberta" && journalVenda.recuperavel !== true) {
            json(
              res,
              409,
              {
                ok: false,
                codigo: "ocupada",
                pagamentoRecebido: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                comandoDll: false,
                novaCobranca: false,
                journalApagado: false,
                mensagem: "Há captura em andamento nesta sessão. Nenhuma nova cobrança foi iniciada.",
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          const recuperacaoVenda = await recuperarSessaoAbertaSemExecucao({
            journal: journalVenda.journalAberto ?? { retornoNewTransac: 0, executada: false },
            transporte: bibliotecaVenda,
            transacaoLocalAberta: sessaoLocalVenda,
            arquivo: journalVenda.arquivo || arquivoEtapaVenda,
            empresaId: payloadVenda.empresaId,
            terminalCodigo: payloadVenda.terminalCodigo,
          });
          if (recuperacaoVenda.ok !== true) {
            json(
              res,
              409,
              {
                ...recuperacaoVenda,
                pagamentoRecebido: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                comandoDll: false,
                novaCobranca: false,
                journalApagado: false,
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          journalVenda = { seguir: true, codigo: "journal", mensagem: "" };
        }
        const dllVenda = await verificarDllPgWeb(path.join(resolverRaizAgente(), "bin", "tef"));
        const pedidoVenda = {
          ambiente: ambienteVenda,
          empresaId: payloadVenda.empresaId,
          dispositivoId: payloadVenda.dispositivoId,
          terminalCodigo: payloadVenda.terminalCodigo,
          posid: payloadVenda.posid,
          valorCentavos: payloadVenda.valorCentavos,
          idempotencyKey: payloadVenda.idempotencyKey,
          expiraEm: payloadVenda.expiraEm,
        };
        const entradaVenda = {
          journal: journalVenda,
          pontoInstalado: await pontoHomologacaoNoDisco(diretorioVenda),
          dllOk: dllVenda.ok === true,
          biblioteca: instanciaPinpadHomologacao,
          arquivoEtapa: arquivoEtapaVenda,
        };
        const preparoVenda = prepararTransporteHomologacao({
          pedido: pedidoVenda,
          assinatura: payloadVenda.assinatura,
          chavePublicaPem: await lerChavePublicaHomologacao(),
          entrada: entradaVenda,
        });
        if (preparoVenda.ok !== true) {
          json(res, 409, { ...preparoVenda, comandoDll: false, pagamentoRecebido: false, podeFinalizar: false, nfcEEmitida: false }, origemCheck.origem, origens);
          return;
        }
        const execucaoVenda = await executarTransacaoHomologacao({
          pedido: pedidoVenda,
          assinatura: payloadVenda.assinatura,
          chavePublicaPem: await lerChavePublicaHomologacao(),
          frase: payloadVenda.frase,
          entrada: entradaVenda,
        });
        const pinpadVenda = await seguirCapturaPinpad(pedidoVenda.empresaId, pedidoVenda.terminalCodigo);
        const resultadoVenda = pinpadVenda ? { ...execucaoVenda, ...pinpadVenda } : execucaoVenda;
        json(
          res,
          resultadoVenda.ok === true ? 200 : 409,
          {
            ...resultadoVenda,
            comandoDll: execucaoVenda.comandoDll === true || execucaoVenda.transacaoIniciada === true || resultadoVenda.comandoDll === true,
            pagamentoRecebido: resultadoVenda.pagamentoRecebido === true,
            podeFinalizar: resultadoVenda.pagamentoRecebido === true && ambienteVenda === "producao",
            nfcEEmitida: false,
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/homologacao/menu") {
        const brutoMenu = await lerBody(req);
        let payloadMenu;
        try {
          payloadMenu = JSON.parse(brutoMenu.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const chavesMenu = Object.keys(payloadMenu ?? {});
        const permitidasMenu = new Set([
          "acao",
          "empresaId",
          "terminalCodigo",
          "frase",
          "capturaId",
          "valor",
          "idempotencyKey",
          "valorCentavos",
          "dispositivoId",
          "posid",
          "expiraEm",
          "assinatura",
        ]);
        if (chavesMenu.some((chave) => !permitidasMenu.has(chave)) || payloadMenu?.execucaoFisica === true) {
          json(
            res,
            400,
            { ok: false, pagamentoRecebido: false, podeFinalizar: false, erro: "Payload recusado. Nenhum comando foi enviado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const {
          atenderMenuConector,
          avaliarJournalMenu,
          bibliotecaResidenteDoConector,
          completarInstanciaResidente,
          exclusivaCom7,
          lerChavePublicaHomologacao,
          liberarReservaSemSessao,
          pontoHomologacaoNoDisco,
          acompanharCapturaPinpad,
          executarTransacaoHomologacao,
          FRASE_MENU_CONECTOR,
          prepararTransporteHomologacao,
          resolverTransporteMenu,
        } = await import("./tef-menu-conector.mjs");
        const { verificarDllPgWeb } = await import("./tef-dll.mjs");
        const raizMenu = pastaConectorHomologacao();
        const arquivoResultadoDesconhecido = path.join(raizMenu, "tef-journal-resultado-desconhecido.json");
        const journalMenu = await avaliarJournalMenu([
          path.join(raizMenu, "tef-journal-teste-nativo.json"),
          path.join(raizMenu, "tef-journal-venda-100.json"),
          arquivoResultadoDesconhecido,
        ]);
        if (instanciaPinpadHomologacao) {
          const promovidaMenu = completarInstanciaResidente(instanciaPinpadHomologacao);
          if (promovidaMenu) instanciaPinpadHomologacao = promovidaMenu;
        }
        const bibliotecaMenu = bibliotecaResidenteDoConector(instanciaPinpadHomologacao);
        const dllMenu = await verificarDllPgWeb(path.join(resolverRaizAgente(), "bin", "tef"));
        const entradaMenu = {
          ambiente: "homologacao",
          servidor: "homologacao",
          journal: journalMenu,
          pontoInstalado: await pontoHomologacaoNoDisco(path.join(raizMenu, "TEF", "Homologacao", "PGWeb")),
          dllOk: dllMenu.ok === true,
          com7Exclusiva: exclusivaCom7(payloadMenu.empresaId, payloadMenu.terminalCodigo),
          portaPinpadOcupada: pinpadEmOperacaoFinanceira(gerenciadorTef) === true,
          sessaoNativaDisponivel: bibliotecaMenu != null,
          biblioteca: bibliotecaMenu,
          autorizacaoOperacao: null,
        };
        if (payloadMenu.acao === "iniciar") {
          const preparo = prepararTransporteHomologacao({
            pedido: {
              ambiente: "homologacao",
              empresaId: payloadMenu.empresaId,
              dispositivoId: payloadMenu.dispositivoId,
              terminalCodigo: payloadMenu.terminalCodigo,
              posid: payloadMenu.posid,
              valorCentavos: payloadMenu.valorCentavos,
              idempotencyKey: payloadMenu.idempotencyKey,
              expiraEm: payloadMenu.expiraEm,
            },
            assinatura: payloadMenu.assinatura,
            chavePublicaPem: await lerChavePublicaHomologacao(),
            entrada: {
              journal: journalMenu,
              pontoInstalado: entradaMenu.pontoInstalado,
              dllOk: entradaMenu.dllOk,
              biblioteca: instanciaPinpadHomologacao,
            },
          });
          json(
            res,
            preparo.ok === true ? 200 : 409,
            {
              ...preparo,
              transacaoIniciada: false,
              execucaoFisica: false,
              comandoDll: false,
              pagamentoRecebido: false,
              podeFinalizar: false,
              nfcEEmitida: false,
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (payloadMenu.acao === "executar" || payloadMenu.acao === "confirmar" || payloadMenu.acao === "desfazer") {
          if (payloadMenu.frase !== FRASE_MENU_CONECTOR) {
            json(
              res,
              409,
              {
                ok: false,
                pagamentoRecebido: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                execucaoFisica: false,
                comandoDll: false,
                mensagem: "O teste financeiro de homologação não foi autorizado. Nenhum comando foi enviado.",
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          if (payloadMenu.acao === "confirmar" || payloadMenu.acao === "desfazer") {
            const { decidirNaSessaoResidente } = await import("./tef-menu-conector.mjs");
            const decisaoMenu = await decidirNaSessaoResidente(
              payloadMenu.empresaId,
              payloadMenu.terminalCodigo,
              payloadMenu.acao
            );
            json(
              res,
              decisaoMenu.ok === true ? 200 : 409,
              {
                ...decisaoMenu,
                execucaoFisica: false,
                podeFinalizar: false,
                nfcEEmitida: false,
                journalApagado: false,
              },
              origemCheck.origem,
              origens
            );
            return;
          }
          const execucaoMenu = await executarTransacaoHomologacao({
            pedido: {
              ambiente: "homologacao",
              empresaId: payloadMenu.empresaId,
              dispositivoId: payloadMenu.dispositivoId,
              terminalCodigo: payloadMenu.terminalCodigo,
              posid: payloadMenu.posid,
              valorCentavos: payloadMenu.valorCentavos,
              idempotencyKey: payloadMenu.idempotencyKey,
              expiraEm: payloadMenu.expiraEm,
            },
            assinatura: payloadMenu.assinatura,
            chavePublicaPem: await lerChavePublicaHomologacao(),
            frase: payloadMenu.frase,
            entrada: {
              journal: journalMenu,
              pontoInstalado: entradaMenu.pontoInstalado,
              dllOk: entradaMenu.dllOk,
              biblioteca: instanciaPinpadHomologacao,
              portaPinpadOcupada: entradaMenu.portaPinpadOcupada,
              arquivoJournal: arquivoResultadoDesconhecido,
            },
          });
          json(
            res,
            execucaoMenu.ok === true ? 200 : 409,
            {
              ...execucaoMenu,
              execucaoFisica: false,
              podeFinalizar: false,
              nfcEEmitida: false,
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (payloadMenu.acao === "acompanhar") {
          const acompanhamento = await acompanharCapturaPinpad(payloadMenu.empresaId, payloadMenu.terminalCodigo);
          json(
            res,
            acompanhamento.ok === true ? 200 : 409,
            {
              ...acompanhamento,
              pagamentoRecebido: false,
              podeFinalizar: false,
              nfcEEmitida: false,
              execucaoFisica: false,
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        const escolhaMenu = resolverTransporteMenu(entradaMenu);
        let resultadoMenu;
        try {
        resultadoMenu = await atenderMenuConector({
          ambiente: "homologacao",
          acao: payloadMenu.acao,
          empresaId: payloadMenu.empresaId,
          terminalCodigo: payloadMenu.terminalCodigo,
          frase: payloadMenu.frase,
          capturaId: payloadMenu.capturaId,
          valor: payloadMenu.valor,
          journal: journalMenu,
          simulacao: escolhaMenu.simulacao,
          transporte: escolhaMenu.transporte,
          ensaioNativo: false,
          sessaoResidenteAutorizada: escolhaMenu.nativo === true,
          portaPinpadOcupada: entradaMenu.portaPinpadOcupada,
          arquivoJournal: arquivoResultadoDesconhecido,
          idempotencyKey: payloadMenu.idempotencyKey,
          valorCentavos: payloadMenu.valorCentavos,
        });
        } finally {
          liberarReservaSemSessao();
        }
        resultadoMenu.journalCodigo = journalMenu.codigo;
        resultadoMenu.comandoDll = false;
        resultadoMenu.execucaoFisica = false;
        resultadoMenu.nativo = escolhaMenu.nativo === true && resultadoMenu.nativo === true;
        resultadoMenu.pagamentoRecebido = false;
        resultadoMenu.motivoFisico = escolhaMenu.motivo;
        resultadoMenu.ligacaoResidente = escolhaMenu.nativo === true;
        json(res, resultadoMenu.ok === true ? 200 : 409, resultadoMenu, origemCheck.origem, origens);
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/homologacao/pinpad") {
        const brutoHomologacao = await lerBody(req);
        let payloadHomologacao;
        try {
          payloadHomologacao = JSON.parse(brutoHomologacao.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const acaoHomologacao = payloadHomologacao?.acao;
        const chavesHomologacao = Object.keys(payloadHomologacao ?? {});
        if (
          (acaoHomologacao !== "identificar" && acaoHomologacao !== "testar") ||
          chavesHomologacao.some((chave) => chave !== "acao")
        ) {
          json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
          return;
        }
        const resultadoHomologacao = await executarDiagnosticoHomologacaoTef({
          acao: acaoHomologacao,
        });
        json(
          res,
          resultadoHomologacao.ok === true ? 200 : 409,
          resultadoHomologacao,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/pinpad/comunicacao") {
        const brutoComunicacao = await lerBody(req);
        let payloadComunicacao;
        try {
          payloadComunicacao = JSON.parse(brutoComunicacao.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const acaoComunicacao = payloadComunicacao?.acao;
        const chavesComunicacao = Object.keys(payloadComunicacao ?? {});
        if (
          payloadComunicacao?.ambiente !== "producao" ||
          (acaoComunicacao !== "identificar" && acaoComunicacao !== "testar") ||
          chavesComunicacao.some((chave) => chave !== "acao" && chave !== "ambiente")
        ) {
          json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
          return;
        }
        const resultadoComunicacao = await executarDiagnosticoHomologacaoTef(
          { acao: acaoComunicacao },
          { ambiente: "producao" }
        );
        json(
          res,
          resultadoComunicacao.ok === true ? 200 : 409,
          resultadoComunicacao,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (
        (req.method === "GET" && url.pathname === "/tef/pinpad/diagnostico") ||
        (req.method === "POST" && url.pathname === "/tef/pinpad/testar-comunicacao")
      ) {
        const testarComunicacao = req.method === "POST";
        if (testarComunicacao) {
          const brutoPinpad = await lerBody(req);
          let payloadPinpad;
          try {
            payloadPinpad = JSON.parse(brutoPinpad.toString("utf8") || "{}");
          } catch {
            json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
            return;
          }
          const validacaoPinpad = validarPayloadHttpTef(
            payloadPinpad,
            "pinpad-testar-comunicacao"
          );
          if (!validacaoPinpad.ok) {
            json(res, 400, { ok: false, erro: validacaoPinpad.erro }, origemCheck.origem, origens);
            return;
          }
          if (
            Object.keys(payloadPinpad).some(
              (chave) => chave !== "acao"
            )
          ) {
            json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
            return;
          }
        }
        const bloqueioPinpad = await contextoFinanceiroTef(req);
        if (!bloqueioPinpad.ok) {
          json(res, 403, { ok: false, erro: bloqueioPinpad.erro }, origemCheck.origem, origens);
          return;
        }
        const resultadoPinpad = await diagnosticarPinpadTef(testarComunicacao);
        const httpPinpad = respostaOperacaoTef(resultadoPinpad);
        json(res, httpPinpad.status, httpPinpad.corpo, origemCheck.origem, origens);
        return;
      }

      if (
        (req.method === "GET" && url.pathname === "/tef/homologacao/identidade") ||
        (req.method === "POST" && url.pathname === "/tef/homologacao/identidade/apresentar")
      ) {
        const { apresentarIdentidadeHomologacao, emitirIdentidadeHomologacao } = await import(
          "./tef-identidade-homologacao.mjs"
        );
        if (req.method === "GET") {
          const emitida = await emitirIdentidadeHomologacao();
          json(res, emitida.ok ? 200 : 409, emitida, origemCheck.origem, origens);
          return;
        }
        const brutoIdentidade = await lerBody(req);
        let payloadIdentidade;
        try {
          payloadIdentidade = JSON.parse(brutoIdentidade.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const chavesIdentidade = Object.keys(payloadIdentidade ?? {});
        if (chavesIdentidade.some((chave) => chave !== "codigo" && chave !== "dispositivoId")) {
          json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
          return;
        }
        const apresentada = await apresentarIdentidadeHomologacao(payloadIdentidade);
        json(res, apresentada.ok ? 200 : 409, apresentada, origemCheck.origem, origens);
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/homologacao/instalacao") {
        const brutoInstalacao = await lerBody(req);
        let payloadInstalacao;
        try {
          payloadInstalacao = JSON.parse(brutoInstalacao.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const acaoInstalacao = payloadInstalacao?.acao;
        const chavesInstalacao = Object.keys(payloadInstalacao ?? {});
        const permitidas = new Set([
          "acao",
          "confirmacao",
          "ponto",
          "servidor",
          "cnpj",
          "respostas",
          "execucaoId",
          "empresaId",
          "dispositivoId",
          "terminalId",
          "estabelecimento",
        ]);
        const acoesInstalacao = ["resumo", "executar", "responder", "confirmar", "desfazer", "assinar", "consultar"];
        if (
          !acoesInstalacao.includes(acaoInstalacao) ||
          chavesInstalacao.some((chave) => !permitidas.has(chave))
        ) {
          json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
          return;
        }
        const diretorioDllInstalacao = path.join(resolverRaizAgente(), "bin", "tef");
        const resultadoInstalacaoIsolada = await executarInstalacaoIsolada(payloadInstalacao, {
          raiz: pastaConectorHomologacao(),
          pinpadOcupado: pinpadEmOperacaoFinanceira(gerenciadorTef),
          gerenciador: gerenciadorTef,
          verificarDll: async () => ({
            ...(await verificarDllPgWeb(diretorioDllInstalacao)),
            arquivo: path.join(diretorioDllInstalacao, "PGWebLib.dll"),
          }),
          abrir: abrirInstalacaoNativa,
          lerChave: async () => {
            try {
              const { arquivoChaveHomologacao } = await import("./tef-identidade-homologacao.mjs");
              const arquivo = arquivoChaveHomologacao();
              if (!arquivo) return null;
              const fsChave = await import("node:fs/promises");
              const bruto = JSON.parse(await fsChave.readFile(arquivo, "utf8"));
              if (!bruto?.publica || !bruto?.privada) return null;
              return { id: bruto.id, publica: bruto.publica, privada: bruto.privada };
            } catch {
              return null;
            }
          },
        });
        json(
          res,
          resultadoInstalacaoIsolada.ok === true ? 200 : 409,
          resultadoInstalacaoIsolada,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/producao/instalacao") {
        const brutoInstalacaoProducao = await lerBody(req);
        let payloadInstalacaoProducao;
        try {
          payloadInstalacaoProducao = JSON.parse(brutoInstalacaoProducao.toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const acaoInstalacaoProducao = payloadInstalacaoProducao?.acao;
        const chavesInstalacaoProducao = Object.keys(payloadInstalacaoProducao ?? {});
        const permitidasProducao = new Set([
          "acao",
          "confirmacao",
          "ponto",
          "servidor",
          "cnpj",
          "respostas",
          "execucaoId",
          "empresaId",
          "dispositivoId",
          "terminalId",
          "estabelecimento",
          "reinstalar",
        ]);
        const acoesInstalacaoProducao = ["resumo", "executar", "responder", "confirmar", "desfazer", "consultar", "precondicoes"];
        if (
          !acoesInstalacaoProducao.includes(acaoInstalacaoProducao) ||
          chavesInstalacaoProducao.some((chave) => !permitidasProducao.has(chave))
        ) {
          json(res, 400, { ok: false, erro: "Payload recusado." }, origemCheck.origem, origens);
          return;
        }
        const { diretorioProducaoPgWeb } = await import("./tef-diretorio.mjs");
        const diretorioDllProducao = path.join(resolverRaizAgente(), "bin", "tef");
        const resultadoInstalacaoProducao = await executarInstalacaoIsolada(payloadInstalacaoProducao, {
          ambiente: "producao",
          diretorio: diretorioProducaoPgWeb(),
          pinpadOcupado: pinpadEmOperacaoFinanceira(gerenciadorTef),
          gerenciador: gerenciadorTef,
          verificarDll: async () => ({
            ...(await verificarDllPgWeb(diretorioDllProducao)),
            arquivo: path.join(diretorioDllProducao, "PGWebLib.dll"),
          }),
          abrir: abrirInstalacaoNativa,
          porta: portaReq,
          ouvintes: 1,
          encerrarResidente: async () => {
            if (typeof instanciaPinpadHomologacao?.end === "function") {
              await instanciaPinpadHomologacao.end();
            }
            instanciaPinpadHomologacao = null;
          },
        });
        json(
          res,
          resultadoInstalacaoProducao.ok === true ? 200 : 409,
          resultadoInstalacaoProducao,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/inicializar") {
        const brutoInicio = await lerBody(req);
        let payloadInicio;
        try {
          payloadInicio = JSON.parse(brutoInicio.toString("utf8") || "{}");
        } catch {
          json(
            res,
            400,
            { ok: false, erro: "Payload inválido." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const validacaoInicio = validarPayloadHttpTef(payloadInicio, "inicializar");
        if (!validacaoInicio.ok) {
          json(
            res,
            400,
            { ok: false, erro: validacaoInicio.erro },
            origemCheck.origem,
            origens
          );
          return;
        }

        json(
          res,
          409,
          {
            ok: false,
            pagamentoRecebido: false,
            podeFinalizar: false,
            nfcEEmitida: false,
            comandoDll: false,
            codigo: "nativo",
            mensagem: "A inicialização TEF usa a sessão residente da PGWebLib. O agente Pascal não foi chamado.",
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/instalar") {
        const brutoInstalacao = await lerBody(req);
        let payloadInstalacao;
        try {
          payloadInstalacao = JSON.parse(brutoInstalacao.toString("utf8") || "{}");
        } catch {
          json(
            res,
            400,
            { ok: false, erro: "Payload inválido." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const validacaoInstalacao = validarPayloadHttpTef(payloadInstalacao, "instalar");
        if (!validacaoInstalacao.ok) {
          json(
            res,
            400,
            { ok: false, erro: validacaoInstalacao.erro },
            origemCheck.origem,
            origens
          );
          return;
        }
        const pedidoInstalacao = pedidoHttpInstalacao(payloadInstalacao);
        if (!pedidoInstalacao.ok) {
          json(
            res,
            400,
            {
              ok: false,
              erro: pedidoInstalacao.erro,
              codigo: pedidoInstalacao.codigo,
              evidencia: null,
            },
            origemCheck.origem,
            origens
          );
          return;
        }

        json(
          res,
          409,
          {
            ok: false,
            pagamentoRecebido: false,
            podeFinalizar: false,
            nfcEEmitida: false,
            comandoDll: false,
            evidencia: null,
            codigo: "nativo",
            mensagem: "A instalação do ponto usa PWOPER_INSTALL na PGWebLib, com autorização explícita. O agente Pascal não foi chamado.",
          },
          origemCheck.origem,
          origens
        );
        return;
        const resultadoInstalacao = await executarInstalacaoTef(pedidoInstalacao.credencial, {
          provisionarNovo: pedidoInstalacao.provisionarNovo === true,
        });
        const httpInstalacao = respostaOperacaoTef(resultadoInstalacao);
        json(
          res,
          httpInstalacao.status,
          httpInstalacao.corpo,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/pagamento") {
        const brutoPagamento = await lerBody(req);
        let payloadPagamento;
        try {
          payloadPagamento = JSON.parse(brutoPagamento.toString("utf8") || "{}");
        } catch {
          json(
            res,
            400,
            { ok: false, erro: "Payload inválido." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const validacaoPagamento = validarPayloadHttpTef(payloadPagamento, "pagamento");
        if (!validacaoPagamento.ok) {
          json(
            res,
            400,
            { ok: false, erro: validacaoPagamento.erro },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (
          Object.keys(payloadPagamento).some(
            (chave) =>
              chave !== "acao" &&
              chave !== "identificador" &&
              chave !== "valor" &&
              chave !== "preferencia"
          )
        ) {
          json(
            res,
            400,
            { ok: false, erro: "Payload recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (!String(payloadPagamento.identificador ?? "").trim() || !(Number(payloadPagamento.valor) > 0)) {
          json(
            res,
            400,
            { ok: false, codigo: "TEF_DADOS_INVALIDOS", erro: "Dados do pagamento inválidos." },
            origemCheck.origem,
            origens
          );
          return;
        }

        const bloqueioVinculoPagamento = await contextoFinanceiroTef(req);
        if (!bloqueioVinculoPagamento.ok) {
          json(
            res,
            403,
            { ok: false, erro: bloqueioVinculoPagamento.erro },
            origemCheck.origem,
            origens
          );
          return;
        }

        const recuperacaoPendente = await lerRecuperacao();
        const bloqueioRecuperacao = cobrancaBloqueadaPorRecuperacao(
          recuperacaoPendente,
          payloadPagamento.identificador
        );
        if (bloqueioRecuperacao?.acao === "bloquear") {
          json(
            res,
            409,
            {
              ok: false,
              codigo: "TEF_TRANSACAO_PENDENTE",
              erro: "Existe autorização TEF pendente neste terminal. Nenhuma nova cobrança foi iniciada.",
            },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (bloqueioRecuperacao?.acao === "reapresentar") {
          const guardada = bloqueioRecuperacao.registro;
          json(
            res,
            200,
            {
              ok: true,
              recuperada: true,
              codigo: guardada.codigo || "",
              prova: guardada.prova,
              provaAmbiente: guardada.provaAmbiente || "",
              provaModalidade: guardada.provaModalidade || "",
              resultado: {
                sucessoTransacao: true,
                identificador: guardada.identificador,
                nsu: guardada.nsu,
                codigoAutorizacao: guardada.autorizacao,
                autorizacao: guardada.autorizacao,
                rede: guardada.rede,
                codigoFinalizacao: guardada.finalizacao,
                finalizacao: guardada.finalizacao,
                valor: guardada.valor,
                confirmar: guardada.confirmar === true,
                precisaConfirmacao: guardada.precisaConfirmacao === true,
                transacaoPendenteConfirmacao: guardada.transacaoPendenteConfirmacao === true,
                cancelada: false,
                codigo: guardada.codigo || "",
                bandeira: guardada.bandeira,
                nomeBandeiraPadrao: guardada.nomeBandeiraPadrao,
                cnpjCredenciadora: guardada.cnpjCredenciadora,
                cnpjRecebedor: guardada.cnpjRecebedor,
                instituicao: guardada.instituicao,
                host: guardada.host,
                pontoCaptura: guardada.pontoCaptura,
                comprovante1Via: guardada.comprovante1Via,
                comprovante2Via: guardada.comprovante2Via,
                ...(guardada.tipoCartaoInformado === true ? { tipoCartao: guardada.tipoCartao } : {}),
              },
            },
            origemCheck.origem,
            origens
          );
          return;
        }

        json(
          res,
          409,
          {
            ok: false,
            pagamentoRecebido: false,
            podeFinalizar: false,
            nfcEEmitida: false,
            comandoDll: false,
            codigo: "nativo",
            mensagem: "O pagamento TEF usa a PGWebLib em /tef/venda. O agente Pascal não foi chamado.",
          },
          origemCheck.origem,
          origens
        );
        return;
        const resultadoPagamento = await executarPagamentoTef({
          identificador: payloadPagamento.identificador,
          valor: payloadPagamento.valor,
          ...(payloadPagamento.preferencia == null || payloadPagamento.preferencia === ""
            ? {}
            : { preferencia: payloadPagamento.preferencia }),
        });
        const httpPagamento = respostaOperacaoTef(resultadoPagamento);
        const resultadoBruto = httpPagamento.corpo.resultado ?? {};
        const valorResultado = Number(resultadoBruto.valor);
        const fiscalPagamento = dadosFiscaisProvaTef(resultadoBruto);
        const valorCentavosPagamento = Number.isFinite(valorResultado)
          ? Math.round(valorResultado * 100)
          : Math.round(Number(payloadPagamento.valor) * 100);
        const camposFinanceirosPagamento = {
          desafio: bloqueioVinculoPagamento.desafio,
          identificador: payloadPagamento.identificador,
          valorCentavos: valorCentavosPagamento,
          nsu: resultadoBruto.nsu,
          autorizacao: resultadoBruto.codigoAutorizacao || resultadoBruto.autorizacao,
          rede: resultadoBruto.rede,
          finalizacao: resultadoBruto.codigoFinalizacao || resultadoBruto.finalizacao,
        };
        const comprovantePagamento = juntarComprovanteTef(
          resultadoBruto.comprovante1Via,
          resultadoBruto.comprovante2Via
        );
        httpPagamento.corpo = await anexarProvaTef(httpPagamento.corpo, {
          acao: "pagamento",
          ...camposFinanceirosPagamento,
          sucesso: resultadoBruto.sucessoTransacao === true,
          codigo: httpPagamento.corpo.codigo || "",
          ...fiscalPagamento,
          ambiente: {
            ...camposFinanceirosPagamento,
            pontoCaptura: String(resultadoBruto.pontoCaptura ?? ""),
            host: String(resultadoBruto.host || resultadoBruto.servidor || ""),
            comprovanteSha256: hashComprovanteTef(comprovantePagamento),
          },
          ...(Object.prototype.hasOwnProperty.call(resultadoBruto, "tipoCartao")
            ? {
                modalidade: {
                  ...camposFinanceirosPagamento,
                  tipoCartao:
                    Number.isInteger(resultadoBruto.tipoCartao) &&
                    resultadoBruto.tipoCartao >= 0 &&
                    resultadoBruto.tipoCartao <= 255
                      ? resultadoBruto.tipoCartao
                      : null,
                },
              }
            : {}),
        });
        if (httpPagamento.corpo.prova) {
          const tipoInformado = Object.prototype.hasOwnProperty.call(resultadoBruto, "tipoCartao");
          const tipoOficial =
            Number.isInteger(resultadoBruto.tipoCartao) &&
            resultadoBruto.tipoCartao >= 0 &&
            resultadoBruto.tipoCartao <= 255
              ? resultadoBruto.tipoCartao
              : null;
          const recuperacao = registroRecuperacaoTef({
            identificador: payloadPagamento.identificador,
            prova: httpPagamento.corpo.prova,
            nsu: resultadoBruto.nsu,
            autorizacao: resultadoBruto.codigoAutorizacao || resultadoBruto.autorizacao,
            rede: resultadoBruto.rede,
            finalizacao: resultadoBruto.codigoFinalizacao || resultadoBruto.finalizacao,
            valor: Number.isFinite(valorResultado) ? valorResultado : Number(payloadPagamento.valor),
            sucessoTransacao: resultadoBruto.sucessoTransacao === true,
            codigo: httpPagamento.corpo.codigo || "",
            bandeira: fiscalPagamento.bandeira,
            cnpjCredenciadora: fiscalPagamento.cnpjCredenciadora,
            cnpjRecebedor: fiscalPagamento.cnpjRecebedor,
            instituicao: fiscalPagamento.instituicao,
            confirmar: resultadoBruto.confirmar === true,
            precisaConfirmacao: resultadoBruto.precisaConfirmacao === true,
            transacaoPendenteConfirmacao: resultadoBruto.transacaoPendenteConfirmacao === true,
            cancelada: resultadoBruto.cancelada === true,
            ...(tipoInformado ? { tipoCartao: tipoOficial } : {}),
            modalidadeSolicitada: payloadPagamento.preferencia,
            modalidadeEfetiva: tipoOficial === 1 ? "credito" : tipoOficial === 2 ? "debito" : "",
            provaModalidade: httpPagamento.corpo.provaModalidade,
            provaAmbiente: httpPagamento.corpo.provaAmbiente,
            host: String(resultadoBruto.host || resultadoBruto.servidor || ""),
            pontoCaptura: String(resultadoBruto.pontoCaptura ?? ""),
            comprovanteSha256: hashComprovanteTef(comprovantePagamento),
            comprovante1Via: resultadoBruto.comprovante1Via,
            comprovante2Via: resultadoBruto.comprovante2Via,
          });
          if (recuperacao) {
            await gravarRecuperacao(recuperacao).catch(() => {});
          }
        }
        json(
          res,
          httpPagamento.status,
          httpPagamento.corpo,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/confirmar") {
        const brutoConfirmacao = await lerBody(req);
        let payloadConfirmacao;
        try {
          payloadConfirmacao = JSON.parse(brutoConfirmacao.toString("utf8") || "{}");
        } catch {
          json(
            res,
            400,
            { ok: false, erro: "Payload inválido." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const validacaoConfirmacao = validarPayloadHttpTef(payloadConfirmacao, "confirmar");
        if (!validacaoConfirmacao.ok) {
          json(
            res,
            400,
            { ok: false, erro: validacaoConfirmacao.erro },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (
          Object.keys(payloadConfirmacao).some(
            (chave) =>
              chave !== "acao" &&
              chave !== "rede" &&
              chave !== "nsu" &&
              chave !== "finalizacao"
          )
        ) {
          json(
            res,
            400,
            { ok: false, erro: "Payload recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const bloqueioVinculoConfirmacao = await contextoFinanceiroTef(req);
        if (!bloqueioVinculoConfirmacao.ok) {
          json(
            res,
            403,
            { ok: false, erro: bloqueioVinculoConfirmacao.erro },
            origemCheck.origem,
            origens
          );
          return;
        }

        const resultadoConfirmacao = await executarConfirmacaoTef({
          rede: payloadConfirmacao.rede,
          nsu: payloadConfirmacao.nsu,
          finalizacao: payloadConfirmacao.finalizacao,
        });
        const httpConfirmacao = respostaOperacaoTef(resultadoConfirmacao);
        httpConfirmacao.corpo = await anexarProvaTef(httpConfirmacao.corpo, {
          acao: "confirmar",
          desafio: bloqueioVinculoConfirmacao.desafio,
          identificador: headerTef(req, "x-ultrapdv-identificador"),
          valorCentavos: Number(headerTef(req, "x-ultrapdv-valor-centavos")),
          nsu: payloadConfirmacao.nsu,
          autorizacao: headerTef(req, "x-ultrapdv-autorizacao"),
          rede: payloadConfirmacao.rede,
          finalizacao: payloadConfirmacao.finalizacao,
          sucesso: httpConfirmacao.corpo.ok === true,
          codigo: "",
        });
        if (httpConfirmacao.corpo.ok === true) {
          await removerRecuperacao().catch(() => {});
        }
        json(
          res,
          httpConfirmacao.status,
          httpConfirmacao.corpo,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/desfazer") {
        const brutoDesfazimento = await lerBody(req);
        let payloadDesfazimento;
        try {
          payloadDesfazimento = JSON.parse(brutoDesfazimento.toString("utf8") || "{}");
        } catch {
          json(
            res,
            400,
            { ok: false, erro: "Payload inválido." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const validacaoDesfazimento = validarPayloadHttpTef(payloadDesfazimento, "desfazer");
        if (!validacaoDesfazimento.ok) {
          json(
            res,
            400,
            { ok: false, erro: validacaoDesfazimento.erro },
            origemCheck.origem,
            origens
          );
          return;
        }
        if (
          Object.keys(payloadDesfazimento).some(
            (chave) =>
              chave !== "acao" &&
              chave !== "rede" &&
              chave !== "nsu" &&
              chave !== "finalizacao"
          )
        ) {
          json(
            res,
            400,
            { ok: false, erro: "Payload recusado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const bloqueioVinculoDesfazimento = await contextoFinanceiroTef(req);
        if (!bloqueioVinculoDesfazimento.ok) {
          json(
            res,
            403,
            { ok: false, erro: bloqueioVinculoDesfazimento.erro },
            origemCheck.origem,
            origens
          );
          return;
        }

        const resultadoDesfazimento = await executarDesfazimentoTef({
          rede: payloadDesfazimento.rede,
          nsu: payloadDesfazimento.nsu,
          finalizacao: payloadDesfazimento.finalizacao,
        });
        const httpDesfazimento = respostaOperacaoTef(resultadoDesfazimento);
        httpDesfazimento.corpo = await anexarProvaTef(httpDesfazimento.corpo, {
          acao: "desfazer",
          desafio: bloqueioVinculoDesfazimento.desafio,
          identificador: headerTef(req, "x-ultrapdv-identificador"),
          valorCentavos: Number(headerTef(req, "x-ultrapdv-valor-centavos")),
          nsu: payloadDesfazimento.nsu,
          autorizacao: headerTef(req, "x-ultrapdv-autorizacao"),
          rede: payloadDesfazimento.rede,
          finalizacao: payloadDesfazimento.finalizacao,
          sucesso: httpDesfazimento.corpo.ok === true,
          codigo: "",
        });
        if (httpDesfazimento.corpo.ok === true) {
          await removerRecuperacao().catch(() => {});
        }
        json(
          res,
          httpDesfazimento.status,
          httpDesfazimento.corpo,
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/vincular") {
        let dadosVinculo;
        try {
          dadosVinculo = JSON.parse((await lerBody(req)).toString("utf8") || "{}");
        } catch {
          json(res, 400, { ok: false, erro: "Payload inválido." }, origemCheck.origem, origens);
          return;
        }
        const codigoVinculo = typeof dadosVinculo?.codigo === "string" ? dadosVinculo.codigo : "";
        const restanteVinculo = { ...dadosVinculo };
        delete restanteVinculo.codigo;
        const conferenciaCodigoVinculo = conferirCodigoPareamento(
          await lerPareamento(),
          codigoVinculo
        );
        if (!conferenciaCodigoVinculo.ok) {
          if (conferenciaCodigoVinculo.atual) {
            await gravarPareamento(conferenciaCodigoVinculo.atual);
          }
          json(
            res,
            403,
            { ok: false, erro: conferenciaCodigoVinculo.erro },
            origemCheck.origem,
            origens
          );
          return;
        }
        const validadoVinculo = validarVinculoTef(restanteVinculo);
        if (!validadoVinculo.ok) {
          json(res, 400, { ok: false, erro: validadoVinculo.erro }, origemCheck.origem, origens);
          return;
        }
        if (!validadoVinculo.vinculo.estabelecimento || !validadoVinculo.vinculo.pontoCaptura) {
          json(
            res,
            400,
            { ok: false, erro: "Informe o estabelecimento e o ponto de captura autorizados." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const dispositivoLocal = String(await obterId());
        if (validadoVinculo.vinculo.dispositivoId !== dispositivoLocal) {
          json(
            res,
            403,
            { ok: false, erro: "Este Connector não é o terminal informado." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const atual = await lerVinculo();
        if (atual && atual.empresaId !== validadoVinculo.vinculo.empresaId) {
          json(
            res,
            409,
            { ok: false, erro: "Terminal TEF já vinculado a outra empresa." },
            origemCheck.origem,
            origens
          );
          return;
        }
        const preservado = { ...validadoVinculo.vinculo };
        if (atual?.terminalId && !preservado.terminalId) {
          preservado.terminalId = atual.terminalId;
        }
        if (atual?.ambiente && !preservado.ambiente) {
          preservado.ambiente = atual.ambiente;
        }
        if (atual?.cnpj && !preservado.cnpj) {
          preservado.cnpj = atual.cnpj;
        }
        if (atual?.servidor && !preservado.servidor) {
          preservado.servidor = atual.servidor;
        }
        const mesclado = validarVinculoTef(preservado);
        if (!mesclado.ok) {
          json(res, 400, { ok: false, erro: mesclado.erro }, origemCheck.origem, origens);
          return;
        }
        await gravarVinculo(mesclado.vinculo);
        await gravarPareamento(consumirPareamento(conferenciaCodigoVinculo.atual));
        json(
          res,
          200,
          { ok: true, vinculo: apresentarVinculoTef(mesclado.vinculo) },
          origemCheck.origem,
          origens
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/tef/desvincular") {
        const atualDesvinculo = await lerVinculo();
        const conferenciaDesvinculo = vinculoConfere(atualDesvinculo, req.headers);
        if (!atualDesvinculo || !conferenciaDesvinculo.ok) {
          json(
            res,
            403,
            { ok: false, erro: "Somente a empresa vinculada pode liberar o terminal." },
            origemCheck.origem,
            origens
          );
          return;
        }
        await removerVinculo();
        json(res, 200, { ok: true, vinculo: { vinculado: false } }, origemCheck.origem, origens);
        return;
      }

      if (req.method === "GET" && url.pathname === "/diagnostico") {
        if (!podeAdministrar(origemCheck.origem, portaReq)) {
          json(res, 403, { ok: false, erro: "Diagnóstico recusado." }, origemCheck.origem, origens);
          return;
        }
        const dllDiag = await verificarDllPgWeb(path.join(resolverRaizAgente(), "bin", "tef"));
        const tefDiag = apresentarStatusTef(await consultarStatusTef());
        const bibliotecaDiag = instanciaPinpadHomologacao;
        json(
          res,
          200,
          {
            ok: true,
            ...montarDiagnosticoConector({
              nome,
              versao,
              pgwebLib: tefDiag?.pgwebLib,
              dll: dllDiag,
              ambiente: modoHomologacao ? "homologacao" : "producao",
              porta: estado.porta,
              pinpadOcupado: pinpadEmOperacaoFinanceira(gerenciadorTef),
              bibliotecaInicializada: bibliotecaDiag?.inicializada === true,
              ultimaFalha: estado.ultimaFalha || "",
            }),
          },
          origemCheck.origem,
          origens
        );
        return;
      }

      json(
        res,
        404,
        { ok: false, erro: "Não encontrado." },
        origemCheck.origem,
        origens
      );
    } catch (error) {
      json(
        res,
        500,
        {
          ok: false,
          erro: error instanceof Error ? error.message : "Falha no agente.",
        },
        origemCheck.origem,
        origens
      );
    }
  });
}

function escutar(servidor, porta) {
  return new Promise((resolve, reject) => {
    const onError = (erro) => {
      servidor.off("listening", onListen);
      reject(erro);
    };
    const onListen = () => {
      servidor.off("error", onError);
      resolve(servidor);
    };
    servidor.once("error", onError);
    servidor.once("listening", onListen);
    servidor.listen(porta, HOST);
  });
}

function fecharServidor(servidor) {
  return new Promise((resolve) => {
    if (!servidor) {
      resolve();
      return;
    }
    servidor.close(() => resolve());
    setTimeout(resolve, 1500);
  });
}

async function iniciar() {
  process.title = NOME_CONECTOR;
  const origens = await carregarOrigens({ raiz: RAIZ });
  const dados = pastaDados(RAIZ);
  await obterOuCriarDispositivoId({ pasta: dados });
  const configInicial = await carregarConfigLocal();
  await registrarLog(
    "inicio",
    `versao=${VERSAO_INFO.version} preferred=${configInicial.preferredPort}`
  );

  const estado = {
    porta: configInicial.activePort || PORTA_PADRAO,
    status: "conectado",
  };
  let servidorAtual = null;
  let trayProc = null;
  let mutexSrv = null;
  const gerenciadorTef = new GerenciadorPgWeb({
    registrarLog: (evento, detalhe, opcoes) =>
      registrarLog(evento, detalhe, opcoes),
  });

  function montarDeps() {
    return {
      origens,
      nome: VERSAO_INFO.name,
      versao: VERSAO_INFO.version,
      estado,
      gerenciadorTef,
      obterDispositivoId: () => obterOuCriarDispositivoId({ pasta: dados }),
      encerrarProcesso: (codigo = 0) => {
        estado.status = "erro";
        void registrarLog("encerrar", `porta=${estado.porta} codigo=${codigo}`);
        if (trayProc && !trayProc.killed) {
          try {
            trayProc.kill();
          } catch {
            // ignore
          }
        }
        void gerenciadorTef.encerrar().finally(() => {
          void removerPid({ pasta: dados }).finally(() => {
            if (mutexSrv) {
              mutexSrv.close();
            }
            void fecharServidor(servidorAtual).finally(() => process.exit(codigo));
            setTimeout(() => process.exit(codigo), 1500);
          });
        });
      },
      aoImpressaoOk: async ({ impressora, papel }) => {
        await salvarConfigLocal({ lastPrinter: impressora, lastPaper: papel });
      },
      obterConfigLocal: carregarConfigLocal,
      aoSalvarImpressora: async ({ impressora, papel, drawerEnabled, drawerPin }) => {
        const patch = { lastPrinter: impressora, lastPaper: papel };
        if (drawerEnabled !== undefined) {
          patch.drawerEnabled = drawerEnabled;
        }
        if (drawerPin !== undefined) {
          patch.drawerPin = drawerPin;
        }
        return salvarConfigLocal(patch);
      },
      imprimirPdfComSumatra: async (opts) =>
        imprimirPdfComSumatra({
          ...opts,
          onLog: (evento, detalhe) => registrarLog(evento, detalhe),
        }),
      aoTestarImpressao: async (payload) => {
        const cfg = await carregarConfigLocal();
        const motor = await localizarMotorPdf();
        const impressoras = await listarImpressoras();
        const impressora = escolherImpressora({
          pedida: payload.impressora,
          lastPrinter: cfg.lastPrinter,
          impressoras,
        });
        if (!impressora) {
          throw new Error(
            mensagemErroImpressora({
              pedida: payload.impressora,
              lastPrinter: cfg.lastPrinter,
            })
          );
        }
        const papel = payload.papel || cfg.lastPaper || "80mm";
        const pdf = gerarPdfTesteConector({
          porta: estado.porta,
          versao: VERSAO_INFO.version,
          impressora,
          papel,
        });
        await imprimirPdfComSumatra({
          motor,
          impressora,
          copias: 1,
          papel,
          pdfBase64: pdf.toString("base64"),
          impressoras,
          onLog: (evento, detalhe) => registrarLog(evento, detalhe),
        });
        await salvarConfigLocal({ lastPrinter: impressora, lastPaper: papel });
        return { ok: true, impressora, papel };
      },
      aoReiniciar: async (plano) => {
        if (plano?.supervisor === true) {
          await registrarLog("reinicio-supervisor", `porta=${estado.porta}`);
          montarDeps().encerrarProcesso(CODIGO_SAIDA_REINICIO);
          return;
        }
        await gerenciadorTef.encerrar();
        await registrarLog("reinicio", `porta=${estado.porta}`);
        estado.status = "reiniciando";
        estado.ultimaFalha = "";
        const porta = estado.porta;
        try {
          await fecharServidor(servidorAtual);
          servidorAtual = criarServidor(montarDeps());
          await escutar(servidorAtual, porta);
          const saude = await consultarSaudeLocal(porta);
          if (!saude?.ok || Number(saude.port) !== porta) {
            estado.status = "erro";
            estado.ultimaFalha = "O Connector não voltou a responder.";
            await registrarLog("reinicio-falha", `porta=${porta}`);
            return;
          }
          estado.status = "conectado";
          await registrarLog("reinicio-ok", `porta=${porta}`);
        } catch (erroReinicio) {
          estado.status = "erro";
          estado.ultimaFalha = erroReinicio instanceof Error ? erroReinicio.message : "Falha ao reiniciar.";
          await registrarLog("reinicio-falha", estado.ultimaFalha);
        }
      },
      aoAlterarPorta: async (payload, portaAtual) => {
        const usarProxima = payload.usarProxima === true;
        const pedida = Number(payload.porta);
        if (!usarProxima && !portaValida(pedida)) {
          return {
            ok: false,
            status: 400,
            erro: mensagemPortaForaDaFaixa(),
          };
        }

        const alvo = usarProxima ? null : pedida;
        if (alvo === portaAtual) {
          await salvarConfigLocal({ preferredPort: alvo, activePort: alvo });
          return {
            ok: true,
            port: alvo,
            url: `http://127.0.0.1:${alvo}/`,
          };
        }

        if (alvo && (await portaOcupadaLoopback(alvo))) {
          const saude = await consultarSaudeLocal(alvo);
          if (saude && saude.ok) {
            await registrarLog("porta-conflito", `porta=${alvo}`);
            return {
              ok: false,
              status: 409,
            erro: mensagemPortaOcupada(alvo),
              podeUsarProxima: true,
            };
          }
        }

        const ocupada = async (p) => {
          if (p === portaAtual) {
            return true;
          }
          return portaOcupadaLoopback(p);
        };

        const escolha = usarProxima
          ? await escolherPortaLivre({
              preferred: PORTA_PADRAO,
              ocupada,
            })
          : alvo && !(await ocupada(alvo))
            ? { porta: alvo, conflitos: [] }
            : { porta: null, conflitos: [alvo] };

        if (!escolha.porta) {
          await registrarLog("porta-conflito", `porta=${alvo || "proxima"}`);
          return {
            ok: false,
            status: 409,
            erro: alvo
              ? mensagemPortaOcupada(alvo)
              : escolha.erro,
            podeUsarProxima: Boolean(alvo),
          };
        }

        const nova = escolha.porta;
        const anterior = { preferredPort: portaAtual, activePort: portaAtual };
        await registrarLog(
          "alterar-porta",
          `de=${portaAtual} para=${nova}`
        );
        const novoServidor = criarServidor(montarDeps());
        try {
          await escutar(novoServidor, nova);
          const saudeNova = await consultarSaudeLocal(nova);
          if (!saudeNova?.ok || Number(saudeNova.port) !== nova) {
            novoServidor.close();
            return {
              ok: false,
              status: 409,
              erro: "A nova porta não respondeu. A porta anterior foi mantida.",
              rollback: planejarRollbackPorta(anterior),
              podeUsarProxima: true,
            };
          }
        } catch {
          novoServidor.close();
          return {
            ok: false,
            status: 409,
            erro: mensagemPortaOcupada(nova),
            rollback: planejarRollbackPorta(anterior),
            podeUsarProxima: true,
          };
        }

        estado.porta = nova;
        await salvarConfigLocal({
          preferredPort: usarProxima ? nova : alvo || nova,
          activePort: nova,
        });
        const antigo = servidorAtual;
        servidorAtual = novoServidor;
        setTimeout(() => {
          void fecharServidor(antigo);
        }, 400);
        return {
          ok: true,
          port: nova,
          url: `http://127.0.0.1:${nova}/`,
        };
      },
    };
  }

  const mutex = await obterMutexExclusivo({
    aoFoco: () => abrirPainelNoNavegador(estado.porta),
  });
  if (!mutex.unico) {
    const portas = candidatosPorta(configInicial.preferredPort);
    const existente = await descobrirSaudeConector(portas);
    if (existente) {
      await registrarLog("instancia-existente", `porta=${existente.porta}`);
      await avisarInstanciaExistente();
      abrirPainelNoNavegador(existente.porta);
      process.exit(0);
    }
    await avisarInstanciaExistente();
    process.exit(0);
  }
  mutexSrv = mutex.servidor;

  const ocupada = (p) => portaOcupadaLoopback(p);
  const escolha = await escolherPortaLivre({
    preferred: configInicial.preferredPort,
    envPort: process.env.ULTRAPDV_PRINT_PORT,
    ocupada,
  });

  if (!escolha.porta) {
    await registrarLog("erro", escolha.erro);
    console.error(escolha.erro);
    process.exit(1);
  }

  for (const conflito of escolha.conflitos) {
    await registrarLog(
      "porta-ocupada",
      `porta=${conflito} (outro aplicativo); tentando proxima`
    );
  }

  estado.porta = escolha.porta;
  servidorAtual = criarServidor(montarDeps());
  await escutar(servidorAtual, estado.porta);
  try {
    await salvarConfigLocal({
      preferredPort: configInicial.preferredPort || PORTA_PADRAO,
      activePort: estado.porta,
    });
  } catch (erroConfig) {
    await registrarLog("config", erroConfig instanceof Error ? erroConfig.message : "falha ao gravar a porta ativa");
  }
  await gravarPid({ pasta: dados });
  trayProc = iniciarTray({
    configPath: arquivoConfigAtual(),
    porta: estado.porta,
    raiz: RAIZ,
  });
  await registrarLog(
    "escutando",
    `porta=${estado.porta} preferred=${configInicial.preferredPort}`
  );
  console.log(
    `${NOME_CONECTOR} ${VERSAO_INFO.version} em http://${HOST}:${estado.porta}`
  );
}

const ehPrincipal =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (ehPrincipal) {
  await iniciar();
}
