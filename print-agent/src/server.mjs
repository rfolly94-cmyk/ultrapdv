import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  arquivoConfigAtual,
  carregarConfigLocal,
  salvarConfigLocal,
} from "./config-local.mjs";
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
import { gerarPdfTesteConector } from "./pdf-teste.mjs";
import { pastaDados, resolverRaizAgente } from "./raiz.mjs";
import {
  MENSAGEM_TEF_NAO_INSTALADO,
  GerenciadorTefNativo,
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
    new GerenciadorTefNativo({
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
  const executarInicializacaoTef =
    deps.inicializarTef ??
    (async () => {
      const vinculo = await lerVinculo();
      const dispositivoLocal = String(await obterId());
      return gerenciadorTef.inicializar(autorizacaoDoVinculo(vinculo, dispositivoLocal));
    });
  const executarInstalacaoTef =
    deps.instalarTef ??
    (async (credencial) => {
      const vinculo = await lerVinculo();
      const dispositivoLocal = String(await obterId());
      const chave = await lerChave();
      const autorizado = autorizacaoDoVinculo(vinculo, dispositivoLocal, chave?.privada);
      if (!autorizado) {
        return gerenciadorTef.instalar(null);
      }
      return gerenciadorTef.instalar({ ...autorizado, credencial });
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
        json(res, 200, { ok: true }, origemCheck.origem, origens);
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
        json(res, 200, { ok: true, status: "reiniciando" }, origemCheck.origem, origens);
        if (aoReiniciar) {
          setTimeout(() => {
            void aoReiniciar();
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
        const resultado = await aoTestarImpressao(payload);
        json(res, 200, { ok: true, ...resultado }, origemCheck.origem, origens);
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
        const vinculo = apresentarVinculoTef(await lerVinculo());
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

        const resultadoInicio = await executarInicializacaoTef();
        const httpInicio = respostaOperacaoTef(resultadoInicio);
        json(res, httpInicio.status, httpInicio.corpo, origemCheck.origem, origens);
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

        const resultadoInstalacao = await executarInstalacaoTef(pedidoInstalacao.credencial);
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
  const gerenciadorTef = new GerenciadorTefNativo({
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
      encerrarProcesso: () => {
        estado.status = "erro";
        void registrarLog("encerrar", `porta=${estado.porta}`);
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
            void fecharServidor(servidorAtual).finally(() => process.exit(0));
            setTimeout(() => process.exit(0), 1500);
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
      aoReiniciar: async () => {
        await gerenciadorTef.encerrar();
        await registrarLog("reinicio", `porta=${estado.porta}`);
        estado.status = "reiniciando";
        const porta = estado.porta;
        await fecharServidor(servidorAtual);
        servidorAtual = criarServidor(montarDeps());
        await escutar(servidorAtual, porta);
        estado.status = "conectado";
        await registrarLog("reinicio-ok", `porta=${porta}`);
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
        await registrarLog(
          "alterar-porta",
          `de=${portaAtual} para=${nova}`
        );
        const novoServidor = criarServidor(montarDeps());
        try {
          await escutar(novoServidor, nova);
        } catch {
          novoServidor.close();
          return {
            ok: false,
            status: 409,
            erro: mensagemPortaOcupada(nova),
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
  await salvarConfigLocal({
    preferredPort: configInicial.preferredPort || PORTA_PADRAO,
    activePort: estado.porta,
  });
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
