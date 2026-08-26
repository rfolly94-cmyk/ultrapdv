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
    (async () => ({ lastPrinter: null, lastPaper: "80mm" }));
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
          "Access-Control-Allow-Headers": "Content-Type, Cache-Control, Pragma",
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
        if (!aoSalvarImpressora) {
          json(res, 501, { ok: false, erro: "Indisponível." }, origemCheck.origem, origens);
          return;
        }
        const salvo = await aoSalvarImpressora({
          impressora: nomeImpressora,
          papel,
        });
        json(
          res,
          200,
          {
            ok: true,
            lastPrinter: salvo?.lastPrinter || nomeImpressora,
            lastPaper: salvo?.lastPaper || papel,
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
        void removerPid({ pasta: dados }).finally(() => {
          if (mutexSrv) {
            mutexSrv.close();
          }
          void fecharServidor(servidorAtual).finally(() => process.exit(0));
          setTimeout(() => process.exit(0), 1500);
        });
      },
      aoImpressaoOk: async ({ impressora, papel }) => {
        await salvarConfigLocal({ lastPrinter: impressora, lastPaper: papel });
      },
      obterConfigLocal: carregarConfigLocal,
      aoSalvarImpressora: async ({ impressora, papel }) => {
        return salvarConfigLocal({ lastPrinter: impressora, lastPaper: papel });
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
