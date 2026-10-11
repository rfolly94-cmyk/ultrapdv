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
  gravarRecuperacaoTef,
  lerRecuperacaoTef,
  registroRecuperacaoTef,
  removerRecuperacaoTef,
} from "./tef-recuperacao.mjs";
import { resolverRaizAgente } from "./raiz.mjs";
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
  MENSAGEM_TEF_TIMEOUT,
  NOME_TEF_NATIVO,
} from "./tef.mjs";

const fonteTef = readFileSync(fileURLToPath(new URL("./tef.mjs", import.meta.url)), "utf8");
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

test("módulo TEF não liga shell e não aceita executável arbitrário", () => {
  assert.match(fonteTef, /shell:\s*false/);
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

test("candidatos priorizam bin/tef na raiz real do Connector", () => {
  const raiz = "D:\\dev\\print-agent";
  const lista = candidatosTefNativo(
    {
      ULTRAPDV_INSTALL_DIR: "C:\\Program Files\\UltraPDV Connector",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    },
    raiz
  );
  assert.equal(lista[0], path.join(raiz, "bin", "tef", NOME_TEF_NATIVO));
  assert.equal(
    lista[1],
    path.join(
      "C:\\Program Files\\UltraPDV Connector",
      "bin",
      "tef",
      NOME_TEF_NATIVO
    )
  );
  assert.equal(
    candidatosTefNativo(
      {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
      },
      resolverRaizAgente()
    )[0],
    path.join(resolverRaizAgente(), "bin", "tef", NOME_TEF_NATIVO)
  );
});

test("localizarTefNativo só aceita UltraPDVTef.exe em bin/tef", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-tef-"));
  const pasta = path.join(raiz, "bin", "tef");
  const env = {
    ULTRAPDV_INSTALL_DIR: "",
    ProgramFiles: raiz,
    "ProgramFiles(x86)": raiz,
  };
  try {
    await fs.mkdir(pasta, { recursive: true });
    await fs.writeFile(path.join(pasta, "outro.exe"), "");
    const ausente = await localizarTefNativo(env, accessSomenteNaRaiz(raiz), raiz);
    assert.deepEqual(ausente, { encontrado: false, caminho: null });

    const exe = path.join(pasta, NOME_TEF_NATIVO);
    await fs.writeFile(exe, "");
    const achou = await localizarTefNativo(env, accessSomenteNaRaiz(raiz), raiz);
    assert.equal(achou.encontrado, true);
    assert.equal(path.resolve(achou.caminho), path.resolve(exe));
  } finally {
    await fs.rm(raiz, { recursive: true, force: true });
  }
});

test("statusTef sem processo fica parado ou não instalado e sem inicializar", async () => {
  const arquivoPendencia = path.join(
    os.tmpdir(),
    `ultrapdv-tef-ausente-${Date.now()}.json`
  );
  const semArquivo = await statusTef({
    localizar: async () => ({ encontrado: false, caminho: null }),
    arquivoPendencia,
  });
  assert.deepEqual(semArquivo, {
    disponivel: false,
    executavelEncontrado: false,
    processo: "nao_instalado",
    inicializado: false,
    transacaoPendenteConfirmacao: false,
    reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
  });

  const comArquivo = await statusTef({
    localizar: async () => ({ encontrado: true, caminho: caminhoNativo }),
    arquivoPendencia,
  });
  assert.deepEqual(comArquivo, {
    disponivel: false,
    executavelEncontrado: true,
    processo: "parado",
    inicializado: false,
    transacaoPendenteConfirmacao: false,
    reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
  });

  const caminhoEstranho = await statusTef({
    arquivoPendencia,
    localizar: async () => ({
      encontrado: true,
      caminho: "C:\\Windows\\System32\\calc.exe",
    }),
  });
  assert.equal(caminhoEstranho.executavelEncontrado, false);
  assert.equal(caminhoEstranho.processo, "nao_instalado");
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
  assert.equal(teste.tef.processo, "nao_instalado");
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

test("processo residente inicia uma vez e as chamadas reutilizam o mesmo pid", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const primeira = gerenciador.executar({ acao: "teste" });
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido1 = responder(processos[0]);
  const r1 = await primeira;

  const segunda = gerenciador.executar({ acao: "teste" });
  await ate(() => processos[0].stdin.partes.length === 2);
  const pedido2 = responder(processos[0]);
  const r2 = await segunda;

  assert.equal(processos.length, 1);
  assert.equal(processos[0].opcoes.shell, false);
  assert.deepEqual(processos[0].args, []);
  assert.equal(processos[0].arquivo, caminhoNativo);
  assert.equal(pedido1.id, "id-1");
  assert.equal(pedido2.id, "id-2");
  assert.notEqual(pedido1.id, pedido2.id);
  assert.equal(pedido1.versao, 1);
  assert.equal(pedido1.acao, "teste");
  assert.deepEqual(pedido1.dados, {});
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.resultado, { eco: "teste" });
  assert.equal(r2.id, "id-2");
  assert.deepEqual(r2.resultado, { eco: "teste" });
  const status = await gerenciador.consultar();
  assert.deepEqual(status, {
    disponivel: true,
    executavelEncontrado: true,
    processo: "executando",
    inicializado: false,
    transacaoPendenteConfirmacao: false,
    reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
  });
});

test("stdout fragmentado, várias linhas e stderr não entram no protocolo", async () => {
  const { gerenciador, processos, logs } = criarGerenciador();
  const pendente = gerenciador.executar({ acao: "teste" });
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido = ultimaLinha(processos[0]);

  processos[0].stderr.emit("data", Buffer.from("log do pinpad\n"));
  processos[0].emitirStdout("\n\n");
  processos[0].emitirStdout(`{"id":"outro","ok":true,"resultado":{"x":1},"erro":null}\n`);
  processos[0].emitirStdout(`lixo{nao-json\n{"id":"${pedido.id}","ok":tru`);
  assert.equal(gerenciador.pendente?.id, pedido.id);

  processos[0].emitirStdout(`e,"resultado":{"pong":true},"erro":null}\n`);
  const resposta = await pendente;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.id, pedido.id);
  assert.deepEqual(resposta.resultado, { pong: true });
  assert.equal(logs.some((item) => item.evento === "tef-stderr" && /pinpad/.test(item.detalhe)), true);
  assert.equal(logs.some((item) => item.evento === "tef-stdout-invalido"), true);
  assert.equal(logs.some((item) => item.evento === "tef-resposta-inesperada"), true);
  assert.equal(gerenciador.estado, "executando");
});

test("várias linhas no mesmo chunk correlacionam só o id pendente", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const pendente = gerenciador.executar({ acao: "teste" });
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido = ultimaLinha(processos[0]);
  processos[0].emitirStdout(
    [
      JSON.stringify({ id: "antes", ok: true, resultado: { n: 1 }, erro: null }),
      JSON.stringify({
        id: pedido.id,
        ok: false,
        resultado: { n: 2 },
        erro: "recusado pelo nativo",
      }),
      JSON.stringify({ id: "depois", ok: true, resultado: { n: 3 }, erro: null }),
    ].join("\n") + "\n"
  );
  const resposta = await pendente;
  assert.equal(resposta.ok, false);
  assert.equal(resposta.erro, "recusado pelo nativo");
  assert.deepEqual(resposta.resultado, { n: 2 });
  assert.equal(resposta.codigo, undefined);
  assert.equal(gerenciador.estado, "executando");
});

test("timeout rejeita só a requisição e não mata o processo", async () => {
  const { gerenciador, processos, timers } = criarGerenciador();
  const pendente = gerenciador.executar({ acao: "teste" });
  await ate(() => timers.length === 1 && processos[0]?.stdin.partes.length === 1);
  assert.equal(timers[0].ms, TIMEOUTS_TEF_MS.teste);
  timers[0].fn();
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.TIMEOUT);
  assert.equal(resposta.erro, MENSAGEM_TEF_TIMEOUT);
  assert.equal(processos[0].killed, false);
  assert.equal(gerenciador.estado, "executando");
  assert.equal(gerenciador.pendente, null);

  processos[0].emitirStdout(
    `${JSON.stringify({ id: "id-1", ok: true, resultado: { tarde: true }, erro: null })}\n`
  );
  assert.equal(gerenciador.estado, "executando");
  assert.equal(processos.length, 1);
});

test("processo encerrado inesperadamente não reinicia em loop", async () => {
  const { gerenciador, processos, logs } = criarGerenciador();
  const pendente = gerenciador.executar({ acao: "teste" });
  await ate(() => processos.length === 1);
  processos[0].simularSaida(9);
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.PROCESSO_ENCERRADO);
  assert.equal(resposta.erro, MENSAGEM_TEF_PROCESSO_ENCERRADO);
  assert.equal(resposta.code, 9);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(processos.length, 1);
  assert.equal(gerenciador.estado, "erro");
  assert.equal(
    logs.some((item) => item.evento === "tef-processo-encerrado" && item.detalhe === "code=9"),
    true
  );
  const status = await gerenciador.consultar();
  assert.equal(status.processo, "erro");
  assert.equal(status.disponivel, false);
  assert.equal(status.inicializado, false);
  assert.equal(processos.length, 1);
});

test("segunda operação simultânea retorna TEF_OCUPADO", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const primeira = gerenciador.executar({ acao: "teste" });
  const segunda = gerenciador.executar({ acao: "teste" });
  const ocupada = await segunda;
  assert.equal(ocupada.codigo, CODIGOS_TEF.OCUPADO);
  assert.equal(ocupada.erro, MENSAGEM_TEF_OCUPADO);
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responder(processos[0]);
  const ok = await primeira;
  assert.equal(ok.ok, true);
  assert.equal(processos.length, 1);
});

test("encerramento controlado fecha pelo stdin e mata se o processo ficar vivo", async () => {
  const gracioso = spawnControlado({ encerrarAoFechar: true });
  const gerenciador = new GerenciadorTefNativo({
    localizar: async () => ({ encontrado: true, caminho: caminhoNativo }),
    spawn: gracioso.spawn,
    registrarLog: async () => {},
    criarId: () => "id-fim",
    limiteEncerramentoMs: 50,
  });
  const pendente = gerenciador.executar({ acao: "teste" });
  await ate(() => gracioso.processos[0]?.stdin.partes.length === 1);
  responder(gracioso.processos[0]);
  assert.equal((await pendente).ok, true);
  await gerenciador.encerrar();
  assert.equal(gracioso.processos[0].stdin.ended, true);
  assert.equal(gracioso.processos[0].killed, false);
  assert.equal(gerenciador.estado, "parado");
  assert.equal((await gerenciador.consultar()).inicializado, false);

  const teimoso = spawnControlado();
  const outro = new GerenciadorTefNativo({
    localizar: async () => ({ encontrado: true, caminho: caminhoNativo }),
    spawn: teimoso.spawn,
    registrarLog: async () => {},
    criarId: () => "id-kill",
    limiteEncerramentoMs: 30,
  });
  const aberto = outro.executar({ acao: "teste" });
  await ate(() => teimoso.processos[0]?.stdin.partes.length === 1);
  responder(teimoso.processos[0]);
  await aberto;
  await outro.encerrar();
  assert.equal(teimoso.processos[0].killed, true);
  assert.equal(outro.estado, "parado");
  assert.equal(outro.filho, null);
});

test("GET /tef/status informa o estado do executável sem iniciar o processo", async () => {
  let spawnou = false;
  await comServidor(
    {
      localizarTefNativo: async () => ({ encontrado: false, caminho: null }),
      spawnTef: () => {
        spawnou = true;
        throw new Error("não deveria iniciar");
      },
    },
    async (base) => {
      const ausente = await getJson(`${base}/tef/status`);
      assert.equal(ausente.status, 200);
      assert.deepEqual(ausente.body, {
        ok: true,
        tef: {
          disponivel: false,
          executavelEncontrado: false,
          processo: "nao_instalado",
          inicializado: false,
          transacaoPendenteConfirmacao: false,
          reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
        },
        vinculo: { vinculado: false },
      });
    }
  );

  await comServidor(
    {
      localizarTefNativo: async () => ({ encontrado: true, caminho: caminhoNativo }),
      spawnTef: () => {
        spawnou = true;
        throw new Error("não deveria iniciar");
      },
    },
    async (base) => {
      const presente = await getJson(`${base}/tef/status`, {
        Origin: "http://localhost:3000",
      });
      assert.equal(presente.status, 200);
      assert.equal(presente.body.tef.executavelEncontrado, true);
      assert.equal(presente.body.tef.disponivel, false);
      assert.equal(presente.body.tef.processo, "parado");
      assert.equal(presente.body.tef.inicializado, false);
      assert.equal(
        presente.headers["access-control-allow-origin"],
        "http://localhost:3000"
      );
      assert.equal(presente.body.tef.caminho, undefined);
    }
  );
  assert.equal(spawnou, false);
});

test("POST /tef/teste sem executável não inicia o nativo", async () => {
  let localizou = 0;
  let spawnou = false;
  await comServidor(
    {
      localizarTefNativo: async () => {
        localizou += 1;
        return { encontrado: false, caminho: null };
      },
      spawnTef: () => {
        spawnou = true;
        throw new Error("não deveria iniciar");
      },
    },
    async (base) => {
      const r = await postJson(`${base}/tef/teste`, {});
      assert.equal(r.status, 503);
      assert.equal(r.body.ok, false);
      assert.equal(r.body.codigo, CODIGOS_TEF.NAO_INSTALADO);
      assert.equal(r.body.erro, MENSAGEM_TEF_NAO_INSTALADO);
      assert.deepEqual(r.body.tef, {
        disponivel: false,
        executavelEncontrado: false,
        processo: "nao_instalado",
        inicializado: false,
        transacaoPendenteConfirmacao: false,
        reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
      });
      assert.equal(localizou, 1);
      assert.equal(spawnou, false);
    }
  );
});

test("POST /tef/teste com executável falso usa o processo residente", async () => {
  const { spawn, processos } = spawnControlado();
  await comServidor(
    {
      localizarTefNativo: async () => ({ encontrado: true, caminho: caminhoNativo }),
      spawnTef: (arquivo, args, opcoes) => {
        const proc = spawn(arquivo, args, opcoes);
        const escrever = proc.stdin.write.bind(proc.stdin);
        proc.stdin.write = (chunk) => {
          escrever(chunk);
          const pedido = JSON.parse(String(chunk).trim());
          setImmediate(() => {
            proc.emitirStdout(
              `${JSON.stringify({
                id: pedido.id,
                ok: true,
                resultado: { pronto: true },
                erro: null,
              })}\n`
            );
          });
          return true;
        };
        return proc;
      },
    },
    async (base) => {
      const primeiro = await postJson(`${base}/tef/teste`, {});
      const segundo = await postJson(`${base}/tef/teste`, {});
      assert.equal(primeiro.status, 200);
      assert.equal(primeiro.body.ok, true);
      assert.deepEqual(primeiro.body.resultado, { pronto: true });
      assert.deepEqual(primeiro.body.tef, {
        disponivel: true,
        executavelEncontrado: true,
        processo: "executando",
        inicializado: false,
        transacaoPendenteConfirmacao: false,
        reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
      });
      assert.equal(segundo.status, 200);
      assert.equal(segundo.body.ok, true);
      assert.equal(processos.length, 1);

      const status = await getJson(`${base}/tef/status`);
      assert.equal(status.body.tef.processo, "executando");
      assert.equal(status.body.tef.disponivel, true);
      assert.equal(status.body.tef.inicializado, false);
    }
  );
});

test("POST /tef/teste recusa caminho, comando e operação de pagamento", async () => {
  let localizou = false;
  await comServidor(
    {
      localizarTefNativo: async () => {
        localizou = true;
        return { encontrado: true, caminho: caminhoNativo };
      },
    },
    async (base) => {
      const caminho = await postJson(`${base}/tef/teste`, {
        executavel: "C:\\Windows\\System32\\calc.exe",
        comando: "calc",
      });
      assert.equal(caminho.status, 400);
      assert.equal(caminho.body.erro, "Payload recusado.");

      const venda = await postJson(`${base}/tef/teste`, { acao: "credito" });
      assert.equal(venda.status, 400);
      assert.equal(venda.body.erro, "Operação TEF não permitida.");

      const invalido = await postJson(`${base}/tef/teste`, []);
      assert.equal(invalido.status, 400);
      assert.equal(invalido.body.erro, "Payload recusado.");
      assert.equal(localizou, false);
    }
  );
});

test("origem inválida continua recusada no TEF e nas rotas existentes", async () => {
  await comServidor({}, async (base) => {
    const status = await getJson(`${base}/tef/status`, {
      Origin: "https://evil.example",
    });
    assert.equal(status.status, 403);
    assert.equal(status.body.erro, "Origem não permitida.");
    assert.notEqual(status.headers["access-control-allow-origin"], "*");

    const teste = await postJson(
      `${base}/tef/teste`,
      {},
      { Origin: "https://evil.example" }
    );
    assert.equal(teste.status, 403);
    assert.equal(teste.body.erro, "Origem não permitida.");

    const saude = await getJson(`${base}/health`, {
      Origin: "https://evil.example",
    });
    assert.equal(saude.status, 403);

    const preflight = await optionsReq(`${base}/tef/teste`, {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
    });
    assert.equal(preflight.status, 403);
  });
});

test("rotas existentes de status, saúde, impressoras e impressão seguem iguais", async () => {
  await comServidor({}, async (base) => {
    const status = await getJson(`${base}/status`);
    assert.equal(status.status, 200);
    assert.equal(status.body.ok, true);
    assert.equal(status.body.app, "UltraPDV-Conector");
    assert.equal(status.body.tef, undefined);

    const saude = await getJson(`${base}/health`);
    assert.equal(saude.status, 200);
    assert.equal(saude.body.ok, true);
    assert.equal(saude.body.motorImpressao.encontrado, false);
    assert.equal(saude.body.drawerEnabled, false);
    assert.equal(saude.body.tef, undefined);

    const impressoras = await getJson(`${base}/printers`);
    assert.equal(impressoras.status, 200);
    assert.deepEqual(impressoras.body.impressoras, [{ nome: "ELGIN i9" }]);

    const impressao = await postJson(`${base}/print`, {
      comando: "calc",
      pdfBase64: "abc",
    });
    assert.equal(impressao.status, 400);
    assert.equal(impressao.body.erro, "Payload recusado.");

    const preflight = await optionsReq(`${base}/tef/status`, {
      Origin: "https://ultrapdv.app",
      "Access-Control-Request-Method": "GET",
    });
    assert.equal(preflight.status, 204);
    assert.match(String(preflight.headers["access-control-allow-methods"]), /GET/);
    assert.match(String(preflight.headers["access-control-allow-methods"]), /POST/);
  });
});

function responderInicializacao(proc) {
  const pedido = ultimaLinha(proc);
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: true,
      resultado: { inicializado: true, modelo: "PayGoWeb" },
      erro: null,
    })}\n`
  );
  return pedido;
}

test("inicializar envia a ação nativa e marca o processo como inicializado", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const pendente = gerenciador.inicializar();
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido = responderInicializacao(processos[0]);
  const resposta = await pendente;

  assert.equal(pedido.versao, 1);
  assert.equal(pedido.acao, "inicializar");
  assert.deepEqual(pedido.dados, {});
  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.inicializado, true);
  assert.equal(resposta.resultado.modelo, "PayGoWeb");
  assert.equal(resposta.tef.inicializado, true);
  const status = await gerenciador.consultar();
  assert.deepEqual(status, {
    disponivel: true,
    executavelEncontrado: true,
    processo: "executando",
    inicializado: true,
    transacaoPendenteConfirmacao: false,
    reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
  });
});

test("timeout da inicialização é 30 segundos e não mata o processo", async () => {
  const { gerenciador, processos, timers } = criarGerenciador();
  const pendente = gerenciador.inicializar();
  await ate(() => timers.length === 1 && processos[0]?.stdin.partes.length === 1);
  assert.equal(timers[0].ms, TIMEOUTS_TEF_MS.inicializacao);
  assert.equal(TIMEOUTS_TEF_MS.inicializacao, 30000);
  timers[0].fn();
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.TIMEOUT);
  assert.equal(resposta.erro, MENSAGEM_TEF_TIMEOUT);
  assert.equal(processos[0].killed, false);
  assert.equal((await gerenciador.consultar()).inicializado, false);
});

test("processo encerrado durante a inicialização não fica inicializado", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const pendente = gerenciador.inicializar();
  await ate(() => processos.length === 1 && processos[0].stdin.partes.length === 1);
  processos[0].simularSaida(9);
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.PROCESSO_ENCERRADO);
  assert.equal(resposta.erro, MENSAGEM_TEF_PROCESSO_ENCERRADO);
  const status = await gerenciador.consultar();
  assert.equal(status.inicializado, false);
  assert.equal(status.processo, "erro");
  assert.equal(processos.length, 1);
});

test("inicialização concorrente retorna TEF_OCUPADO", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const primeira = gerenciador.inicializar();
  const segunda = gerenciador.inicializar();
  const ocupada = await segunda;
  assert.equal(ocupada.codigo, CODIGOS_TEF.OCUPADO);
  assert.equal(ocupada.erro, MENSAGEM_TEF_OCUPADO);
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responderInicializacao(processos[0]);
  const ok = await primeira;
  assert.equal(ok.ok, true);
  assert.equal(ok.tef.inicializado, true);
  assert.equal(processos.length, 1);
});

test("reinício do processo zera inicializado até nova inicialização", async () => {
  const { gerenciador, processos } = criarGerenciador({ encerrarAoFechar: true });
  const primeira = gerenciador.inicializar();
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responderInicializacao(processos[0]);
  assert.equal((await primeira).tef.inicializado, true);

  await gerenciador.reiniciar();
  const aposReinicio = await gerenciador.consultar();
  assert.equal(aposReinicio.processo, "executando");
  assert.equal(aposReinicio.inicializado, false);
  assert.equal(processos.length, 2);

  const segunda = gerenciador.inicializar();
  await ate(() => processos[1]?.stdin.partes.length === 1);
  const meio = await gerenciador.consultar();
  assert.equal(meio.inicializado, false);
  responderInicializacao(processos[1]);
  const deNovo = await segunda;
  assert.equal(deNovo.ok, true);
  assert.equal(deNovo.resultado.inicializado, true);
  assert.equal((await gerenciador.consultar()).inicializado, true);
});

test("POST /tef/inicializar reflete inicializado no status", async () => {
  const { spawn, processos } = spawnControlado();
  await comServidor(
    {
      localizarTefNativo: async () => ({ encontrado: true, caminho: caminhoNativo }),
      spawnTef: (arquivo, args, opcoes) => {
        const proc = spawn(arquivo, args, opcoes);
        const escrever = proc.stdin.write.bind(proc.stdin);
        proc.stdin.write = (chunk) => {
          escrever(chunk);
          const pedido = JSON.parse(String(chunk).trim());
          assert.equal(pedido.acao, "inicializar");
          assert.equal(pedido.versao, 1);
          assert.deepEqual(pedido.dados, {});
          setImmediate(() => {
            proc.emitirStdout(
              `${JSON.stringify({
                id: pedido.id,
                ok: true,
                resultado: { inicializado: true, modelo: "PayGoWeb" },
                erro: null,
              })}\n`
            );
          });
          return true;
        };
        return proc;
      },
    },
    async (base) => {
      const inicio = await postJson(`${base}/tef/inicializar`, {});
      assert.equal(inicio.status, 200);
      assert.equal(inicio.body.ok, true);
      assert.equal(inicio.body.resultado.inicializado, true);
      assert.equal(inicio.body.resultado.modelo, "PayGoWeb");
      assert.equal(inicio.body.tef.inicializado, true);
      assert.equal(inicio.body.tef.processo, "executando");
      assert.equal(processos.length, 1);

      const status = await getJson(`${base}/tef/status`);
      assert.equal(status.status, 200);
      assert.deepEqual(status.body.tef, {
        disponivel: true,
        executavelEncontrado: true,
        processo: "executando",
        inicializado: true,
        transacaoPendenteConfirmacao: false,
        reconciliacaoNecessaria: false,
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
      });

      const recusado = await postJson(`${base}/tef/inicializar`, {
        executavel: "C:\\Windows\\System32\\calc.exe",
      });
      assert.equal(recusado.status, 400);
      assert.equal(recusado.body.erro, "Payload recusado.");

      const pagamento = await postJson(`${base}/tef/inicializar`, { acao: "credito" });
      assert.equal(pagamento.status, 400);
      assert.equal(pagamento.body.erro, "Operação TEF não permitida.");
    }
  );
});

async function deixarInicializado(gerenciador, processos) {
  const pendente = gerenciador.inicializar();
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responderInicializacao(processos[0]);
  const resposta = await pendente;
  assert.equal(resposta.ok, true);
  return processos[0];
}

const IDENTIDADE_INSTALACAO = {
  empresaId: "11111111-1111-4111-8111-111111111111",
  dispositivoId: "33333333-3333-4333-8333-333333333333",
  dispositivoLocal: "33333333-3333-4333-8333-333333333333",
  terminalId: "44444444-4444-4444-8444-444444444444",
  pontoCaptura: "200001",
  estabelecimento: "LOJA NOVA",
  ambiente: "homologacao",
  cnpj: "11222333000181",
  servidor: "tef.cliente.example:31735",
  chavePrivada: "chave-de-teste",
};

async function deixarInicializadoParaInstalar(gerenciador, processos) {
  const pendente = gerenciador.inicializar(IDENTIDADE_INSTALACAO);
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido = ultimaLinha(processos[0]);
  assert.equal(pedido.dados.pontoCaptura, "200001");
  assert.equal(pedido.dados.cnpj, "11222333000181");
  assert.equal(pedido.dados.servidor, "tef.cliente.example:31735");
  assert.equal(pedido.dados.ambiente, "homologacao");
  assert.equal(JSON.stringify(pedido).includes("117473"), false);
  assert.equal(JSON.stringify(pedido).includes("pos-transac-sb.tpgweb.io"), false);
  responderInicializacao(processos[0]);
  const resposta = await pendente;
  assert.equal(resposta.ok, true);
  return processos[0];
}

function emitirPagamento(proc, resultado) {
  const pedido = ultimaLinha(proc);
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: true,
      resultado,
      erro: null,
    })}\n`
  );
  return pedido;
}

test("pagamento é rejeitado quando o TEF não foi inicializado", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const resposta = await gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  assert.equal(resposta.codigo, CODIGOS_TEF.NAO_INICIALIZADO);
  assert.equal(resposta.statusHttp, 409);
  assert.equal(processos.length, 0);
  assert.equal((await gerenciador.consultar()).inicializado, false);
});

test("pagamento rejeita identificador vazio e valor zero ou negativo", async () => {
  const { gerenciador, processos } = criarGerenciador();
  await deixarInicializado(gerenciador, processos);

  const vazio = await gerenciador.pagar({ identificador: "   ", valor: 10 });
  assert.equal(vazio.codigo, CODIGOS_TEF.DADOS_INVALIDOS);
  assert.equal(vazio.statusHttp, 400);

  const zero = await gerenciador.pagar({ identificador: "VENDA-123", valor: 0 });
  assert.equal(zero.codigo, CODIGOS_TEF.DADOS_INVALIDOS);

  const negativo = await gerenciador.pagar({ identificador: "VENDA-123", valor: -1 });
  assert.equal(negativo.codigo, CODIGOS_TEF.DADOS_INVALIDOS);
  assert.equal(processos[0].stdin.partes.length, 1);
  assert.equal((await gerenciador.consultar()).inicializado, true);
});

test("pagamento válido envia identificador e valor ao processo nativo", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "  VENDA-123  ", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  const pedido = emitirPagamento(proc, {
    sucessoChamada: true,
    sucessoTransacao: true,
    rede: "CIELO",
    nsu: "123456",
    codigoAutorizacao: "ABC123",
    codigoFinalizacao: "FIN01",
    valor: 10,
    confirmar: true,
    precisaConfirmacao: true,
    mensagem: "APROVADO",
    comprovante1Via: "VIA1",
    comprovante2Via: "VIA2",
    identificador: "VENDA-123",
  });
  const resposta = await pendente;

  assert.equal(pedido.versao, 1);
  assert.equal(pedido.acao, "pagamento");
  assert.deepEqual(pedido.dados, { identificador: "VENDA-123", valor: 10 });
  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.sucessoTransacao, true);
  assert.equal(resposta.resultado.nsu, "123456");
  assert.equal(resposta.resultado.codigoAutorizacao, "ABC123");
  assert.equal(processos.length, 1);
  assert.equal(processos[0].opcoes.shell, false);
});

test("timeout do pagamento é 300 segundos e não mata o processo", async () => {
  const { gerenciador, processos, timers } = criarGerenciador();
  await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => timers.some((item) => !item.cancelado && item.ms === 300000));
  const timer = timers.find((item) => !item.cancelado && item.ms === 300000);
  assert.equal(TIMEOUTS_TEF_MS.pagamento, 300000);
  assert.equal(processos[0].killed, false);
  timer.fn();
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.TIMEOUT);
  assert.equal(processos[0].killed, false);
  assert.equal(processos[0].exitCode, null);
  const status = await gerenciador.consultar();
  assert.equal(status.processo, "executando");
  assert.equal(status.inicializado, true);
});

test("processo encerrado durante o pagamento devolve TEF_PROCESSO_ENCERRADO", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  proc.simularSaida(7);
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.PROCESSO_ENCERRADO);
  assert.equal(resposta.erro, MENSAGEM_TEF_PROCESSO_ENCERRADO);
  const status = await gerenciador.consultar();
  assert.equal(status.processo, "erro");
  assert.equal(status.inicializado, false);
  assert.equal(processos.length, 1);
});

test("pagamento concorrente retorna TEF_OCUPADO", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const primeira = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  const segunda = gerenciador.pagar({ identificador: "VENDA-456", valor: 5 });
  const ocupada = await segunda;
  assert.equal(ocupada.codigo, CODIGOS_TEF.OCUPADO);
  assert.equal(ocupada.statusHttp, 409);
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, { sucessoTransacao: true, valor: 10 });
  const aprovada = await primeira;
  assert.equal(aprovada.ok, true);
  assert.equal(processos.length, 1);
});

test("resposta negada simulada mantém o processo inicializado", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, {
    sucessoChamada: true,
    sucessoTransacao: false,
    rede: "",
    nsu: "",
    codigoAutorizacao: "",
    codigoFinalizacao: "",
    valor: 10,
    confirmar: false,
    precisaConfirmacao: false,
    mensagem: "NEGADO",
    comprovante1Via: "",
    comprovante2Via: "",
  });
  const resposta = await pendente;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.sucessoChamada, true);
  assert.equal(resposta.resultado.sucessoTransacao, false);
  assert.equal(resposta.resultado.mensagem, "NEGADO");
  const status = await gerenciador.consultar();
  assert.equal(status.processo, "executando");
  assert.equal(status.inicializado, true);
  assert.equal(status.disponivel, true);
});

test("POST /tef/pagamento valida, encaminha e preserva o status", async () => {
  const { spawn, processos } = spawnControlado();
  await comServidor(
    {
      localizarTefNativo: async () => ({ encontrado: true, caminho: caminhoNativo }),
      spawnTef: (arquivo, args, opcoes) => {
        const proc = spawn(arquivo, args, opcoes);
        const escrever = proc.stdin.write.bind(proc.stdin);
        proc.stdin.write = (chunk) => {
          escrever(chunk);
          const pedido = JSON.parse(String(chunk).trim());
          setImmediate(() => {
            if (pedido.acao === "inicializar") {
              proc.emitirStdout(
                `${JSON.stringify({
                  id: pedido.id,
                  ok: true,
                  resultado: { inicializado: true, modelo: "PayGoWeb" },
                  erro: null,
                })}\n`
              );
              return;
            }
            if (pedido.acao === "pagamento") {
              proc.emitirStdout(
                `${JSON.stringify({
                  id: pedido.id,
                  ok: true,
                  resultado: {
                    sucessoChamada: true,
                    sucessoTransacao: true,
                    rede: "REDE",
                    nsu: "999",
                    codigoAutorizacao: "AUT",
                    codigoFinalizacao: "FIN",
                    valor: pedido.dados.valor,
                    confirmar: true,
                    precisaConfirmacao: true,
                    mensagem: "APROVADO",
                    comprovante1Via: "1",
                    comprovante2Via: "2",
                    identificador: pedido.dados.identificador,
                  },
                  erro: null,
                })}\n`
              );
            }
          });
          return true;
        };
        return proc;
      },
    },
    async (base) => {
      const cedo = await postJson(`${base}/tef/pagamento`, {
        identificador: "VENDA-123",
        valor: 10,
      });
      assert.equal(cedo.status, 409);
      assert.equal(cedo.body.codigo, CODIGOS_TEF.NAO_INICIALIZADO);
      assert.equal(processos.length, 0);

      const invalido = await postJson(`${base}/tef/pagamento`, {
        identificador: "",
        valor: 10,
      });
      assert.equal(invalido.status, 400);
      assert.equal(invalido.body.codigo, CODIGOS_TEF.DADOS_INVALIDOS);

      const proibido = await postJson(`${base}/tef/pagamento`, {
        identificador: "VENDA-123",
        valor: 10,
        parcelas: 2,
      });
      assert.equal(proibido.status, 400);
      assert.equal(proibido.body.erro, "Payload recusado.");

      const inicio = await postJson(`${base}/tef/inicializar`, {});
      assert.equal(inicio.status, 200);
      assert.equal(inicio.body.tef.inicializado, true);

      const pago = await postJson(`${base}/tef/pagamento`, {
        identificador: "VENDA-123",
        valor: 10,
      });
      assert.equal(pago.status, 200);
      assert.equal(pago.body.ok, true);
      assert.equal(pago.body.resultado.sucessoTransacao, true);
      assert.equal(pago.body.resultado.nsu, "999");
      assert.equal(pago.body.tef.inicializado, true);
      assert.equal(pago.body.tef.processo, "executando");

      const status = await getJson(`${base}/tef/status`);
      assert.equal(status.body.tef.inicializado, true);
      assert.equal(status.body.tef.processo, "executando");
      assert.equal(processos.length, 1);
      assert.equal(processos[0].opcoes.shell, false);
    }
  );
});

const VENDA_APROVADA = {
  sucessoChamada: true,
  sucessoTransacao: true,
  rede: "CIELO",
  nsu: "123456",
  codigoAutorizacao: "ABC123",
  codigoFinalizacao: "FIN01",
  finalizacao: "FIN01",
  valor: 10,
  confirmar: true,
  precisaConfirmacao: true,
  transacaoPendenteConfirmacao: true,
  mensagem: "APROVADO",
  comprovante1Via: "VIA1",
  comprovante2Via: "VIA2",
  identificador: "VENDA-123",
};

const PERNA_APROVADA = { rede: "CIELO", nsu: "123456", finalizacao: "FIN01" };

test("confirmação automática fica desligada antes de inicializar o TEF", () => {
  const fonte = readFileSync(
    fileURLToPath(new URL("../../tef-agent/UltraPDVTef.lpr", import.meta.url)),
    "utf8"
  );
  const desligada = fonte.indexOf("TEF.ConfirmarTransacaoAutomaticamente := False");
  const inicializar = fonte.indexOf("TEF.Inicializar;");
  assert.ok(desligada >= 0);
  assert.ok(inicializar > desligada);
  assert.equal(fonte.includes("ConfirmarTransacaoAutomaticamente := True"), false);
  assert.match(fonte, /TEF\.FinalizarTransacao\(Rede, NSU, Finalizacao, Status\)/);
  assert.match(fonte, /Status := tefstsSucessoManual/);
  assert.match(fonte, /Status := tefstsErroDiverso/);
  assert.equal(fonte.includes("TEF.CancelarTransacao"), false);
  assert.equal(fonte.includes("ConfirmarTransacoesPendentes"), false);
  const inicializarNativo = fonte.indexOf("TEF.Inicializar;");
  const antes = fonte.slice(0, inicializarNativo);
  assert.ok(antes.includes("TEF.TratamentoTransacaoPendente := tefpenPerguntar"));
  assert.ok(antes.includes("TEF.TratamentoTransacaoInicializacao := tefopiProcessarPendentes"));
  assert.equal(fonte.includes("tefpenConfirmar"), false);
  assert.equal(fonte.includes("tefpenEstornar"), false);
  assert.equal(fonte.includes("tefopiCancelarOuEstornar"), false);
  assert.equal(fonte.includes("ConfirmarTransacoesPendentesNoHost := True"), false);
  const evento = fonte.slice(
    fonte.indexOf("procedure TEventosTEF.QuandoDetectarTransacaoPendente"),
    fonte.indexOf("procedure TEventosTEF.QuandoEsperarOperacao")
  );
  assert.equal(evento.includes("FinalizarTransacao"), false);
  assert.equal(evento.includes("ResolverTransacaoPendente"), false);
});

test("pagamento aprovado fica pendente e não dispara confirmação", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, VENDA_APROVADA);
  const resposta = await pendente;

  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.sucessoTransacao, true);
  assert.equal(resposta.resultado.transacaoPendenteConfirmacao, true);
  assert.equal(resposta.resultado.confirmar, true);
  assert.equal(resposta.resultado.finalizacao, "FIN01");
  assert.equal(resposta.tef.transacaoPendenteConfirmacao, true);
  assert.equal(proc.stdin.partes.length, 2);
  assert.equal(proc.stdin.partes.some((linha) => linha.includes('"confirmar"')), false);

  const bloqueado = await gerenciador.pagar({ identificador: "VENDA-456", valor: 5 });
  assert.equal(bloqueado.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);
  assert.equal(bloqueado.statusHttp, 409);
  assert.equal(proc.stdin.partes.length, 2);
  assert.equal((await gerenciador.consultar()).transacaoPendenteConfirmacao, true);
});

test("confirmar transação libera um novo pagamento", async () => {
  const { gerenciador, processos, timers } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const venda = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, VENDA_APROVADA);
  await venda;

  const confirmacao = gerenciador.confirmar(PERNA_APROVADA);
  await ate(() => proc.stdin.partes.length === 3);
  await ate(() => timers.some((item) => !item.cancelado && item.ms === 60000));
  assert.equal(TIMEOUTS_TEF_MS.confirmacao, 60000);
  const pedido = ultimaLinha(proc);
  assert.equal(pedido.acao, "confirmar");
  assert.deepEqual(pedido.dados, PERNA_APROVADA);
  emitirPagamento(proc, {
    confirmada: true,
    desfeita: false,
    ...PERNA_APROVADA,
    transacaoPendenteConfirmacao: false,
    statusAcbr: "tefstsSucessoManual",
  });
  const resposta = await confirmacao;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.confirmada, true);
  assert.equal(resposta.tef.transacaoPendenteConfirmacao, false);

  const outra = gerenciador.pagar({ identificador: "VENDA-456", valor: 8 });
  await ate(() => proc.stdin.partes.length === 4);
  assert.equal(ultimaLinha(proc).acao, "pagamento");
  emitirPagamento(proc, { ...VENDA_APROVADA, transacaoPendenteConfirmacao: false, confirmar: false, precisaConfirmacao: false, sucessoTransacao: true });
  const liberada = await outra;
  assert.equal(liberada.ok, true);
  assert.equal((await gerenciador.consultar()).transacaoPendenteConfirmacao, false);
});

test("desfazer transação libera um novo pagamento", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const venda = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, VENDA_APROVADA);
  await venda;

  const desfazimento = gerenciador.desfazer(PERNA_APROVADA);
  await ate(() => proc.stdin.partes.length === 3);
  const pedido = ultimaLinha(proc);
  assert.equal(pedido.acao, "desfazer");
  assert.deepEqual(pedido.dados, PERNA_APROVADA);
  assert.equal(TIMEOUTS_TEF_MS.desfazimento, 60000);
  emitirPagamento(proc, {
    confirmada: false,
    desfeita: true,
    ...PERNA_APROVADA,
    transacaoPendenteConfirmacao: false,
    statusAcbr: "tefstsErroDiverso",
  });
  const resposta = await desfazimento;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.desfeita, true);
  assert.equal(resposta.tef.transacaoPendenteConfirmacao, false);

  const outra = gerenciador.pagar({ identificador: "VENDA-789", valor: 4 });
  await ate(() => proc.stdin.partes.length === 4);
  assert.equal(ultimaLinha(proc).acao, "pagamento");
  emitirPagamento(proc, {
    sucessoTransacao: false,
    transacaoPendenteConfirmacao: false,
    confirmar: false,
  });
  assert.equal((await outra).ok, true);
  assert.equal((await gerenciador.consultar()).inicializado, true);
});

test("processo morto mantém a pendência em disco e não confirma nem desfaz", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const venda = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, VENDA_APROVADA);
  await venda;
  assert.equal((await gerenciador.consultar()).transacaoPendenteConfirmacao, true);

  const linhas = proc.stdin.partes.length;
  proc.simularSaida(4);
  const status = await gerenciador.consultar();
  assert.equal(status.inicializado, false);
  assert.equal(status.processo, "erro");
  assert.equal(status.transacaoPendenteConfirmacao, true);
  assert.equal(status.reconciliacaoNecessaria, true);
  assert.equal(proc.stdin.partes.length, linhas);
  assert.equal(proc.stdin.partes.some((linha) => /"acao":"confirmar"|"acao":"desfazer"/.test(linha)), false);
  assert.equal(processos.length, 1);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "aguardando_decisao");
  assert.equal(disco.reconciliacaoNecessaria, true);
  assert.equal(disco.nsu, "123456");

  const novo = await gerenciador.pagar({ identificador: "VENDA-999", valor: 3 });
  assert.equal(novo.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);
  assert.match(novo.erro, /não foi confirmada nem desfeita/);
  assert.equal(processos.length, 1);
});

test("POST /tef/confirmar e POST /tef/desfazer usam o processo residente", async () => {
  const { spawn, processos } = spawnControlado();
  await comServidor(
    {
      localizarTefNativo: async () => ({ encontrado: true, caminho: caminhoNativo }),
      spawnTef: (arquivo, args, opcoes) => {
        const proc = spawn(arquivo, args, opcoes);
        const escrever = proc.stdin.write.bind(proc.stdin);
        proc.stdin.write = (chunk) => {
          escrever(chunk);
          const pedido = JSON.parse(String(chunk).trim());
          setImmediate(() => {
            if (pedido.acao === "inicializar") {
              proc.emitirStdout(
                `${JSON.stringify({
                  id: pedido.id,
                  ok: true,
                  resultado: {
                    inicializado: true,
                    modelo: "PayGoWeb",
                    confirmarTransacaoAutomaticamente: false,
                  },
                  erro: null,
                })}\n`
              );
              return;
            }
            if (pedido.acao === "pagamento") {
              proc.emitirStdout(
                `${JSON.stringify({
                  id: pedido.id,
                  ok: true,
                  resultado: VENDA_APROVADA,
                  erro: null,
                })}\n`
              );
              return;
            }
            if (pedido.acao === "confirmar" || pedido.acao === "desfazer") {
              proc.emitirStdout(
                `${JSON.stringify({
                  id: pedido.id,
                  ok: true,
                  resultado: {
                    confirmada: pedido.acao === "confirmar",
                    desfeita: pedido.acao === "desfazer",
                    rede: pedido.dados.rede,
                    nsu: pedido.dados.nsu,
                    finalizacao: pedido.dados.finalizacao,
                    transacaoPendenteConfirmacao: false,
                    statusAcbr:
                      pedido.acao === "confirmar" ? "tefstsSucessoManual" : "tefstsErroDiverso",
                  },
                  erro: null,
                })}\n`
              );
            }
          });
          return true;
        };
        return proc;
      },
    },
    async (base) => {
      assert.equal((await postJson(`${base}/tef/inicializar`, {})).status, 200);
      const pago = await postJson(`${base}/tef/pagamento`, {
        identificador: "VENDA-123",
        valor: 10,
      });
      assert.equal(pago.body.resultado.transacaoPendenteConfirmacao, true);
      assert.equal(pago.body.tef.transacaoPendenteConfirmacao, true);

      const bloqueado = await postJson(`${base}/tef/pagamento`, {
        identificador: "VENDA-456",
        valor: 5,
      });
      assert.equal(bloqueado.status, 409);
      assert.equal(bloqueado.body.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);

      const confirmado = await postJson(`${base}/tef/confirmar`, PERNA_APROVADA);
      assert.equal(confirmado.status, 200);
      assert.equal(confirmado.body.resultado.confirmada, true);
      assert.equal(confirmado.body.resultado.statusAcbr, "tefstsSucessoManual");
      assert.equal(confirmado.body.tef.transacaoPendenteConfirmacao, false);

      const pagoDeNovo = await postJson(`${base}/tef/pagamento`, {
        identificador: "VENDA-456",
        valor: 5,
      });
      assert.equal(pagoDeNovo.status, 200);
      assert.equal(pagoDeNovo.body.tef.transacaoPendenteConfirmacao, true);

      const desfeito = await postJson(`${base}/tef/desfazer`, PERNA_APROVADA);
      assert.equal(desfeito.status, 200);
      assert.equal(desfeito.body.resultado.desfeita, true);
      assert.equal(desfeito.body.resultado.statusAcbr, "tefstsErroDiverso");
      assert.equal(desfeito.body.tef.transacaoPendenteConfirmacao, false);
      assert.equal(desfeito.body.tef.inicializado, true);
      assert.equal(processos.length, 1);
      assert.equal(processos[0].opcoes.shell, false);
    }
  );
});

async function aprovarVenda(gerenciador, processos) {
  const proc = await deixarInicializado(gerenciador, processos);
  const venda = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, VENDA_APROVADA);
  const resposta = await venda;
  assert.equal(resposta.ok, true);
  return proc;
}

test("persistir pagamento aprovado e recuperar depois de reiniciar o gerenciador", async () => {
  const arquivoPendencia = path.join(
    os.tmpdir(),
    `ultrapdv-tef-vivo-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const primeiro = criarGerenciador({ arquivoPendencia });
  await aprovarVenda(primeiro.gerenciador, primeiro.processos);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "aguardando_decisao");
  assert.equal(disco.identificador, "VENDA-123");
  assert.equal(disco.valor, 10);
  assert.equal(disco.rede, "CIELO");
  assert.equal(disco.nsu, "123456");
  assert.equal(disco.finalizacao, "FIN01");
  assert.equal(disco.reconciliacaoNecessaria, false);
  assert.equal(typeof disco.registradoEm, "string");
  assert.ok(disco.registradoEm.length > 10);

  const segundo = criarGerenciador({ arquivoPendencia });
  const status = await segundo.gerenciador.consultar();
  assert.equal(status.transacaoPendenteConfirmacao, true);
  assert.equal(status.reconciliacaoNecessaria, true);
  const bloqueado = await segundo.gerenciador.pagar({ identificador: "VENDA-999", valor: 3 });
  assert.equal(bloqueado.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);
  assert.equal(segundo.processos.length, 0);

  const recuperado = await deixarInicializado(segundo.gerenciador, segundo.processos);
  const confirmacao = segundo.gerenciador.confirmar(PERNA_APROVADA);
  await ate(() => recuperado.stdin.partes.length === 2);
  assert.equal(ultimaLinha(recuperado).acao, "confirmar");
  emitirPagamento(recuperado, {
    confirmada: true,
    desfeita: false,
    ...PERNA_APROVADA,
    transacaoPendenteConfirmacao: false,
    proximaPendencia: null,
  });
  const resposta = await confirmacao;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.tef.transacaoPendenteConfirmacao, false);
  await assert.rejects(fs.access(arquivoPendencia));

  const terceiro = criarGerenciador({ arquivoPendencia });
  const livre = await terceiro.gerenciador.consultar();
  assert.equal(livre.transacaoPendenteConfirmacao, false);
  assert.equal(livre.reconciliacaoNecessaria, false);
});

test("desfazer remove a pendência persistida", async () => {
  const arquivoPendencia = path.join(
    os.tmpdir(),
    `ultrapdv-tef-desfaz-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const { gerenciador, processos } = criarGerenciador({ arquivoPendencia });
  const proc = await aprovarVenda(gerenciador, processos);
  const desfazimento = gerenciador.desfazer(PERNA_APROVADA);
  await ate(() => proc.stdin.partes.length === 3);
  emitirPagamento(proc, {
    confirmada: false,
    desfeita: true,
    ...PERNA_APROVADA,
    transacaoPendenteConfirmacao: false,
    proximaPendencia: null,
  });
  const resposta = await desfazimento;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.tef.transacaoPendenteConfirmacao, false);
  await assert.rejects(fs.access(arquivoPendencia));
  const outro = gerenciador.pagar({ identificador: "VENDA-2", valor: 4 });
  await ate(() => proc.stdin.partes.length === 4);
  emitirPagamento(proc, { sucessoTransacao: false, transacaoPendenteConfirmacao: false, confirmar: false });
  assert.equal((await outro).ok, true);
});

test("timeout ao confirmar ou desfazer mantém a pendência", async () => {
  for (const acao of ["confirmar", "desfazer"]) {
    const arquivoPendencia = path.join(
      os.tmpdir(),
      `ultrapdv-tef-timeout-${acao}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );
    const { gerenciador, processos, timers } = criarGerenciador({ arquivoPendencia });
    await aprovarVenda(gerenciador, processos);
    const pendente = gerenciador[acao](PERNA_APROVADA);
    await ate(() => timers.some((item) => !item.cancelado && item.ms === 60000));
    timers.find((item) => !item.cancelado && item.ms === 60000).fn();
    const resposta = await pendente;
    assert.equal(resposta.codigo, CODIGOS_TEF.TIMEOUT);
    const status = await gerenciador.consultar();
    assert.equal(status.transacaoPendenteConfirmacao, true);
    assert.equal(status.reconciliacaoNecessaria, true);
    const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
    assert.equal(disco.status, "aguardando_decisao");
    assert.equal(disco.nsu, "123456");
    assert.equal(disco.reconciliacaoNecessaria, true);
    const bloqueado = await gerenciador.pagar({ identificador: "VENDA-9", valor: 2 });
    assert.equal(bloqueado.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);
  }
});

test("arquivo de pendência incompleto não libera pagamento", async () => {
  const arquivoPendencia = path.join(
    os.tmpdir(),
    `ultrapdv-tef-corrupto-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  await fs.writeFile(arquivoPendencia, '{"status":"aguardando_decisao"', "utf8");
  const { gerenciador, processos } = criarGerenciador({ arquivoPendencia });
  const resposta = await gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  assert.equal(resposta.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);
  assert.equal(resposta.statusHttp, 409);
  const status = await gerenciador.consultar();
  assert.equal(status.transacaoPendenteConfirmacao, true);
  assert.equal(status.reconciliacaoNecessaria, true);
  assert.equal(await fs.readFile(arquivoPendencia, "utf8"), '{"status":"aguardando_decisao"');
  assert.equal(processos.length, 0);
});

function arquivoJournal(nome) {
  return path.join(
    os.tmpdir(),
    `ultrapdv-tef-journal-${nome}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
}

function journalTef(status, extra = {}) {
  return {
    versao: 1,
    status,
    identificador: "VENDA-123",
    valor: 10,
    dataHoraInicio: "2026-10-07T12:00:00.000Z",
    correlationId: "id-pag-1",
    reconciliacaoNecessaria: status !== "pagamento_em_andamento",
    rede: "",
    nsu: "",
    finalizacao: "",
    registradoEm: "2026-10-07T12:00:00.000Z",
    confirmar: false,
    precisaConfirmacao: false,
    ...extra,
  };
}

function fsQueFalhaAoAbrir() {
  return {
    mkdir: (...args) => fs.mkdir(...args),
    readFile: (...args) => fs.readFile(...args),
    rename: (...args) => fs.rename(...args),
    unlink: (...args) => fs.unlink(...args),
    open: async () => {
      const erro = new Error("falha de disco");
      erro.code = "EIO";
      throw erro;
    },
  };
}

test("falha ao persistir antes do pagamento não chama o nativo", async () => {
  const { gerenciador, processos } = criarGerenciador({
    deps: { fsPendencia: fsQueFalhaAoAbrir() },
  });
  const proc = await deixarInicializado(gerenciador, processos);
  const resposta = await gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  assert.equal(resposta.codigo, CODIGOS_TEF.PERSISTENCIA_FALHOU);
  assert.equal(resposta.statusHttp, 500);
  assert.equal(resposta.erro, "Não foi possível gravar o estado do TEF. O pagamento não foi enviado.");
  assert.equal(proc.stdin.partes.length, 1);
  assert.equal(proc.stdin.partes.some((linha) => linha.includes('"pagamento"')), false);
  assert.equal(processos.length, 1);
  const status = await gerenciador.consultar();
  assert.equal(status.transacaoPendenteConfirmacao, false);
  assert.equal(status.reconciliacaoNecessaria, false);
});

test("journal pagamento_em_andamento é gravado antes de chamar o nativo", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  let visto = null;
  const escrever = proc.stdin.write.bind(proc.stdin);
  proc.stdin.write = (chunk) => {
    const texto = String(chunk);
    if (texto.includes('"acao":"pagamento"')) {
      visto = JSON.parse(readFileSync(arquivoPendencia, "utf8"));
    }
    return escrever(chunk);
  };
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  assert.equal(visto.status, "pagamento_em_andamento");
  assert.equal(visto.identificador, "VENDA-123");
  assert.equal(visto.valor, 10);
  assert.equal(visto.reconciliacaoNecessaria, false);
  assert.equal(typeof visto.dataHoraInicio, "string");
  assert.ok(visto.dataHoraInicio.length > 10);
  assert.equal(visto.correlationId, ultimaLinha(proc).id);
  emitirPagamento(proc, {
    sucessoTransacao: false,
    confirmar: false,
    precisaConfirmacao: false,
    transacaoPendenteConfirmacao: false,
  });
  assert.equal((await pendente).ok, true);
});

test("aprovado transforma o journal em aguardando_decisao", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  const correlationId = ultimaLinha(proc).id;
  emitirPagamento(proc, VENDA_APROVADA);
  const resposta = await pendente;
  assert.equal(resposta.ok, true);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "aguardando_decisao");
  assert.equal(disco.rede, "CIELO");
  assert.equal(disco.nsu, "123456");
  assert.equal(disco.finalizacao, "FIN01");
  assert.equal(disco.identificador, "VENDA-123");
  assert.equal(disco.valor, 10);
  assert.equal(disco.correlationId, correlationId);
  assert.equal(disco.reconciliacaoNecessaria, false);
  assert.equal(typeof disco.dataHoraInicio, "string");
});

test("transação negada remove o journal", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  const antes = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(antes.status, "pagamento_em_andamento");
  emitirPagamento(proc, {
    sucessoChamada: true,
    sucessoTransacao: false,
    confirmar: false,
    precisaConfirmacao: false,
    transacaoPendenteConfirmacao: false,
    mensagem: "NEGADO",
  });
  const resposta = await pendente;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.mensagem, "NEGADO");
  await assert.rejects(fs.access(arquivoPendencia));
  const status = await gerenciador.consultar();
  assert.equal(status.transacaoPendenteConfirmacao, false);
  assert.equal(status.reconciliacaoNecessaria, false);
});

test("timeout do pagamento transforma o journal em resultado_desconhecido", async () => {
  const { gerenciador, processos, timers, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => timers.some((item) => !item.cancelado && item.ms === 300000));
  timers.find((item) => !item.cancelado && item.ms === 300000).fn();
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.TIMEOUT);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "resultado_desconhecido");
  assert.equal(disco.reconciliacaoNecessaria, true);
  assert.equal(disco.identificador, "VENDA-123");
  assert.equal(disco.valor, 10);
  const novo = await gerenciador.pagar({ identificador: "VENDA-2", valor: 4 });
  assert.equal(novo.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(novo.statusHttp, 409);
  assert.equal(proc.stdin.partes.length, 2);
  assert.equal(proc.killed, false);
});

test("processo morto durante o pagamento vira resultado_desconhecido", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  proc.simularSaida(7);
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.PROCESSO_ENCERRADO);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "resultado_desconhecido");
  assert.equal(disco.reconciliacaoNecessaria, true);
  assert.equal(disco.correlationId, JSON.parse(proc.stdin.partes[1]).id);
  const novo = await gerenciador.pagar({ identificador: "VENDA-2", valor: 4 });
  assert.equal(novo.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(processos.length, 1);
});

test("resposta inválida mantém resultado_desconhecido", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const pendente = gerenciador.pagar({ identificador: "VENDA-123", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, { sucessoChamada: true });
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(resposta.ok, false);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "resultado_desconhecido");
  assert.equal(disco.reconciliacaoNecessaria, true);
  const novo = await gerenciador.pagar({ identificador: "VENDA-2", valor: 4 });
  assert.equal(novo.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(proc.stdin.partes.length, 2);
});

test("restart com pagamento_em_andamento vira resultado_desconhecido", async () => {
  const arquivoPendencia = arquivoJournal("andamento");
  await fs.writeFile(
    arquivoPendencia,
    `${JSON.stringify(journalTef("pagamento_em_andamento"), null, 2)}\n`,
    "utf8"
  );
  const { gerenciador, processos } = criarGerenciador({ arquivoPendencia });
  const status = await gerenciador.consultar();
  assert.equal(status.transacaoPendenteConfirmacao, true);
  assert.equal(status.reconciliacaoNecessaria, true);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "resultado_desconhecido");
  assert.equal(disco.reconciliacaoNecessaria, true);
  assert.equal(disco.identificador, "VENDA-123");
  assert.equal(disco.valor, 10);
  assert.equal(disco.correlationId, "id-pag-1");
  assert.equal(disco.dataHoraInicio, "2026-10-07T12:00:00.000Z");
  const novo = await gerenciador.pagar({ identificador: "VENDA-2", valor: 4 });
  assert.equal(novo.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(processos.length, 0);
});

test("restart com resultado_desconhecido continua bloqueando", async () => {
  const arquivoPendencia = arquivoJournal("desconhecido");
  const original = journalTef("resultado_desconhecido");
  await fs.writeFile(arquivoPendencia, `${JSON.stringify(original, null, 2)}\n`, "utf8");
  const { gerenciador, processos } = criarGerenciador({ arquivoPendencia });
  const status = await gerenciador.consultar();
  assert.equal(status.reconciliacaoNecessaria, true);
  assert.equal(status.transacaoPendenteConfirmacao, true);
  const pago = await gerenciador.pagar({ identificador: "VENDA-2", valor: 4 });
  assert.equal(pago.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(pago.statusHttp, 409);
  const cancelado = await gerenciador.executar({ acao: "cancelamento" });
  assert.equal(cancelado.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  const administrativa = await gerenciador.executar({ acao: "administrativa" });
  assert.equal(administrativa.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(processos.length, 0);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "resultado_desconhecido");
  assert.equal(disco.correlationId, "id-pag-1");
  assert.equal(disco.reconciliacaoNecessaria, true);
});

test("evento de pendência recupera rede, NSU e finalização", async () => {
  const arquivoPendencia = arquivoJournal("evento");
  await fs.writeFile(
    arquivoPendencia,
    `${JSON.stringify(journalTef("resultado_desconhecido"), null, 2)}\n`,
    "utf8"
  );
  const { gerenciador, processos } = criarGerenciador({ arquivoPendencia });
  const inicio = gerenciador.inicializar();
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido = ultimaLinha(processos[0]);
  processos[0].emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: true,
      resultado: {
        inicializado: true,
        pendenciaDetectada: true,
        pendenciasDetectadas: 1,
        pendencia: {
          rede: "CIELO",
          nsu: "999888",
          finalizacao: "FIN99",
          identificador: "VENDA-123",
          valor: 10,
        },
      },
      erro: null,
    })}\n`
  );
  const resposta = await inicio;
  assert.equal(resposta.ok, true);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "aguardando_decisao");
  assert.equal(disco.rede, "CIELO");
  assert.equal(disco.nsu, "999888");
  assert.equal(disco.finalizacao, "FIN99");
  assert.equal(disco.identificador, "VENDA-123");
  assert.equal(disco.correlationId, "id-pag-1");
  assert.equal(disco.dataHoraInicio, "2026-10-07T12:00:00.000Z");

  const confirmacao = gerenciador.confirmar({
    rede: "CIELO",
    nsu: "999888",
    finalizacao: "FIN99",
  });
  await ate(() => processos[0].stdin.partes.length === 2);
  assert.equal(ultimaLinha(processos[0]).acao, "confirmar");
  emitirPagamento(processos[0], {
    confirmada: true,
    desfeita: false,
    rede: "CIELO",
    nsu: "999888",
    finalizacao: "FIN99",
    transacaoPendenteConfirmacao: false,
    proximaPendencia: null,
  });
  const confirmado = await confirmacao;
  assert.equal(confirmado.ok, true);
  assert.equal(confirmado.tef.transacaoPendenteConfirmacao, false);
  await assert.rejects(fs.access(arquivoPendencia));
});

test("ausência de evento não libera operação", async () => {
  const arquivoPendencia = arquivoJournal("sem-evento");
  await fs.writeFile(
    arquivoPendencia,
    `${JSON.stringify(journalTef("resultado_desconhecido"), null, 2)}\n`,
    "utf8"
  );
  const { gerenciador, processos } = criarGerenciador({ arquivoPendencia });
  const inicio = gerenciador.inicializar();
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responderInicializacao(processos[0]);
  const resposta = await inicio;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.tef.reconciliacaoNecessaria, true);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "resultado_desconhecido");
  assert.equal(disco.reconciliacaoNecessaria, true);
  assert.equal(disco.correlationId, "id-pag-1");
  const novo = await gerenciador.pagar({ identificador: "VENDA-2", valor: 4 });
  assert.equal(novo.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(processos[0].stdin.partes.length, 1);
  assert.equal(processos.length, 1);
});

test("instalação nativa usa PWOPER_INSTALL e configura o ponto antes de inicializar", () => {
  const fonte = readFileSync(
    fileURLToPath(new URL("../../tef-agent/UltraPDVTef.lpr", import.meta.url)),
    "utf8"
  );
  const inicializar = fonte.indexOf("TEF.Inicializar;");
  const antes = fonte.slice(0, inicializar);
  assert.equal(fonte.includes("117473"), false);
  assert.equal(fonte.includes("42.741.754/0001-42"), false);
  assert.equal(fonte.includes("42741754000142"), false);
  assert.equal(fonte.includes("pos-transac-sb.tpgweb.io"), false);
  assert.ok(antes.includes("ambNaoDefinido"));
  assert.ok(antes.includes("TEF_PARAMETROS_AUSENTES"));
  assert.ok(antes.includes("TEF_IDENTIDADE_DIVERGENTE"));
  assert.ok(antes.includes("1.3.3"));
  assert.match(antes, /TextoDados\(Dados, 'ambiente'\) = 'producao'/);
  assert.match(antes, /Ambiente := ambHomologacao/);
  assert.match(fonte, /TEF\.EfetuarAdministrativa\(IntToStr\(PWOPER_INSTALL\)\)/);
  const instalarFonte = fonte.slice(
    fonte.indexOf("procedure InstalarTEF"),
    fonte.indexOf("procedure PagarTEF")
  );
  assert.ok(instalarFonte.indexOf("if not IdentidadeNova") < instalarFonte.indexOf("EfetuarAdministrativa"));
  assert.ok(
    instalarFonte.indexOf("PedidoRepeteIdentidade") < instalarFonte.indexOf("EfetuarAdministrativa")
  );
  assert.equal(fonte.includes("tefopAdministrativo"), false);
  const instalar = fonte.slice(
    fonte.indexOf("procedure InstalarTEF"),
    fonte.indexOf("procedure PagarTEF")
  );
  assert.ok(instalar.includes("Resultado.Add('rede', Resp.Rede)"));
  assert.ok(instalar.includes("Resultado.Add('nsu', Resp.NSU)"));
  assert.ok(instalar.includes("Resultado.Add('finalizacao', Resp.Finalizacao)"));
  assert.equal(instalar.includes("RemoverPendencia"), false);
  assert.equal(instalar.includes("GuardarPendencia"), false);
  assert.equal(instalar.includes("FinalizarTransacao"), false);
  assert.ok(instalar.includes("DiagnosticoInstalacao := True"));
  assert.ok(fonte.includes("'QuandoExibirMensagem'"));
  assert.ok(fonte.includes("'QuandoPerguntarMenu'"));
  assert.ok(fonte.includes("'QuandoPerguntarCampo'"));
  assert.ok(fonte.includes("LogErro('[ACBrTEF] ' + Mensagem)"));
});

test("instalação responde só a senha técnica e o log não leva o valor", () => {
  const fonte = readFileSync(
    fileURLToPath(new URL("../../tef-agent/UltraPDVTef.lpr", import.meta.url)),
    "utf8"
  );
  const campo = fonte.slice(
    fonte.indexOf("procedure TEventosTEF.QuandoPerguntarCampo"),
    fonte.indexOf("procedure TEventosTEF.QuandoExibirQRCode")
  );
  const menu = fonte.slice(
    fonte.indexOf("procedure TEventosTEF.QuandoPerguntarMenu"),
    fonte.indexOf("procedure TEventosTEF.QuandoPerguntarCampo")
  );
  const senha = campo.indexOf("PerguntaSenhaTecnica(DefinicaoCampo.TituloPergunta)");
  const fornece = campo.indexOf("Resposta := SENHA_TECNICA_INSTALACAO;");
  const valida = campo.indexOf("Validado := True;");
  const segue = campo.indexOf("Cancelado := False;");
  const sai = campo.indexOf("Exit;");
  const cancela = campo.indexOf("Resposta := '';");
  assert.ok(campo.indexOf("DiagnosticoInstalacao and") >= 0);
  assert.ok(senha > 0 && fornece > senha && valida > fornece && segue > valida && sai > segue);
  assert.ok(cancela > sai);
  assert.match(campo, /Validado := False;/);
  assert.match(campo, /Cancelado := True;/);
  assert.match(
    campo,
    /callback=QuandoPerguntarCampo' \+\s*' campo=senha_tecnica resposta=fornecida'/
  );
  assert.equal(campo.includes("314159"), false);
  assert.equal(menu.includes("SENHA_TECNICA_INSTALACAO"), false);
  assert.equal(menu.includes("ItemSelecionado := -1"), true);
  const semConstante = fonte.replace("SENHA_TECNICA_INSTALACAO = '314159';", "");
  assert.equal(semConstante.includes("314159"), false);
  assert.equal(fonteTef.includes("314159"), false);
  assert.equal(
    readFileSync(fileURLToPath(new URL("./server.mjs", import.meta.url)), "utf8").includes(
      "314159"
    ),
    false
  );
  const normalizar = fonte.slice(
    fonte.indexOf("function NormalizarPergunta"),
    fonte.indexOf("procedure TEventosTEF.QuandoFinalizarOperacao")
  );
  assert.match(normalizar, /INFORME A SENHA TECNICA/);
  assert.match(normalizar, /TiraAcentos/);
});

test("pagamento apresenta menu interativo e mantém cancelamento como padrão seguro", () => {
  const fonte = readFileSync(
    fileURLToPath(new URL("../../tef-agent/UltraPDVTef.lpr", import.meta.url)),
    "utf8"
  );
  const menu = fonte.slice(
    fonte.indexOf("procedure TEventosTEF.QuandoPerguntarMenu"),
    fonte.indexOf("procedure TEventosTEF.QuandoPerguntarCampo")
  );
  const textoMenu = fonte.slice(
    fonte.indexOf("function TextoMenuSeguro"),
    fonte.indexOf("procedure LogMenuPagamento")
  );
  const logMenu = fonte.slice(
    fonte.indexOf("procedure LogMenuPagamento"),
    fonte.indexOf("procedure TEventosTEF.QuandoFinalizarOperacao")
  );
  const pagar = fonte.slice(
    fonte.indexOf("procedure PagarTEF"),
    fonte.indexOf("function LerTextoObrigatorio")
  );
  const instalar = fonte.slice(
    fonte.indexOf("procedure InstalarTEF"),
    fonte.indexOf("procedure PagarTEF")
  );
  assert.match(logMenu, /callback=QuandoPerguntarMenu titulo="/);
  assert.match(logMenu, /opcoes=/);
  assert.match(logMenu, /menu\[' \+ IntToStr\(i\) \+ '\]="/);
  assert.match(logMenu, /for i := 0 to Total - 1 do/);
  assert.match(logMenu, /TextoMenuSeguro\(Opcoes\[i\]\)/);
  assert.match(logMenu, /TextoMenuSeguro\(Titulo\)/);
  assert.match(textoMenu, /SanitizarTextoDiagnostico/);
  assert.equal(logMenu.includes("ItemSelecionado"), false);
  assert.match(menu, /if DiagnosticoPagamento then\s+LogMenuPagamento\(Titulo, Opcoes\)/);
  assert.equal(menu.includes("ItemSelecionado := -1"), true);
  assert.equal(menu.includes("ItemSelecionado :="), true);
  assert.equal((menu.match(/ItemSelecionado :=/g) || []).length, 2);
  assert.match(menu, /EventoMenu.Add\('tipo', 'menu'\)/);
  assert.match(menu, /EventoMenu.Add\('solicitacaoId',/);
  assert.match(menu, /ItemSelecionado := AguardarRespostaMenu\(/);
  assert.ok(menu.indexOf("ItemSelecionado := AguardarRespostaMenu(") > menu.indexOf("ItemSelecionado := -1"));
  assert.match(pagar, /DiagnosticoPagamento := True;/);
  assert.ok(
    pagar.indexOf("DiagnosticoPagamento := True;") <
      pagar.indexOf("TEF.EfetuarPagamento(Identificador, Valor);")
  );
  assert.ok(
    pagar.indexOf("TEF.EfetuarPagamento(Identificador, Valor);") <
      pagar.indexOf("DiagnosticoPagamento := False;")
  );
  assert.equal(instalar.includes("DiagnosticoPagamento"), false);
  assert.equal(logMenu.includes("314159"), false);
  assert.match(fonteTef, /\[ACBrTEF\]\[pagamento\]/);
});

test("diagnóstico da instalação preserva o texto e omite segredo", async () => {
  const texto = preservarDiagnosticoInstalacao(
    "[ACBrTEF][instalar] callback=QuandoExibirMensagem tela=telaOperador texto=CNPJ 42.741.754/0001-42 senha 1234 cvv 123"
  );
  assert.match(texto, /callback=QuandoExibirMensagem/);
  assert.match(texto, /CNPJ/);
  assert.match(texto, /senha/);
  assert.equal(texto.includes("42741754"), false);
  assert.equal(texto.includes("1234"), false);
  assert.match(texto, /cvv \[omitido\]/);
  assert.match(fonteTef, /diagnosticoInstalacao/);
  assert.match(fonteTef, /\[ACBrTEF\]\[instalar\]/);
});

test("instalação exige TEF inicializado, usa timeout de 300s e não cria journal", async () => {
  const { gerenciador, processos, timers, arquivoPendencia } = criarGerenciador();
  const cedo = await gerenciador.instalar();
  assert.equal(cedo.codigo, CODIGOS_TEF.NAO_INICIALIZADO);
  assert.equal(cedo.statusHttp, 409);
  assert.equal(processos.length, 0);

  const proc = await deixarInicializadoParaInstalar(gerenciador, processos);
  const pendente = gerenciador.instalar(IDENTIDADE_INSTALACAO);
  await ate(() => proc.stdin.partes.length === 2);
  await ate(() => timers.some((item) => !item.cancelado && item.ms === 300000));
  const pedido = ultimaLinha(proc);
  assert.equal(pedido.acao, "instalar");
  assert.deepEqual(pedido.dados, {
    pontoCaptura: "200001",
    ambiente: "homologacao",
    cnpj: "11222333000181",
    servidor: "tef.cliente.example:31735",
    estabelecimento: "LOJA NOVA",
  });
  assert.equal(TIMEOUTS_TEF_MS.instalacao, 300000);
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: true,
        resultado: {
        sucessoChamada: true,
        sucessoTransacao: true,
        operacao: "PWOPER_INSTALL",
        codigoOperacao: 1,
        mensagem: "Ponto de captura instalado",
        rede: "",
        nsu: "",
        finalizacao: "",
      },
      erro: null,
    })}\n`
  );
  const resposta = await pendente;
  assert.equal(resposta.ok, true);
  assert.equal(resposta.resultado.operacao, "PWOPER_INSTALL");
  assert.equal(resposta.resultado.sucessoChamada, true);
  assert.equal(resposta.resultado.sucessoTransacao, true);
  assert.equal(resposta.resultado.mensagem, "Ponto de captura instalado");
  assert.equal(resposta.resultado.rede, "");
  assert.equal(resposta.resultado.nsu, "");
  assert.equal(resposta.resultado.finalizacao, "");
  assert.equal(resposta.tef.inicializado, true);
  assert.equal(resposta.tef.transacaoPendenteConfirmacao, false);
  assert.equal(resposta.tef.reconciliacaoNecessaria, false);
  await assert.rejects(fs.access(arquivoPendencia));
  assert.equal(proc.stdin.partes.some((linha) => linha.includes('"pagamento"')), false);
});

test("instalação negada devolve o erro e não cria journal", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializadoParaInstalar(gerenciador, processos);
  const pendente = gerenciador.instalar(IDENTIDADE_INSTALACAO);
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, {
    sucessoChamada: true,
    sucessoTransacao: false,
    operacao: "PWOPER_INSTALL",
    mensagem: "Instalacao nao concluida",
    rede: "",
    nsu: "",
    finalizacao: "",
  });
  const negada = await pendente;
  assert.equal(negada.ok, true);
  assert.equal(negada.resultado.sucessoTransacao, false);
  assert.equal(negada.resultado.mensagem, "Instalacao nao concluida");
  await assert.rejects(fs.access(arquivoPendencia));

  const falha = gerenciador.instalar(IDENTIDADE_INSTALACAO);
  await ate(() => proc.stdin.partes.length === 3);
  const pedido = ultimaLinha(proc);
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: false,
      resultado: {},
      erro: "E necessario efetuar uma transacao de Instalacao",
    })}\n`
  );
  const erro = await falha;
  assert.equal(erro.ok, false);
  assert.equal(erro.erro, "E necessario efetuar uma transacao de Instalacao");
  await assert.rejects(fs.access(arquivoPendencia));
  assert.equal((await gerenciador.consultar()).transacaoPendenteConfirmacao, false);
});

test("timeout da instalação é 300 segundos e não cria journal", async () => {
  const { gerenciador, processos, timers, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializadoParaInstalar(gerenciador, processos);
  const pendente = gerenciador.instalar(IDENTIDADE_INSTALACAO);
  await ate(() => timers.some((item) => !item.cancelado && item.ms === 300000));
  const timer = timers.find((item) => !item.cancelado && item.ms === 300000);
  timer.fn();
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.TIMEOUT);
  assert.equal(resposta.statusHttp, 504);
  assert.equal(proc.killed, false);
  assert.equal(proc.exitCode, null);
  const status = await gerenciador.consultar();
  assert.equal(status.inicializado, true);
  assert.equal(status.transacaoPendenteConfirmacao, false);
  assert.equal(status.reconciliacaoNecessaria, false);
  await assert.rejects(fs.access(arquivoPendencia));
});

test("processo encerrado durante a instalação não cria journal", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializadoParaInstalar(gerenciador, processos);
  const pendente = gerenciador.instalar(IDENTIDADE_INSTALACAO);
  await ate(() => proc.stdin.partes.length === 2);
  assert.equal(ultimaLinha(proc).acao, "instalar");
  proc.simularSaida(9);
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.PROCESSO_ENCERRADO);
  assert.equal(resposta.statusHttp, 503);
  const status = await gerenciador.consultar();
  assert.equal(status.inicializado, false);
  assert.equal(status.transacaoPendenteConfirmacao, false);
  assert.equal(status.reconciliacaoNecessaria, false);
  await assert.rejects(fs.access(arquivoPendencia));
  assert.equal(processos.length, 1);
});

test("instalação não apaga journal de venda aguardando decisão", async () => {
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await aprovarVenda(gerenciador, processos);
  const discoAntes = await fs.readFile(arquivoPendencia, "utf8");
  const resposta = await gerenciador.instalar();
  assert.equal(resposta.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);
  assert.equal(resposta.statusHttp, 409);
  assert.equal(proc.stdin.partes.length, 2);
  assert.equal(proc.stdin.partes.some((linha) => linha.includes('"instalar"')), false);
  assert.equal(await fs.readFile(arquivoPendencia, "utf8"), discoAntes);
});

test("instalação com resultado desconhecido continua bloqueada", async () => {
  const arquivoPendencia = arquivoJournal("instalar-desconhecido");
  await fs.writeFile(
    arquivoPendencia,
    `${JSON.stringify(journalTef("resultado_desconhecido"), null, 2)}\n`,
    "utf8"
  );
  const { gerenciador, processos } = criarGerenciador({ arquivoPendencia });
  const resposta = await gerenciador.instalar();
  assert.equal(resposta.codigo, CODIGOS_TEF.RECONCILIACAO_NECESSARIA);
  assert.equal(resposta.statusHttp, 409);
  assert.equal(processos.length, 0);
  const disco = JSON.parse(await fs.readFile(arquivoPendencia, "utf8"));
  assert.equal(disco.status, "resultado_desconhecido");
  assert.equal(disco.correlationId, "id-pag-1");
});

test("POST /tef/instalar recusa parâmetros livres e encaminha a ação", async () => {
  const { spawn, processos } = spawnControlado();
  await comServidor(
    {
      localizarTefNativo: async () => ({ encontrado: true, caminho: caminhoNativo }),
      spawnTef: (arquivo, args, opcoes) => {
        const proc = spawn(arquivo, args, opcoes);
        const escrever = proc.stdin.write.bind(proc.stdin);
        proc.stdin.write = (chunk) => {
          escrever(chunk);
          const pedido = JSON.parse(String(chunk).trim());
          setImmediate(() => {
            if (pedido.acao === "inicializar") {
              proc.emitirStdout(
                `${JSON.stringify({
                  id: pedido.id,
                  ok: true,
                  resultado: { inicializado: true, modelo: "PayGoWeb" },
                  erro: null,
                })}\n`
              );
              return;
            }
            if (pedido.acao === "instalar") {
              proc.emitirStdout(
                `${JSON.stringify({
                  id: pedido.id,
                  ok: true,
                  resultado: {
                    sucessoChamada: true,
                    sucessoTransacao: true,
                    operacao: "PWOPER_INSTALL",
                    mensagem: "Ponto de captura instalado",
                  },
                  erro: null,
                })}\n`
              );
            }
          });
          return true;
        };
        return proc;
      },
    },
    async (base) => {
      const dll = await postJson(`${base}/tef/instalar`, { dll: "C:\\PayGo\\PGWebLib.dll" });
      assert.equal(dll.status, 400);
      assert.equal(dll.body.erro, "Payload recusado.");

      const caminho = await postJson(`${base}/tef/instalar`, {
        path: "C:\\Windows\\System32\\cmd.exe",
      });
      assert.equal(caminho.status, 400);
      assert.equal(caminho.body.erro, "Payload recusado.");

      const ponto = await postJson(`${base}/tef/instalar`, {
        cnpj: "42.741.754/0001-42",
        servidor: "pos-transac-sb.tpgweb.io:31735",
      });
      assert.equal(ponto.status, 400);
      assert.equal(ponto.body.erro, "Payload recusado.");

      const simulada = await postJson(`${base}/tef/instalar`, {
        pontoNaoExistia: true,
        retornoSetEnvironment: 0,
        instalacaoConcluida: true,
        observacaoBiblioteca: true,
      });
      assert.equal(simulada.status, 400);
      assert.equal(simulada.body.erro, "Payload recusado.");

      const cedo = await postJson(`${base}/tef/instalar`, {});
      assert.equal(cedo.status, 409);
      assert.equal(cedo.body.codigo, CODIGOS_TEF.NAO_INICIALIZADO);
      assert.equal(processos.length, 0);

      assert.equal((await postJson(`${base}/tef/inicializar`, {})).status, 200);
      const instalado = await postJson(`${base}/tef/instalar`, {});
      assert.equal(instalado.status, 400);
      assert.equal(instalado.body.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
      assert.equal(instalado.body.evidencia, null);
      assert.equal(instalado.body.tef.inicializado, true);
      assert.equal(processos.length, 1);
      assert.equal(processos[0].opcoes.shell, false);
      const linhas = processos[0].stdin.partes.join("");
      assert.equal(linhas.includes('"acao":"inicializar"'), true);
      assert.equal(linhas.includes('"acao":"instalar"'), false);
      assert.equal(linhas.includes("117473"), false);
      assert.equal(linhas.includes("pos-transac-sb.tpgweb.io"), false);
      assert.equal(linhas.includes("42741754000142"), false);
      assert.equal(linhas.includes("PGWebLib.dll"), false);
    }
  );
});

test("transação de teste não é confirmada no processo nativo", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos);
  const venda = gerenciador.pagar({ identificador: "TESTE0001", valor: 10 });
  await ate(() => proc.stdin.partes.length === 2);
  emitirPagamento(proc, { ...VENDA_APROVADA, identificador: "TESTE0001" });
  const aprovada = await venda;
  assert.equal(aprovada.ok, true);
  const confirmacao = await gerenciador.confirmar(PERNA_APROVADA);
  assert.equal(confirmacao.ok, false);
  assert.equal(confirmacao.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal(proc.stdin.partes.length, 2);
});

test("terminal vinculado recusa outra empresa e aceita a dona no cabeçalho", async () => {
  const empresaA = "11111111-1111-4111-8111-111111111111";
  const empresaB = "22222222-2222-4222-8222-222222222222";
  await comServidor(
    {
      lerVinculoTef: async () => ({
        empresaId: empresaA,
        terminalCodigo: "CX01",
        dispositivoId: empresaA,
      }),
    },
    async (base) => {
      const outra = await postJson(
        `${base}/tef/pagamento`,
        { acao: "pagamento", identificador: "VENDA-1", valor: 10 },
        { "x-ultrapdv-empresa": empresaB, "x-ultrapdv-terminal": "CX01" }
      );
      assert.equal(outra.status, 403);
      const anonima = await postJson(`${base}/tef/pagamento`, {
        acao: "pagamento",
        identificador: "VENDA-1",
        valor: 10,
      });
      assert.equal(anonima.status, 403);
      const dona = await postJson(
        `${base}/tef/pagamento`,
        { acao: "pagamento", identificador: "VENDA-1", valor: 10 },
        { "x-ultrapdv-empresa": empresaA, "x-ultrapdv-terminal": "CX01" }
      );
      assert.notEqual(dona.status, 403);
      const confirmarOutra = await postJson(
        `${base}/tef/confirmar`,
        { acao: "confirmar", ...PERNA_APROVADA },
        { "x-ultrapdv-empresa": empresaB, "x-ultrapdv-terminal": "CX01" }
      );
      assert.equal(confirmarOutra.status, 403);
    }
  );
});

test("vínculo local não troca de empresa e exige o dispositivo deste Connector", async () => {
  const empresaA = "11111111-1111-4111-8111-111111111111";
  const empresaB = "22222222-2222-4222-8222-222222222222";
  let vinculo = null;
  await comServidor(
    {
      lerVinculoTef: async () => vinculo,
      gravarVinculoTef: async (proximo) => {
        vinculo = proximo;
      },
      removerVinculoTef: async () => {
        vinculo = null;
      },
    },
    async (base) => {
      const semCodigo = await postJson(`${base}/tef/vincular`, {
        empresaId: empresaA,
        terminalCodigo: "CX01",
        dispositivoId: empresaA,
        estabelecimento: "LOJA",
        pontoCaptura: "001",
      });
      assert.equal(semCodigo.status, 403);
      const origemEstranha = await getJson(`${base}/tef/pareamento`, {
        origin: "https://ultrapdv.app",
      });
      assert.equal(origemEstranha.status, 403);
      assert.equal(origemEstranha.body.codigo, undefined);
      const codigoLocal = await getJson(`${base}/tef/pareamento`);
      assert.equal(codigoLocal.status, 200);
      assert.equal(String(codigoLocal.body.codigo).length, 10);
      const dispositivoErrado = await postJson(`${base}/tef/vincular`, {
        codigo: codigoLocal.body.codigo,
        empresaId: empresaA,
        terminalCodigo: "CX01",
        dispositivoId: "99999999-9999-4999-8999-999999999999",
        estabelecimento: "LOJA",
        pontoCaptura: "001",
      });
      assert.equal(dispositivoErrado.status, 403);
      const pareado = await postJson(`${base}/tef/vincular`, {
        codigo: codigoLocal.body.codigo,
        empresaId: empresaA,
        terminalCodigo: "CX01",
        dispositivoId: empresaA,
        estabelecimento: "LOJA",
        pontoCaptura: "001",
      });
      assert.equal(pareado.status, 200);
      assert.equal(pareado.body.vinculo.empresaId, empresaA);
      assert.equal(pareado.body.vinculo.estabelecimento, "LOJA");
      const novoCodigo = await getJson(`${base}/tef/pareamento`);
      const troca = await postJson(`${base}/tef/vincular`, {
        codigo: novoCodigo.body.codigo,
        empresaId: empresaB,
        terminalCodigo: "CX02",
        dispositivoId: empresaA,
        estabelecimento: "OUTRA",
        pontoCaptura: "002",
      });
      assert.equal(troca.status, 409);
      assert.equal(vinculo.empresaId, empresaA);
      const liberar = await postJson(
        `${base}/tef/desvincular`,
        {},
        { "x-ultrapdv-empresa": empresaA, "x-ultrapdv-terminal": "CX01" }
      );
      assert.equal(liberar.status, 200);
      assert.equal(vinculo, null);
    }
  );
});

test("terminal sem vínculo não aceita pagamento quando a exigência está ativa", async () => {
  await comServidor({ exigirVinculoTef: true }, async (base) => {
    const resposta = await postJson(`${base}/tef/pagamento`, {
      acao: "pagamento",
      identificador: "op-1",
      valor: 10,
    });
    assert.equal(resposta.status, 403);
  });
});

test("pagamento vinculado devolve prova do valor e do NSU reais", async () => {
  const { generateKeyPairSync, verify, createPublicKey } = await import("node:crypto");
  const { mensagemProvaTef } = await import("./tef-prova.mjs");
  const gerada = generateKeyPairSync("ed25519");
  const chave = {
    publica: gerada.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerada.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const empresa = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await comServidor(
    {
      exigirVinculoTef: true,
      lerVinculoTef: async () => ({
        empresaId: empresa,
        terminalCodigo: "CX01",
        dispositivoId: "11111111-1111-4111-8111-111111111111",
      }),
      lerChaveTef: async () => chave,
      pagarTef: async () => ({
        ok: true,
        resultado: {
          sucessoTransacao: true,
          nsu: "998877",
          codigoAutorizacao: "AUT01",
          rede: "CIELO",
          codigoFinalizacao: "FIN01",
          valor: 10,
        },
      }),
    },
    async (base) => {
      const resposta = await postJson(
        `${base}/tef/pagamento`,
        { acao: "pagamento", identificador: "op-assinada", valor: 10 },
        {
          "x-ultrapdv-empresa": empresa,
          "x-ultrapdv-terminal": "CX01",
          "x-ultrapdv-desafio": "ab".repeat(32),
        }
      );
      assert.equal(resposta.status, 200);
      const mensagem = mensagemProvaTef({
        acao: "pagamento",
        desafio: "ab".repeat(32),
        identificador: "op-assinada",
        valorCentavos: 1000,
        nsu: "998877",
        autorizacao: "AUT01",
        rede: "CIELO",
        finalizacao: "FIN01",
        sucesso: true,
        codigo: "",
      });
      assert.equal(
        verify(
          null,
          Buffer.from(mensagem),
          createPublicKey(chave.publica),
          Buffer.from(String(resposta.body.prova), "base64")
        ),
        true
      );
    }
  );
});

test("a prova assinada permanece no disco depois que o processo encerra", async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-tef-rec-"));
  const arquivo = path.join(pasta, "tef-recuperacao.json");
  const registro = registroRecuperacaoTef({
    identificador: "op-recuperacao",
    prova: "assinatura-local",
    nsu: "998877",
    rede: "CIELO",
    finalizacao: "FIN01",
    valor: 10,
    sucessoTransacao: true,
  });
  await gravarRecuperacaoTef(arquivo, registro);
  const lido = await lerRecuperacaoTef(arquivo);
  assert.equal(lido?.identificador, "op-recuperacao");
  assert.equal(lido?.prova, "assinatura-local");
  assert.equal(lido?.nsu, "998877");
  await removerRecuperacaoTef(arquivo);
  assert.equal(await lerRecuperacaoTef(arquivo), null);
});

test("a recuperação local só é lida pelo terminal vinculado", async () => {
  const empresaA = "11111111-1111-4111-8111-111111111111";
  const recuperacao = {
    identificador: "op-recuperacao",
    prova: "assinatura-local",
    nsu: "998877",
  };
  await comServidor(
    {
      lerVinculoTef: async () => ({
        empresaId: empresaA,
        terminalCodigo: "CX01",
        dispositivoId: empresaA,
        estabelecimento: "LOJA",
        pontoCaptura: "001",
      }),
      lerRecuperacaoTef: async () => recuperacao,
    },
    async (base) => {
      const anonima = await getJson(`${base}/tef/recuperacao`);
      assert.equal(anonima.status, 403);
      const outraLoja = await getJson(`${base}/tef/recuperacao`, {
        "x-ultrapdv-empresa": empresaA,
        "x-ultrapdv-terminal": "CX01",
        "x-ultrapdv-estabelecimento": "OUTRA",
      });
      assert.equal(outraLoja.status, 403);
      const dona = await getJson(`${base}/tef/recuperacao`, {
        "x-ultrapdv-empresa": empresaA,
        "x-ultrapdv-terminal": "CX01",
        "x-ultrapdv-estabelecimento": "LOJA",
      });
      assert.equal(dona.status, 200);
      assert.equal(dona.body.recuperacao.prova, "assinatura-local");
    }
  );
});

test("diagnóstico do pinpad não inicia o PayGo quando ele está parado", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const resposta = await gerenciador.diagnosticarPinpad(false);
  assert.equal(resposta.ok, false);
  assert.equal(resposta.codigo, "PINPAD_PAYGO_NAO_INICIALIZADO");
  assert.equal(resposta.erro, MENSAGEM_TEF_PINPAD_NAO_INICIALIZADO);
  assert.equal(processos.length, 0);
});

test("diagnóstico durante pagamento informa terminal ocupado e não escreve no processo", async () => {
  const { gerenciador, processos } = criarGerenciador();
  gerenciador.pendente = { acao: "pagamento", id: "pag" };
  const resposta = await gerenciador.diagnosticarPinpad(true);
  assert.equal(resposta.codigo, CODIGOS_TEF.OCUPADO);
  assert.equal(resposta.erro, MENSAGEM_TEF_PINPAD_OCUPADO);
  assert.equal(processos.length, 0);
  gerenciador.pendente = null;
  gerenciador.transacaoPendente = { status: "pagamento_em_andamento" };
  const journal = await gerenciador.diagnosticarPinpad(false);
  assert.equal(journal.erro, MENSAGEM_TEF_PINPAD_OCUPADO);
  assert.equal(processos.length, 0);
});

test("pinpad conectado, desconectado, sem fabricante e erro de biblioteca passam pelo protocolo", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const teste = gerenciador.executar({ acao: "teste" });
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responder(processos[0]);
  await teste;
  gerenciador.inicializado = true;

  const casos = [
    {
      resultado: {
        comunicacao: "confirmada",
        fabricante: "GERTEC",
        modelo: "PPC920",
        serieMascarada: "********1234",
      },
    },
    {
      resultado: { comunicacao: "nao_encontrado", fabricante: "", modelo: "" },
    },
    {
      resultado: { comunicacao: "nao_executada", ppinfoDisponivel: false, fabricante: "" },
    },
  ];
  for (const caso of casos) {
    const anteriores = processos[0].stdin.partes.join("").split(/\r?\n/).filter((linha) => linha.trim()).length;
    const pendente = gerenciador.diagnosticarPinpad(caso.resultado.comunicacao !== "nao_executada");
    await ate(() => {
      const linhas = processos[0].stdin.partes.join("").split(/\r?\n/).filter((linha) => linha.trim());
      return linhas.length > anteriores && linhas.at(-1).includes("pinpad-");
    });
    const pedido = ultimaLinha(processos[0]);
    assert.equal(pedido.acao.includes("pagamento"), false);
    processos[0].emitirStdout(
      `${JSON.stringify({ id: pedido.id, ok: true, resultado: caso.resultado, erro: null })}\n`
    );
    const resposta = await pendente;
    assert.equal(resposta.ok, true);
    assert.equal(resposta.resultado.comunicacao, caso.resultado.comunicacao);
    assert.equal(resposta.resultado.serieMascarada ?? "", caso.resultado.serieMascarada ?? "");
  }

  const falha = gerenciador.diagnosticarPinpad(true);
  await ate(() => ultimaLinha(processos[0]).acao === "pinpad-testar-comunicacao");
  const pedidoFalha = ultimaLinha(processos[0]);
  processos[0].emitirStdout(
    `${JSON.stringify({
      id: pedidoFalha.id,
      ok: false,
      resultado: { codigo: "PINPAD_COMUNICACAO_INDISPONIVEL" },
      erro: "Comunicacao indisponivel.",
      codigo: "PINPAD_COMUNICACAO_INDISPONIVEL",
    })}\n`
  );
  const respostaFalha = await falha;
  assert.equal(respostaFalha.ok, false);
  assert.equal(respostaFalha.codigo, "PINPAD_COMUNICACAO_INDISPONIVEL");
});

test("timeout do pinpad não mata o processo nem marca reconciliação financeira", async () => {
  const { gerenciador, processos, timers } = criarGerenciador();
  const teste = gerenciador.executar({ acao: "teste" });
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responder(processos[0]);
  await teste;
  gerenciador.inicializado = true;
  const antes = timers.length;
  const pendente = gerenciador.diagnosticarPinpad(true);
  await ate(() => timers.length > antes && ultimaLinha(processos[0]).acao === "pinpad-testar-comunicacao");
  const timer = timers.at(-1);
  assert.equal(timer.ms, TIMEOUTS_TEF_MS.pinpad);
  timer.fn();
  const resposta = await pendente;
  assert.equal(resposta.codigo, CODIGOS_TEF.TIMEOUT);
  assert.equal(processos[0].killed, false);
  assert.equal(gerenciador.transacaoPendente, null);
});

test("segunda consulta de pinpad espera a primeira terminar", async () => {
  const { gerenciador, processos } = criarGerenciador();
  const teste = gerenciador.executar({ acao: "teste" });
  await ate(() => processos[0]?.stdin.partes.length === 1);
  responder(processos[0]);
  await teste;
  gerenciador.inicializado = true;
  const primeira = gerenciador.diagnosticarPinpad(false);
  await ate(() => ultimaLinha(processos[0]).acao === "pinpad-diagnostico");
  const segunda = await gerenciador.diagnosticarPinpad(true);
  assert.equal(segunda.codigo, CODIGOS_TEF.OCUPADO);
  assert.equal(segunda.erro, MENSAGEM_TEF_OCUPADO);
  const pedido = ultimaLinha(processos[0]);
  processos[0].emitirStdout(
    `${JSON.stringify({ id: pedido.id, ok: true, resultado: { comunicacao: "nao_executada" }, erro: null })}\n`
  );
  assert.equal((await primeira).ok, true);
});

test("rotas do pinpad exigem o terminal vinculado e não chamam pagamento", async () => {
  const empresa = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const desafio = "ab".repeat(32);
  const chamadas = [];
  await comServidor(
    {
      exigirVinculoTef: true,
      lerVinculoTef: async () => ({
        empresaId: empresa,
        terminalCodigo: "CX01",
        dispositivoId: "11111111-1111-4111-8111-111111111111",
        estabelecimento: "LOJA",
      }),
      diagnosticarPinpadTef: async (testar) => {
        chamadas.push(testar);
        return {
          ok: true,
          statusHttp: 200,
          resultado: { comunicacao: testar ? "confirmada" : "nao_executada" },
        };
      },
      pagarTef: async () => {
        throw new Error("pagamento não pode ser chamado pelo diagnóstico");
      },
    },
    async (base) => {
      const anonimo = await getJson(`${base}/tef/pinpad/diagnostico`);
      assert.equal(anonimo.status, 403);
      const outra = await getJson(`${base}/tef/pinpad/diagnostico`, {
        "x-ultrapdv-empresa": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "x-ultrapdv-terminal": "CX01",
        "x-ultrapdv-desafio": desafio,
      });
      assert.equal(outra.status, 403);
      const semDesafio = await getJson(`${base}/tef/pinpad/diagnostico`, {
        "x-ultrapdv-empresa": empresa,
        "x-ultrapdv-terminal": "CX01",
      });
      assert.equal(semDesafio.status, 403);
      const identificado = await getJson(`${base}/tef/pinpad/diagnostico`, {
        "x-ultrapdv-empresa": empresa,
        "x-ultrapdv-terminal": "CX01",
        "x-ultrapdv-desafio": desafio,
      });
      assert.equal(identificado.status, 200);
      assert.equal(identificado.body.resultado.comunicacao, "nao_executada");
      const extra = await postJson(
        `${base}/tef/pinpad/testar-comunicacao`,
        { valor: 1 },
        {
          "x-ultrapdv-empresa": empresa,
          "x-ultrapdv-terminal": "CX01",
          "x-ultrapdv-desafio": desafio,
        }
      );
      assert.equal(extra.status, 400);
      const testado = await postJson(
        `${base}/tef/pinpad/testar-comunicacao`,
        {},
        {
          "x-ultrapdv-empresa": empresa,
          "x-ultrapdv-terminal": "CX01",
          "x-ultrapdv-desafio": desafio,
        }
      );
      assert.equal(testado.status, 200);
      assert.equal(testado.body.resultado.comunicacao, "confirmada");
      assert.deepEqual(chamadas, [false, true]);
    }
  );
});

test("o nativo do pinpad não reinstala nem abre transação", () => {
  const lpr = readFileSync(
    fileURLToPath(new URL("../../tef-agent/UltraPDVTef.lpr", import.meta.url)),
    "utf8"
  );
  const inicio = lpr.indexOf("function CampoPp");
  const fim = lpr.indexOf("procedure ProcessarLinha");
  const bloco = lpr.slice(inicio, fim);
  assert.equal(inicio > 0 && fim > inicio, true);
  assert.equal(bloco.includes("PWINFO_PPINFO"), true);
  assert.equal(bloco.includes("PW_iPPCommTest"), true);
  assert.equal(bloco.includes("PWOPER_INSTALL"), false);
  assert.equal(bloco.includes("PWOPER_MAINTENANCE"), false);
  assert.equal(bloco.includes("PWOPER_TSTKEY"), false);
  assert.equal(bloco.includes("PW_iInit"), false);
  assert.equal(bloco.includes("InicializarTEF"), false);
  assert.equal(lpr.includes("pinpad-diagnostico"), true);
  assert.equal(lpr.includes("pinpad-testar-comunicacao"), true);
});
