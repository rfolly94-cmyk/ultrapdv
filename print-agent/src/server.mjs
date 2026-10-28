import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  arquivoConfigAtual,
  carregarConfigLocal,
  salvarConfigLocal,
} from "./config-local.mjs";
import { continuarCaptura, normalizarRespostaMotor, pedidoLocalDoMotor, respostaImediataDeInterrupcao } from "./tef-csharp-ponte.mjs";
import { lerPendenciasNoDisco } from "./tef-pendencias-ambiente.mjs";
import { candidatosExecutavelMotor, resolverExecutavelMotor } from "./tef-motor-caminho.mjs";
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

  async function bloqueioCiclo() {
    if (typeof deps.bloqueioCiclo === "function") return deps.bloqueioCiclo();
    if (sessoesMotorCsharp.size > 0) return { permitido: false, motivo: "transacao" };
    return { permitido: true, motivo: "ocioso" };
  }

  function caminhoMotorCsharp() {
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    return resolverExecutavelMotor(
      candidatosExecutavelMotor({
        instalado: path.resolve(aqui, "../bin/tef/motor/UltraPDV.TEF.Host.exe"),
        ambiente: process.env.ULTRAPDV_TEF_HOST,
        repositorio: path.resolve(aqui, "../../UltraPDV.TEF/src/UltraPDV.TEF.Host/bin/Release/net8.0/UltraPDV.TEF.Host.exe"),
      }),
      (arquivo) => {
        try {
          readFileSync(arquivo);
          return true;
        } catch {
          return false;
        }
      }
    );
  }

  function terminalExistente(raiz, empresaId) {
    const arquivo = path.join(path.resolve(raiz, String(empresaId).replace(/-/g, "")), "terminal.json");
    try {
      const salvo = JSON.parse(readFileSync(arquivo, "utf8"));
      return /^[0-9a-f-]{36}$/i.test(salvo.terminalId ?? "") ? salvo.terminalId : null;
    } catch {
      return null;
    }
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
    sessao.aguardando = true;
    try {
      const prazo = Date.now() + 300000;
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
    } finally {
      sessao.aguardando = false;
    }
  }

  async function executarMotorCsharp(corpo) {
    if (corpo?.comando === "pendencias") {
      const raiz = process.env.ULTRAPDV_TEF_RAIZ || "C:\\ProgramData\\UltraPDV\\tef-empresas";
      const empresaId = typeof corpo?.empresaId === "string" ? corpo.empresaId : "";
      if (!/^[0-9a-f-]{36}$/i.test(empresaId)) {
        return {
          ok: false,
          pagamentoRecebido: false,
          confirmada: false,
          nativo: false,
          codigo: "EMPRESA_INVALIDA",
          erro: "A empresa ativa não pôde ser isolada. Nenhum journal foi modificado.",
        };
      }
      return lerPendenciasNoDisco(raiz, empresaId, terminalExistente(raiz, empresaId), sessoesMotorCsharp.size > 0, { readdirSync, readFileSync });
    }
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
      if (respostaImediataDeInterrupcao(sessao, corpo)) {
        return {
          ok: false,
          fase: "resultado",
          pagamentoRecebido: false,
          confirmada: false,
          nativo: true,
          codigo: "interrupcao_solicitada",
          erro: "Cancelamento solicitado. Aguarde o retorno da biblioteca. Nenhuma nova cobrança foi iniciada.",
        };
      }
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

      if (req.method === "GET" && url.pathname === "/diagnostico") {
        if (!podeAdministrar(origemCheck.origem, portaReq)) {
          json(res, 403, { ok: false, erro: "Diagnóstico recusado." }, origemCheck.origem, origens);
          return;
        }
        json(
          res,
          200,
          {
            ok: true,
            motor: "csharp",
            ...montarDiagnosticoConector({
              nome,
              versao,
              porta: estado.porta,
              pinpadOcupado: sessoesMotorCsharp.size > 0,
              bibliotecaInicializada: false,
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
  function montarDeps() {
    return {
      origens,
      nome: VERSAO_INFO.name,
      versao: VERSAO_INFO.version,
      estado,
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
        void Promise.resolve().finally(() => {
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
