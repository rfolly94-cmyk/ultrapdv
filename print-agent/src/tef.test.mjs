import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { preservarDiagnosticoInstalacao } from "./log.mjs";
import { criarServidor } from "./server.mjs";
import {
  cobrancaBloqueadaPorRecuperacao,
  gravarRecuperacaoTef,
  lerRecuperacaoTef,
  registroRecuperacaoTef,
  removerRecuperacaoTef,
} from "./tef-recuperacao.mjs";
import { resolverRaizAgente } from "./raiz.mjs";
import { carregarVersao } from "./versao.mjs";
import {
  CODIGOS_TEF,
  ESTADOS_PROCESSO_TEF,
  GerenciadorTefNativo,
  TIMEOUTS_TEF_MS,
  candidatosTefNativo,
  localizarTefNativo,
  statusTef,
  MENSAGEM_TEF_NAO_INSTALADO,
  MENSAGEM_TEF_OCUPADO,
  MENSAGEM_TEF_PINPAD_NAO_INICIALIZADO,
  MENSAGEM_TEF_PINPAD_OCUPADO,
  MENSAGEM_TEF_PROCESSO_ENCERRADO,
  MENSAGEM_TEF_PINPAD_EM_EXECUCAO,
  MENSAGEM_TEF_PINPAD_TIMEOUT,
  MENSAGEM_TEF_TIMEOUT,
  NOME_TEF_ANTIGO,
  NOME_TEF_NATIVO,
} from "./tef.mjs";

const fonteTef = readFileSync(fileURLToPath(new URL("./tef.mjs", import.meta.url)), "utf8");
const VERSAO_PACOTE = carregarVersao(resolverRaizAgente()).version;
const caminhoNativo = path.join("D:\\connector", "bin", "tef", NOME_TEF_NATIVO);

function accessSomenteNaRaiz(raiz) {
  return async (candidato) => {
    const relativo = path.relative(raiz, candidato);
    if (relativo.startsWith("..") || path.isAbsolute(relativo)) {
      const erro = new Error("ENOENT");
      erro.code = "ENOENT";
      throw erro;
    }
    await fs.access(candidato);
  };
}

function criarProcessoFalso() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    partes: [],
    ended: false,
    encerrarAoFechar: false,
    write(chunk) {
      this.partes.push(String(chunk));
      return true;
    },
    end() {
      this.ended = true;
      if (this.encerrarAoFechar) {
        queueMicrotask(() => proc.simularSaida(0));
      }
    },
  };
  proc.killed = false;
  proc.exitCode = null;
  proc.pid = 4242;
  proc.kill = () => {
    proc.killed = true;
    proc.simularSaida(1);
    return true;
  };
  proc.simularSaida = (code = 0) => {
    if (proc.exitCode != null) {
      return;
    }
    proc.exitCode = code;
    proc.emit("exit", code, null);
  };
  proc.emitirStdout = (texto) => {
    proc.stdout.emit("data", Buffer.from(texto));
  };
  return proc;
}

function spawnControlado({ encerrarAoFechar = false } = {}) {
  const processos = [];
  const spawn = (arquivo, args, opcoes) => {
    const proc = criarProcessoFalso();
    proc.stdin.encerrarAoFechar = encerrarAoFechar;
    proc.arquivo = arquivo;
    proc.args = args;
    proc.opcoes = opcoes;
    proc.pid = 5000 + processos.length;
    processos.push(proc);
    setImmediate(() => proc.emit("spawn"));
    return proc;
  };
  return { spawn, processos };
}

async function ate(condicao) {
  const inicio = Date.now();
  while (Date.now() - inicio < 1000) {
    if (condicao()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condição de teste não aconteceu");
}

function ultimaLinha(proc) {
  const texto = proc.stdin.partes.join("");
  const linhas = texto.split(/\r?\n/).filter((linha) => linha.trim());
  return JSON.parse(linhas[linhas.length - 1]);
}

function responder(proc, extra = {}) {
  const pedido = ultimaLinha(proc);
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: true,
      resultado: { eco: pedido.acao },
      erro: null,
      ...extra,
    })}\n`
  );
  return pedido;
}

function criarGerenciador(extras = {}) {
  const controlado = spawnControlado(extras);
  const logs = [];
  let seq = 0;
  const timers = [];
  const arquivoPendencia =
    extras.arquivoPendencia ??
    extras.deps?.arquivoPendencia ??
    path.join(os.tmpdir(), `ultrapdv-tef-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const gerenciador = new GerenciadorTefNativo({
    arquivoPendencia,
    localizar: async () => ({ encontrado: true, caminho: caminhoNativo }),
    spawn: controlado.spawn,
    registrarLog: async (evento, detalhe) => {
      logs.push({ evento, detalhe });
    },
    criarId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    agendar: (fn, ms) => {
      const item = { fn, ms, cancelado: false };
      timers.push(item);
      return item;
    },
    cancelarAgendamento: (item) => {
      if (item) {
        item.cancelado = true;
      }
    },
    limiteEncerramentoMs: 40,
    arquivoPasta: path.join(path.dirname(arquivoPendencia), "tef-pasta.json"),
    instalacaoAutomatica: false,
    listarDiretorioBiblioteca: async () => [],
    ...extras.deps,
  });
  if (extras.deps?.spawn) {
    return {
      gerenciador,
      processos: controlado.processos,
      logs,
      timers,
      spawn: extras.deps.spawn,
      arquivoPendencia: gerenciador.arquivoPendencia,
    };
  }
  return {
    gerenciador,
    processos: controlado.processos,
    logs,
    timers,
    arquivoPendencia: gerenciador.arquivoPendencia,
  };
}

async function comServidor(deps, fn) {
  const pastaTef = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-tef-"));
  const servidor = criarServidor({
    arquivoPendenciaTef: path.join(pastaTef, "tef-pendencia.json"),
    obterDispositivoId: async () => "11111111-1111-4111-8111-111111111111",
    versao: "1.2.0",
    nome: "UltraPDV Connector",
    localizarMotorPdf: async () => ({ encontrado: false, tipo: null, caminho: null }),
    listarImpressoras: async () => [{ nome: "ELGIN i9" }],
    obterConfigLocal: async () => ({
      lastPrinter: "ELGIN i9",
      lastPaper: "80mm",
      drawerEnabled: false,
      drawerPin: 0,
    }),
    registrarLogTef: async () => {},
    lerVinculoTef: async () => null,
    exigirVinculoTef: false,
    arquivoPareamentoTef: path.join(pastaTef, "tef-pareamento.json"),
    arquivoRecuperacaoTef: path.join(pastaTef, "tef-recuperacao.json"),
    arquivoChaveTef: path.join(pastaTef, "tef-chave.json"),
    ...deps,
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
    await fs.rm(pastaTef, { recursive: true, force: true });
  }
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
          });
        });
      })
      .on("error", reject);
  });
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const corpo = Buffer.from(JSON.stringify(payload));
    const req = http.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(corpo.length),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(corpo);
    req.end();
  });
}

function optionsReq(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const req = http.request(
      {
        hostname: alvo.hostname,
        port: alvo.port,
        path: alvo.pathname,
        method: "OPTIONS",
        headers,
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("módulo TEF não inicia o agente Pascal", () => {
  assert.doesNotMatch(fonteTef, /from "node:child_process"/);
  assert.match(fonteTef, /PASCAL_REMOVIDO/);
  assert.doesNotMatch(fonteTef, /shell:\s*true/);
  assert.doesNotMatch(fonteTef, /ULTRAPDV_TEF|executavel.*process\.env|payload\.executavel/);
});

test("timeouts ficam centralizados por operação", () => {
  assert.equal(TIMEOUTS_TEF_MS.status, 5000);
  assert.equal(TIMEOUTS_TEF_MS.inicializacao, 30000);
  assert.equal(TIMEOUTS_TEF_MS.teste, 60000);
  assert.equal(TIMEOUTS_TEF_MS.pagamento, 300000);
  assert.equal(TIMEOUTS_TEF_MS.cancelamento, 300000);
  assert.equal(TIMEOUTS_TEF_MS.instalacao, 300000);
  assert.equal(TIMEOUTS_TEF_MS.confirmacao, 60000);
  assert.equal(TIMEOUTS_TEF_MS.desfazimento, 60000);
  assert.deepEqual(ESTADOS_PROCESSO_TEF, [
    "nao_instalado",
    "parado",
    "iniciando",
    "executando",
    "erro",
  ]);
});

test("candidatos do agente Pascal ficam vazios", () => {
  assert.equal(NOME_TEF_NATIVO, "");
  assert.deepEqual(
    candidatosTefNativo(
      {
        ULTRAPDV_INSTALL_DIR: "C:\\Program Files\\UltraPDV Connector",
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      },
      "D:\\dev\\print-agent"
    ),
    []
  );
});

test("localizarTefNativo não seleciona UltraPDVTef", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-tef-"));
  const pasta = path.join(raiz, "bin", "tef");
  const env = {
    ULTRAPDV_INSTALL_DIR: "",
    ProgramFiles: raiz,
    "ProgramFiles(x86)": raiz,
  };
  try {
    await fs.mkdir(pasta, { recursive: true });
    await fs.writeFile(path.join(pasta, NOME_TEF_ANTIGO), "antigo");
    await fs.writeFile(path.join(pasta, "UltraPDVTef_1316.exe"), "legado");
    const achou = await localizarTefNativo(env, accessSomenteNaRaiz(raiz), raiz);
    assert.equal(achou.encontrado, false);
    assert.equal(achou.caminho, null);
    assert.equal(achou.antigoEncontrado, true);
  } finally {
    await fs.rm(raiz, { recursive: true, force: true });
  }
});

test("cobrança não usa o executável antigo nem uma versão diferente", async () => {
  let spawnou = false;
  const antigo = new GerenciadorTefNativo({
    localizar: async () => ({
      encontrado: true,
      caminho: "C:\\Program Files\\UltraPDV Connector\\bin\\tef\\UltraPDVTef_NOVO.exe",
      antigoEncontrado: true,
    }),
    spawn: () => {
      spawnou = true;
      throw new Error("não deveria iniciar");
    },
    registrarLog: async () => {},
    versaoAgente: VERSAO_PACOTE,
  });
  const bloqueado = await antigo.pagar({ identificador: "SIMULADO", valor: 1 });
  assert.equal(bloqueado.ok, false);
  assert.equal(bloqueado.statusHttp, 409);
  assert.equal(bloqueado.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal("agente" in bloqueado.tef, false);
  assert.equal("executavelEncontrado" in bloqueado.tef, false);
  assert.equal("inicializado" in bloqueado.tef, false);
  assert.match(bloqueado.erro, /não será usado/);
  assert.equal(spawnou, false);

  const incompativel = new GerenciadorTefNativo({
    localizar: async () => ({
      encontrado: true,
      caminho: "C:\\Program Files\\UltraPDV Connector\\bin\\tef\\UltraPDVTef_133.exe",
    }),
    spawn: () => {
      spawnou = true;
      throw new Error("não deveria iniciar");
    },
    registrarLog: async () => {},
    versaoAgente: VERSAO_PACOTE,
  });
  const outra = await incompativel.pagar({ identificador: "SIMULADO", valor: 1 });
  assert.equal("agente" in outra.tef, false);
  assert.match(outra.erro, /não será iniciada/);
  assert.equal(spawnou, false);

});

test("statusTef sem processo fica parado ou não instalado e sem inicializar", async () => {
  const arquivoPendencia = path.join(
    os.tmpdir(),
    `ultrapdv-tef-ausente-${Date.now()}.json`
  );
  const inspecionarDll = async () => ({
    encontrada: true,
    versao: "4.1.50.924",
    arquitetura: "x64",
    integridade: true,
    assinatura: "setis",
    pronta: true,
  });
  const semArquivo = await statusTef({
    localizar: async () => ({ encontrado: false, caminho: null }),
    arquivoPendencia,
    inspecionarDll,
  });
  assert.deepEqual(semArquivo, {
    transacaoPendenteConfirmacao: false,
    reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
    prontoParaPagamento: false,
    pgwebLib: {
      encontrada: true,
      versao: "4.1.50.924",
      arquitetura: "x64",
      integridade: true,
      assinatura: "setis",
      pronta: true,
    },
  });
  for (const campo of ["disponivel", "executavelEncontrado", "processo", "inicializado", "agente"]) {
    assert.equal(campo in semArquivo, false);
  }

  const comArquivo = await statusTef({
    localizar: async () => ({ encontrado: true, caminho: caminhoNativo }),
    arquivoPendencia,
    inspecionarDll,
  });
  assert.equal(comArquivo.pgwebLib.pronta, true);
  assert.equal("executavelEncontrado" in comArquivo, false);
  assert.equal("processo" in comArquivo, false);
  assert.equal("inicializado" in comArquivo, false);

  const caminhoEstranho = await statusTef({
    arquivoPendencia,
    inspecionarDll,
    localizar: async () => ({
      encontrado: true,
      caminho: "C:\\Windows\\System32\\calc.exe",
    }),
  });
  assert.equal("executavelEncontrado" in caminhoEstranho, false);
  assert.equal("processo" in caminhoEstranho, false);
  assert.equal(caminhoEstranho.pgwebLib.pronta, true);
});

test("executável inexistente ou caminho estranho não inicia processo", async () => {
  let chamou = false;
  const spawn = () => {
    chamou = true;
    throw new Error("não deveria iniciar");
  };
  const ausente = new GerenciadorTefNativo({
    localizar: async () => ({ encontrado: false, caminho: null }),
    spawn,
    registrarLog: async () => {},
  });
  const teste = await ausente.testar();
  assert.equal(teste.statusHttp, 503);
  assert.equal(teste.codigo, CODIGOS_TEF.NAO_INSTALADO);
  assert.equal(teste.erro, MENSAGEM_TEF_NAO_INSTALADO);
  assert.equal("processo" in teste.tef, false);
  assert.equal("agente" in teste.tef, false);
  assert.equal(chamou, false);

  const calc = new GerenciadorTefNativo({
    localizar: async () => ({
      encontrado: true,
      caminho: "C:\\Windows\\System32\\calc.exe",
    }),
    spawn,
    registrarLog: async () => {},
  });
  const recusado = await calc.executar({
    acao: "teste",
    executavel: "C:\\evil\\UltraPDVTef.exe",
    comando: "calc",
  });
  assert.equal(recusado.codigo, CODIGOS_TEF.PAYLOAD_RECUSADO);
  const venda = await calc.executar({ acao: "credito", valor: 10 });
  assert.equal(venda.codigo, CODIGOS_TEF.PAYLOAD_RECUSADO);
  const pagamento = await calc.executar({ acao: "pagamento" });
  assert.equal(pagamento.codigo, CODIGOS_TEF.DADOS_INVALIDOS);
  assert.equal(chamou, false);
});

test("rotas financeiras nao iniciam Pascal, Lazarus ou ACBr", () => {
  const servidor = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
  assert.equal(servidor.includes("lazbuild"), false);
  assert.equal(servidor.includes("ACBrTEF"), false);
  assert.equal(/spawn\([^)]*UltraPDVTef/.test(servidor), false);
  assert.match(servidor, /O pagamento TEF usa a PGWebLib/);
});
