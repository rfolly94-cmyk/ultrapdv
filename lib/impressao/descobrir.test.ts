import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, beforeEach, test } from "node:test";

import {
  descobrirUltraPdvConector,
  ehSaudeConector,
  fetchConector,
  invalidarOrigemConector,
  portasDescobertaConector,
  resetarDescobertaConectorParaTestes,
} from "./descobrir";

function criarStorage() {
  const map = new Map<string, string>();
  return {
    getItem(chave: string) {
      return map.has(chave) ? map.get(chave)! : null;
    },
    setItem(chave: string, valor: string) {
      map.set(chave, String(valor));
    },
    removeItem(chave: string) {
      map.delete(chave);
    },
  };
}

function respostaSaude(porta: number) {
  return new Response(
    JSON.stringify({
      ok: true,
      app: "UltraPDV-Conector",
      servico: "ultrapdv-connector",
      nome: "UltraPDV Connector",
      versao: "1.3.3",
      version: "1.3.3",
      port: porta,
      porta,
      motorImpressao: { encontrado: true, tipo: "sumatrapdf" },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const fetchOriginal = globalThis.fetch;
let urls: string[] = [];

beforeEach(() => {
  urls = [];
  const storage = criarStorage();
  globalThis.window = {
    localStorage: storage,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  } as unknown as Window & typeof globalThis;
  resetarDescobertaConectorParaTestes();
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  resetarDescobertaConectorParaTestes();
});

test("varre 18181 e só então 18182 via /health", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes(":18182/health")) {
      return respostaSaude(18182);
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  const r = await descobrirUltraPdvConector();
  assert.equal(r.ok, true);
  if (!r.ok) {
    return;
  }
  assert.equal(r.origem, "http://127.0.0.1:18182");
  assert.equal(r.saude.port, 18182);
  assert.equal(urls[0], "http://127.0.0.1:18181/health");
  assert.equal(urls[1], "http://127.0.0.1:18182/health");
  assert.equal(urls.some((item) => item.includes("/status")), false);
  assert.equal(urls.some((item) => item.includes(":18183")), false);
});

test("memoriza a porta e não varre de novo enquanto ela responder", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes(":18185/health")) {
      return respostaSaude(18185);
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  const primeiro = await descobrirUltraPdvConector();
  assert.equal(primeiro.ok, true);
  const depoisDaVarredura = urls.length;
  const segundo = await descobrirUltraPdvConector();
  assert.equal(segundo.ok, true);
  if (!segundo.ok) {
    return;
  }
  assert.equal(segundo.origem, "http://127.0.0.1:18185");
  assert.equal(urls.at(-1), "http://127.0.0.1:18185/health");
  assert.equal(urls.length, depoisDaVarredura + 1);
});

test("invalida o cache e redescobre após falha", async () => {
  let vivo = 18181;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const m = url.match(/:(\d+)\/health$/);
    const porta = m ? Number(m[1]) : 0;
    if (porta === vivo) {
      return respostaSaude(porta);
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  const inicial = await descobrirUltraPdvConector();
  assert.equal(inicial.ok, true);
  vivo = 18184;
  invalidarOrigemConector();
  const novo = await descobrirUltraPdvConector();
  assert.equal(novo.ok, true);
  if (!novo.ok) {
    return;
  }
  assert.equal(novo.origem, "http://127.0.0.1:18184");
});

test("fetchConector redescobre se a porta memorizada cair", async () => {
  let vivo = 18181;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/print")) {
      if (url.includes(`:${vivo}/print`)) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new TypeError("Failed to fetch");
    }
    const m = url.match(/:(\d+)\/health$/);
    const porta = m ? Number(m[1]) : 0;
    if (porta === vivo) {
      return respostaSaude(porta);
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  const primeira = await fetchConector("/print", { method: "POST" });
  assert.equal(primeira.ok, true);
  vivo = 18183;
  const segunda = await fetchConector("/print", { method: "POST" });
  assert.equal(segunda.ok, true);
  assert.equal(urls.some((item) => item.includes(":18183/health")), true);
  assert.equal(urls.some((item) => item.includes(":18183/print")), true);
});

test("nenhuma porta válida devolve motivo sem_porta", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  const r = await descobrirUltraPdvConector();
  assert.equal(r.ok, false);
  if (r.ok) {
    return;
  }
  assert.equal(r.motivo, "sem_porta");
  assert.match(r.erro, /18181 a 18190/);
});

test("recusa serviço que não é o UltraPDV Connector", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes(":18181/health")) {
      return new Response(JSON.stringify({ ok: true, app: "outro" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes(":18182/health")) {
      return respostaSaude(18182);
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  const r = await descobrirUltraPdvConector();
  assert.equal(r.ok, true);
  if (!r.ok) {
    return;
  }
  assert.equal(r.origem, "http://127.0.0.1:18182");
  assert.equal(ehSaudeConector({ ok: true, app: "outro" }), false);
});

test("faixa de descoberta é 18181–18190 sequencial", () => {
  const portas = portasDescobertaConector();
  assert.deepEqual(portas[0], 18181);
  assert.equal(portas.at(-1), 18190);
  assert.equal(portas.length, 10);
  assert.equal(
    portas.every((porta, i) => porta === 18181 + i),
    true
  );
});

function escutar(servidor: http.Server, porta: number) {
  return new Promise<void>((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(porta, "127.0.0.1", () => resolve());
  });
}

function fechar(servidor: http.Server) {
  return new Promise<void>((resolve) => {
    servidor.close(() => resolve());
  });
}

test("descoberta real encontra o Connector pela faixa 18181–18190 via /health", async (t) => {
  globalThis.fetch = fetchOriginal;
  const jaRodando = await descobrirUltraPdvConector();
  if (jaRodando.ok) {
    assert.match(jaRodando.origem, /^http:\/\/127\.0\.0\.1:181(8[1-9]|90)$/);
    assert.equal(jaRodando.saude.app, "UltraPDV-Conector");
    assert.equal(typeof jaRodando.saude.port, "number");
    const direto = await fetch(`${jaRodando.origem}/health`);
    assert.equal(direto.ok, true);
    const corpo = (await direto.json()) as { app?: string };
    assert.equal(corpo.app, "UltraPDV-Conector");
    return;
  }

  invalidarOrigemConector();
  resetarDescobertaConectorParaTestes();

  const dummy = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, app: "nginx" }));
  });
  const conector = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "https://ultrapdv.app",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Cache-Control, Pragma",
        "Access-Control-Allow-Private-Network": "true",
      });
      res.end();
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          app: "UltraPDV-Conector",
          servico: "ultrapdv-connector",
          porta: 18182,
          port: 18182,
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await escutar(dummy, 18181);
    await escutar(conector, 18182);
  } catch (erro) {
    await fechar(dummy);
    await fechar(conector);
    if (erro && typeof erro === "object" && "code" in erro && erro.code === "EADDRINUSE") {
      t.skip("18181 ou 18182 ocupada e nenhum Connector válido respondeu em /health");
      return;
    }
    throw erro;
  }
  try {
    const r = await descobrirUltraPdvConector();
    assert.equal(r.ok, true);
    if (!r.ok) {
      return;
    }
    assert.equal(r.origem, "http://127.0.0.1:18182");
    assert.equal(r.saude.port, 18182);
  } finally {
    await fechar(dummy);
    await fechar(conector);
  }
});
