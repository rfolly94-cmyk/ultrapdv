import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  escolherImpressora,
  imprimirPdfComSumatra,
  impressoraExiste,
  montarArgsSumatra,
  validarPdf,
  MENSAGEM_IMPRESSORA_AUSENTE,
  MENSAGEM_IMPRESSORA_INDISPONIVEL,
  MENSAGEM_PDF_INVALIDO,
} from "./imprimir.mjs";
import {
  candidatosMotorPdf,
  localizarMotorPdf,
  motorEmpacotavel,
  motorParaHealth,
  MENSAGEM_MOTOR_AUSENTE,
  MENSAGEM_MOTOR_INSTALADOR,
} from "./motor.mjs";
import { criarServidor } from "./server.mjs";
import { obterOuCriarDispositivoId } from "./identidade.mjs";
import { ehConectorUltraPdv } from "./instancia.mjs";
import { carregarOrigens, origemPermitidaCors } from "./origens.mjs";
import { carregarVersao, NOME_CONECTOR } from "./versao.mjs";

const raiz = path.dirname(fileURLToPath(import.meta.url));

function fonte(relativo) {
  return readFileSync(path.join(raiz, relativo), "utf8");
}

const pdfValido = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<<>>\nendobj\n");

async function comServidor(deps, fn) {
  const servidor = criarServidor({
    obterDispositivoId: async () => "11111111-1111-4111-8111-111111111111",
    versao: "1.2.0",
    nome: "UltraPDV Connector",
    ...deps,
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
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
        resolve({ status: res.statusCode, headers: res.headers });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
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
        res.on("data", (c) => chunks.push(c));
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

test("não usa PrintTo nem Start-Process", () => {
  const server = fonte("server.mjs");
  const imprimir = fonte("imprimir.mjs");
  assert.doesNotMatch(server, /PrintTo/);
  assert.doesNotMatch(server, /Start-Process/);
  assert.doesNotMatch(imprimir, /PrintTo/);
  assert.doesNotMatch(imprimir, /Start-Process/);
  assert.match(imprimir, /execFile/);
  assert.match(imprimir, /-print-to/);
  assert.match(imprimir, /-silent/);
});

test("candidatos priorizam print-engine do Connector e mantêm bin de desenvolvimento", () => {
  const lista = candidatosMotorPdf(
    {
      ULTRAPDV_PDF_PRINTER: "D:\\apps\\SumatraPDF.exe",
      ULTRAPDV_INSTALL_DIR: "C:\\Program Files\\UltraPDV Connector",
      LOCALAPPDATA: "C:\\Users\\caixa\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    },
    "D:\\dev\\print-agent"
  );
  assert.equal(lista[0], "D:\\apps\\SumatraPDF.exe");
  assert.equal(
    lista[1],
    "C:\\Program Files\\UltraPDV Connector\\print-engine\\SumatraPDF.exe"
  );
  const idxEngine = lista.findIndex((item) =>
    item.includes("print-agent") && item.includes("print-engine")
  );
  const idxBin = lista.findIndex(
    (item) =>
      item.endsWith("bin\\SumatraPDF.exe") || item.endsWith("bin/SumatraPDF.exe")
  );
  assert.ok(idxEngine >= 0 && idxBin >= 0 && idxEngine < idxBin);
});

test("/status é descoberta rápida sem localizar motor", async () => {
  await comServidor(
    {
      localizarMotorPdf: async () => {
        throw new Error("motor não deve ser consultado na descoberta");
      },
    },
    async (base) => {
      const { status, body } = await getJson(`${base}/status`);
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.app, "UltraPDV-Conector");
      assert.equal(body.servico, "ultrapdv-connector");
      assert.equal(body.porta, body.port);
      assert.equal(body.dispositivoId, undefined);
      assert.equal(body.motorImpressao, undefined);
      assert.equal(body.lastPrinter, undefined);
    }
  );
});

test("/health sem motor PDF", async () => {
  await comServidor(
    {
      localizarMotorPdf: async () => ({
        encontrado: false,
        tipo: null,
        caminho: null,
      }),
    },
    async (base) => {
      const { status, body } = await getJson(`${base}/health`);
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.app, "UltraPDV-Conector");
      assert.equal(body.nome, "UltraPDV Connector");
      assert.equal(body.dispositivoId, "11111111-1111-4111-8111-111111111111");
      assert.equal(body.motorImpressao.encontrado, false);
      assert.equal(typeof body.port, "number");
      assert.equal(body.version, "1.2.0");
      assert.equal(body.motorImpressao.tipo, null);
    }
  );
});

test("/health com motor encontrado", async () => {
  await comServidor(
    {
      localizarMotorPdf: async () => ({
        encontrado: true,
        tipo: "sumatrapdf",
        caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
      }),
    },
    async (base) => {
      const { body } = await getJson(`${base}/health`);
      assert.equal(body.motorImpressao.encontrado, true);
      assert.equal(body.motorImpressao.tipo, "sumatrapdf");
      assert.equal(
        body.motorImpressao.caminho,
        "C:\\SumatraPDF\\SumatraPDF.exe"
      );
    }
  );
});

test("/printers lista impressoras injetadas", async () => {
  await comServidor(
    {
      listarImpressoras: async () => [{ nome: "ELGIN i9", padrao: true }],
    },
    async (base) => {
      const { body } = await getJson(`${base}/printers`);
      assert.equal(body.ok, true);
      assert.equal(body.impressoras[0].nome, "ELGIN i9");
    }
  );
});

test("POST /print recusa comando, impressora inexistente e PDF inválido", async () => {
  await comServidor(
    {
      localizarMotorPdf: async () => ({
        encontrado: true,
        tipo: "sumatrapdf",
        caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
      }),
      listarImpressoras: async () => [{ nome: "ELGIN i9" }],
    },
    async (base) => {
      const comando = await postJson(`${base}/print`, {
        comando: "calc.exe",
        impressora: "ELGIN i9",
        pdfBase64: pdfValido.toString("base64"),
      });
      assert.equal(comando.status, 400);
      assert.equal(comando.body.ok, false);

      const inexistente = await postJson(`${base}/print`, {
        impressora: "Impressora Fantasma",
        pdfBase64: pdfValido.toString("base64"),
      });
      assert.equal(inexistente.body.ok, false);
      assert.equal(inexistente.body.erro, MENSAGEM_IMPRESSORA_AUSENTE);

      const semImpressora = await postJson(`${base}/print`, {
        pdfBase64: pdfValido.toString("base64"),
      });
      assert.equal(semImpressora.body.ok, false);
      assert.equal(semImpressora.body.erro, MENSAGEM_IMPRESSORA_INDISPONIVEL);

      const invalido = await postJson(`${base}/print`, {
        impressora: "ELGIN i9",
        pdfBase64: Buffer.from("nao-e-pdf").toString("base64"),
      });
      assert.equal(invalido.body.ok, false);
      assert.equal(invalido.body.erro, MENSAGEM_PDF_INVALIDO);
    }
  );
});

test("POST /print de teste retorna sucesso com motor mockado", async () => {
  let chamado = false;
  await comServidor(
    {
      localizarMotorPdf: async () => ({
        encontrado: true,
        tipo: "sumatrapdf",
        caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
      }),
      listarImpressoras: async () => [{ nome: "ELGIN i9" }],
      imprimirPdfComSumatra: async () => {
        chamado = true;
      },
    },
    async (base) => {
      const resultado = await postJson(`${base}/print`, {
        impressora: "ELGIN i9",
        pdfBase64: pdfValido.toString("base64"),
      });
      assert.equal(resultado.status, 200);
      assert.equal(resultado.body.ok, true);
      assert.equal(resultado.body.impressora, "ELGIN i9");
      assert.equal(chamado, true);
    }
  );
});

test("impressora inexistente é recusada", async () => {
  await assert.rejects(
    () =>
      imprimirPdfComSumatra({
        motor: {
          encontrado: true,
          caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
        },
        impressora: "Impressora Fantasma",
        copias: 1,
        pdfBase64: pdfValido.toString("base64"),
        impressoras: [{ nome: "ELGIN i9" }],
        execFile: async () => {
          throw new Error("não deveria imprimir");
        },
      }),
    (error) => error.message === MENSAGEM_IMPRESSORA_AUSENTE
  );
});

test("arquivo inválido é recusado", async () => {
  await assert.rejects(
    () =>
      imprimirPdfComSumatra({
        motor: {
          encontrado: true,
          caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
        },
        impressora: "ELGIN i9",
        copias: 1,
        pdfBase64: Buffer.from("nao-e-pdf").toString("base64"),
        impressoras: [{ nome: "ELGIN i9" }],
      }),
    (error) => error.message === MENSAGEM_PDF_INVALIDO
  );
  assert.equal(validarPdf(pdfValido), true);
  assert.equal(validarPdf(Buffer.from("hello")), false);
});

test("impressão de teste chama Sumatra com argumentos separados e limpa temporário", async () => {
  const removidos = [];
  let argsUsados = null;
  await imprimirPdfComSumatra({
    motor: { encontrado: true, caminho: "C:\\SumatraPDF\\SumatraPDF.exe" },
    impressora: "ELGIN i9",
    copias: 2,
    papel: "80mm",
    pdfBase64: pdfValido.toString("base64"),
    impressoras: [{ nome: "ELGIN i9" }],
    execFile: async (_exe, args) => {
      argsUsados = args;
    },
    fsApi: {
      mkdtemp: async (prefixo) => `${prefixo}xyz`,
      writeFile: async () => {},
      rm: async (pasta) => {
        removidos.push(pasta);
      },
    },
  });
  assert.deepEqual(argsUsados.slice(0, 3), ["-print-to", "ELGIN i9", "-silent"]);
  assert.equal(argsUsados.includes("-print-settings"), true);
  assert.match(argsUsados[4], /2x/);
  assert.equal(removidos.length, 1);
});

test("erro de impressão ainda limpa temporário e o servidor segue vivo", async () => {
  const removidos = [];
  await assert.rejects(
    () =>
      imprimirPdfComSumatra({
        motor: { encontrado: true, caminho: "C:\\SumatraPDF\\SumatraPDF.exe" },
        impressora: "ELGIN i9",
        pdfBase64: pdfValido.toString("base64"),
        impressoras: [{ nome: "ELGIN i9" }],
        execFile: async () => {
          const erro = new Error("driver");
          erro.code = 5;
          throw erro;
        },
        fsApi: {
          mkdtemp: async (prefixo) => `${prefixo}abc`,
          writeFile: async () => {},
          rm: async (pasta) => {
            removidos.push(pasta);
          },
        },
      }),
    /driver da impressora/
  );
  assert.equal(removidos.length, 1);

  await comServidor(
    {
      localizarMotorPdf: async () => ({
        encontrado: false,
        tipo: null,
        caminho: null,
      }),
      listarImpressoras: async () => [{ nome: "ELGIN i9" }],
    },
    async (base) => {
      const falha = await postJson(`${base}/print`, {
        impressora: "ELGIN i9",
        pdfBase64: pdfValido.toString("base64"),
      });
      assert.equal(falha.body.ok, false);
      assert.equal(falha.body.erro, MENSAGEM_MOTOR_AUSENTE);
      const saude = await getJson(`${base}/health`);
      assert.equal(saude.body.ok, true);
    }
  );
});

test("montarArgsSumatra não interpola shell", () => {
  const args = montarArgsSumatra({
    impressora: "HP LaserJet",
    arquivo: "C:\\tmp\\doc.pdf",
    copias: 1,
    papel: "a4",
  });
  assert.equal(args[0], "-print-to");
  assert.equal(args[1], "HP LaserJet");
  assert.equal(args.includes("-silent"), true);
  assert.equal(impressoraExiste([{ nome: "HP LaserJet" }], "HP LaserJet"), true);
  assert.equal(impressoraExiste([{ nome: "HP LaserJet" }], "Outra"), false);
});

test("localizarMotorPdf usa o primeiro exe existente", async () => {
  const env = { ULTRAPDV_PDF_PRINTER: "Z:\\x.exe" };
  const motor = await localizarMotorPdf(env, async (candidato) => {
    if (candidato === "Z:\\x.exe") {
      return;
    }
    throw new Error("missing");
  });
  assert.deepEqual(motorParaHealth(motor), {
    encontrado: true,
    tipo: "sumatrapdf",
    caminho: "Z:\\x.exe",
  });
});

test("versão única vem de version.json", () => {
  const info = carregarVersao(path.join(raiz, ".."));
  const pkg = JSON.parse(readFileSync(path.join(raiz, "..", "package.json"), "utf8"));
  assert.equal(info.name, NOME_CONECTOR);
  assert.equal(info.version, pkg.version);
  assert.match(fonte("../installer/ultrapdv-connector.nsi"), /generated\\version\.nsh/);
  assert.match(fonte("../installer/ultrapdv-connector.nsi"), /STAGING_DIR/);
  assert.match(fonte("../installer/ultrapdv-connector.nsi"), /__FILEDIR__/);
  assert.match(fonte("../installer/build.ps1"), /Assert-MesmoArquivo/);
  assert.match(fonte("../installer/build.ps1"), /Push-Location \$installerDir/);
});

test("origens de produção incluem ultrapdv.app sem wildcard", async () => {
  const origens = await carregarOrigens({
    env: {},
    raiz: path.join(raiz, ".."),
  });
  assert.deepEqual(origens, [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://ultrapdv.app",
    "https://www.ultrapdv.app",
  ]);
  const config = JSON.parse(
    readFileSync(path.join(raiz, "..", "config", "origins.json"), "utf8")
  );
  assert.deepEqual(config.origens, []);
  const fonteOrigens = fonte("./origens.mjs");
  assert.doesNotMatch(fonteOrigens, /Access-Control-Allow-Origin:\s*\*/);
});

test("CORS autoriza produção, loopback/LAN e recusa origem pública estranha", () => {
  const origens = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://ultrapdv.app",
    "https://www.ultrapdv.app",
  ];
  assert.equal(origemPermitidaCors("https://ultrapdv.app", origens), true);
  assert.equal(origemPermitidaCors("http://127.0.0.1:18185", origens), true);
  assert.equal(origemPermitidaCors("http://192.168.1.20:3000", origens), true);
  assert.equal(origemPermitidaCors("http://10.0.0.8", origens), true);
  assert.equal(origemPermitidaCors("https://evil.example", origens), false);
  assert.equal(origemPermitidaCors("", origens), true);
});

test("CORS aceita https://ultrapdv.app e recusa origem estranha", async () => {
  await comServidor(
    {
      origens: [
        "http://localhost:3000",
        "https://ultrapdv.app",
        "https://www.ultrapdv.app",
      ],
    },
    async (base) => {
      const ok = await getJson(`${base}/health`, {
        Origin: "https://ultrapdv.app",
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.ok, true);
      assert.equal(ok.headers["access-control-allow-origin"], "https://ultrapdv.app");
      assert.equal(ok.headers["access-control-allow-private-network"], "true");

      const preflight = await optionsReq(`${base}/health`, {
        Origin: "https://ultrapdv.app",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers["access-control-allow-origin"],
        "https://ultrapdv.app"
      );
      assert.equal(
        preflight.headers["access-control-allow-private-network"],
        "true"
      );
      assert.match(
        String(preflight.headers["access-control-allow-methods"]),
        /GET/
      );
      assert.match(
        String(preflight.headers["access-control-allow-headers"]),
        /Content-Type/i
      );

      const preflightPrint = await optionsReq(`${base}/print`, {
        Origin: "https://ultrapdv.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
        "Access-Control-Request-Private-Network": "true",
      });
      assert.equal(preflightPrint.status, 204);
      assert.equal(
        preflightPrint.headers["access-control-allow-private-network"],
        "true"
      );

      const lan = await getJson(`${base}/health`, {
        Origin: "http://192.168.1.20:3000",
      });
      assert.equal(lan.status, 200);
      assert.equal(
        lan.headers["access-control-allow-origin"],
        "http://192.168.1.20:3000"
      );
      assert.equal(lan.headers["access-control-allow-private-network"], "true");

      const www = await getJson(`${base}/health`, {
        Origin: "https://www.ultrapdv.app",
      });
      assert.equal(www.status, 200);
      assert.equal(
        www.headers["access-control-allow-origin"],
        "https://www.ultrapdv.app"
      );

      const denied = await getJson(`${base}/health`, {
        Origin: "https://evil.example",
      });
      assert.equal(denied.status, 403);
      assert.notEqual(denied.headers["access-control-allow-origin"], "*");
    }
  );
});

test("dispositivoId é UUID persistido, sem fingerprint", async () => {
  const arquivos = new Map();
  const id = await obterOuCriarDispositivoId({
    pasta: "C:\\fake\\data",
    criarId: () => "22222222-2222-4222-8222-222222222222",
    fsApi: {
      mkdir: async () => {},
      readFile: async (arquivo) => {
        if (!arquivos.has(arquivo)) {
          throw new Error("missing");
        }
        return arquivos.get(arquivo);
      },
      writeFile: async (arquivo, conteudo) => {
        arquivos.set(arquivo, conteudo);
      },
    },
  });
  assert.equal(id, "22222222-2222-4222-8222-222222222222");
  const segundo = await obterOuCriarDispositivoId({
    pasta: "C:\\fake\\data",
    criarId: () => "nao-deve-gerar",
    fsApi: {
      mkdir: async () => {},
      readFile: async (arquivo) => arquivos.get(arquivo),
      writeFile: async () => {
        throw new Error("não deveria regravar");
      },
    },
  });
  assert.equal(segundo, id);
  const gravado = [...arquivos.values()][0];
  assert.doesNotMatch(gravado, /cnpj|empresa_id|supabase|geranet|fingerprint/i);
});

test("health do próprio Connector evita segunda instância", () => {
  assert.equal(
    ehConectorUltraPdv({ ok: true, nome: "UltraPDV Connector" }),
    true
  );
  assert.equal(ehConectorUltraPdv({ ok: true, nome: "Outro" }), false);
});

test("POST /shutdown recusa Origin do navegador e aceita painel local", async () => {
  let encerrou = false;
  await comServidor(
    {
      encerrarProcesso: () => {
        encerrou = true;
      },
    },
    async (base) => {
      const recusado = await postJson(
        `${base}/shutdown`,
        {},
        { Origin: "http://localhost:3000" }
      );
      assert.equal(recusado.status, 403);
      assert.equal(encerrou, false);
      const painel = await postJson(
        `${base}/shutdown`,
        {},
        { Origin: base }
      );
      assert.equal(painel.body.ok, true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(encerrou, true);
      const saude = await getJson(`${base}/health`);
      assert.equal(saude.body.ok, true);
    }
  );
});

test("cenário I: POST /print/teste usa o pipeline real injetado", async () => {
  let chamado = null;
  await comServidor(
    {
      aoTestarImpressao: async (payload) => {
        chamado = payload;
        return { ok: true, impressora: "ELGIN i9" };
      },
    },
    async (base) => {
      const r = await postJson(`${base}/print/teste`, {});
      assert.equal(r.body.ok, true);
      assert.equal(r.body.impressora, "ELGIN i9");
      assert.equal(chamado !== null, true);
    }
  );
});

test("cenário E via API: porta ocupada devolve conflito", async () => {
  await comServidor(
    {
      aoAlterarPorta: async (payload) => ({
        ok: false,
        status: 409,
        erro: `Porta ${payload.porta} está sendo utilizada por outro aplicativo.`,
        podeUsarProxima: true,
      }),
    },
    async (base) => {
      const r = await postJson(`${base}/config/port`, { porta: 18181 });
      assert.equal(r.status, 409);
      assert.match(r.body.erro, /Porta 18181 está sendo utilizada/);
    }
  );
});

test("POST /config/port rejeita 19000", async () => {
  await comServidor({}, async (base) => {
    const r = await postJson(`${base}/config/port`, { porta: 19000 });
    assert.equal(r.status, 400);
    assert.equal(
      r.body.erro,
      "O UltraPDV Conector utiliza portas entre 18181 e 18190."
    );
  });
});

const bematech = "\\\\SERVIDOR\\Bematech MP-4200 HS";
const printToPdf = "Microsoft Print to PDF";
const listaMista = [
  { nome: printToPdf, padrao: true },
  { nome: bematech, padrao: false },
];

test("cenário C/D: lastPrinter Bematech vence Print to PDF", () => {
  assert.equal(
    escolherImpressora({
      lastPrinter: bematech,
      impressoras: listaMista,
    }),
    bematech
  );
  assert.equal(
    escolherImpressora({
      pedida: bematech,
      lastPrinter: printToPdf,
      impressoras: listaMista,
    }),
    bematech
  );
  assert.equal(
    escolherImpressora({
      lastPrinter: null,
      impressoras: listaMista,
    }),
    null
  );
  assert.equal(
    escolherImpressora({
      lastPrinter: null,
      impressoras: [
        { nome: printToPdf, padrao: false },
        { nome: bematech, padrao: false },
      ],
    }),
    null
  );
  assert.equal(
    escolherImpressora({
      pedida: "Impressora Fantasma",
      lastPrinter: bematech,
      impressoras: listaMista,
    }),
    null
  );
});

test("POST /print com impressora pedida inexistente não usa lastPrinter", async () => {
  let impressoraUsada = null;
  await comServidor(
    {
      obterConfigLocal: async () => ({
        lastPrinter: bematech,
        lastPaper: "80mm",
      }),
      listarImpressoras: async () => listaMista,
      localizarMotorPdf: async () => ({
        encontrado: true,
        tipo: "sumatrapdf",
        caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
      }),
      imprimirPdfComSumatra: async (opts) => {
        impressoraUsada = opts.impressora;
      },
    },
    async (base) => {
      const r = await postJson(`${base}/print`, {
        impressora: "Impressora Fantasma",
        pdfBase64: pdfValido.toString("base64"),
      });
      assert.equal(r.body.ok, false);
      assert.equal(r.body.erro, MENSAGEM_IMPRESSORA_AUSENTE);
      assert.equal(impressoraUsada, null);
    }
  );
});

test("cenário E: teste de impressão usa a impressora selecionada", async () => {
  let usada = null;
  await comServidor(
    {
      obterConfigLocal: async () => ({
        lastPrinter: printToPdf,
        lastPaper: "80mm",
      }),
      listarImpressoras: async () => listaMista,
      localizarMotorPdf: async () => ({
        encontrado: true,
        caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
      }),
      imprimirPdfComSumatra: async (opts) => {
        usada = opts.impressora;
      },
    },
    async (base) => {
      const r = await postJson(`${base}/print/teste`, {
        impressora: bematech,
        papel: "80mm",
      });
      assert.equal(r.body.ok, true);
      assert.equal(r.body.impressora, bematech);
      assert.equal(usada, bematech);
    }
  );
});

test("cenário F/G: lastPrinter persiste e a impressão do UltraPDV a reutiliza", async () => {
  let salvo = null;
  let impressoraUsada = null;
  await comServidor(
    {
      obterConfigLocal: async () => ({
        lastPrinter: bematech,
        lastPaper: "80mm",
      }),
      aoSalvarImpressora: async ({ impressora, papel }) => {
        salvo = { lastPrinter: impressora, lastPaper: papel };
        return salvo;
      },
      listarImpressoras: async () => listaMista,
      localizarMotorPdf: async () => ({
        encontrado: true,
        caminho: "C:\\SumatraPDF\\SumatraPDF.exe",
      }),
      imprimirPdfComSumatra: async (opts) => {
        impressoraUsada = opts.impressora;
      },
    },
    async (base) => {
      const cfg = await postJson(`${base}/config/printer`, {
        impressora: bematech,
        papel: "80mm",
      });
      assert.equal(cfg.body.ok, true);
      assert.equal(cfg.body.lastPrinter, bematech);
      assert.equal(salvo.lastPrinter, bematech);

      const saude = await getJson(`${base}/health`);
      assert.equal(saude.body.lastPrinter, bematech);

      const print = await postJson(`${base}/print`, {
        pdfBase64: pdfValido.toString("base64"),
      });
      assert.equal(print.body.ok, true);
      assert.equal(print.body.impressora, bematech);
      assert.equal(impressoraUsada, bematech);
    }
  );
});

test("cenário H: Sumatra sem libmupdf ou com nome de instalador é rejeitado", () => {
  assert.equal(
    motorEmpacotavel({
      nomeArquivo: "SumatraPDF.exe",
      temLibMupdf: false,
      productName: "SumatraPDF",
    }).ok,
    false
  );
  assert.equal(
    motorEmpacotavel({
      nomeArquivo: "SumatraPDF.exe",
      temLibMupdf: false,
      productName: "SumatraPDF",
    }).erro,
    MENSAGEM_MOTOR_INSTALADOR
  );
  assert.equal(
    motorEmpacotavel({
      nomeArquivo: "SumatraPDF-3.6.1-64-install.exe",
      temLibMupdf: true,
      productName: "SumatraPDF",
    }).ok,
    false
  );
  assert.equal(
    motorEmpacotavel({
      nomeArquivo: "SumatraPDF.exe",
      temLibMupdf: true,
      productName: "SumatraPDF",
    }).ok,
    true
  );
  const validador = fonte("../installer/validar-sumatra.ps1");
  const build = fonte("../installer/build.ps1");
  const nsi = fonte("../installer/ultrapdv-connector.nsi");
  assert.match(validador, /libmupdf\.dll/);
  assert.match(validador, /parece ser um instalador/);
  assert.match(build, /Prepare-SumatraMotor/);
  assert.match(build, /libmupdf\.dll/);
  assert.match(nsi, /libmupdf\.dll/);
  assert.match(fonte("pagina-status.html"), /selImpressora/);
  assert.match(fonte("pagina-status.html"), /Salvar configuração/);
  assert.match(fonte("pagina-status.html"), /selectedIndex = -1/);
  assert.match(fonte("pagina-status.html"), /Gaveta de dinheiro/);
  assert.match(fonte("pagina-status.html"), /Testar abertura da gaveta/);
  assert.match(fonte("pagina-status.html"), /\/drawer\/open/);
  assert.doesNotMatch(fonte("pagina-status.html"), /impressoras\[0\]/);
});

test("POST /drawer/open usa a impressora selecionada e recusa gaveta desabilitada na origem web", async () => {
  let chamada = null;
  await comServidor(
    {
      obterConfigLocal: async () => ({
        lastPrinter: "ELGIN i9",
        lastPaper: "80mm",
        drawerEnabled: false,
        drawerPin: 0,
      }),
      listarImpressoras: async () => [{ nome: "ELGIN i9", padrao: true }],
      aoAbrirGaveta: async (impressora, config) => {
        chamada = { impressora, config };
        return { ok: true, impressora, pino: config.pino };
      },
    },
    async (base) => {
      const recusa = await postJson(
        `${base}/drawer/open`,
        {},
        { Origin: "http://localhost:3000" }
      );
      assert.equal(recusa.body.ok, false);
      assert.match(recusa.body.erro, /desabilitada/i);
      assert.equal(chamada, null);

      const testeLocal = await postJson(`${base}/drawer/open`, {
        impressora: "ELGIN i9",
        pino: 1,
      });
      assert.equal(testeLocal.body.ok, true);
      assert.equal(chamada.impressora, "ELGIN i9");
      assert.equal(chamada.config.habilitada, true);
      assert.equal(chamada.config.pino, 1);
    }
  );
});

test("POST /drawer/open com gaveta habilitada usa lastPrinter e pino persistido", async () => {
  let chamada = null;
  await comServidor(
    {
      obterConfigLocal: async () => ({
        lastPrinter: "ELGIN i9",
        lastPaper: "80mm",
        drawerEnabled: true,
        drawerPin: 0,
      }),
      listarImpressoras: async () => [{ nome: "ELGIN i9", padrao: true }],
      aoAbrirGaveta: async (impressora, config) => {
        chamada = { impressora, config };
        return { ok: true, impressora };
      },
    },
    async (base) => {
      const r = await postJson(
        `${base}/drawer/open`,
        { impressora: "Outra", pino: 1 },
        { Origin: "http://localhost:3000" }
      );
      assert.equal(r.body.ok, true);
      assert.equal(chamada.impressora, "ELGIN i9");
      assert.equal(chamada.config.pino, 0);
    }
  );
});

test("log de impressão registra motor, exit code e apaga o temporário", async () => {
  const eventos = [];
  const removidos = [];
  await imprimirPdfComSumatra({
    motor: { encontrado: true, caminho: "C:\\Program Files\\UltraPDV Connector\\print-engine\\SumatraPDF.exe" },
    impressora: bematech,
    papel: "80mm",
    pdfBase64: pdfValido.toString("base64"),
    impressoras: listaMista,
    onLog: async (evento, detalhe) => {
      eventos.push(`${evento} ${detalhe || ""}`.trim());
    },
    execFile: async () => {},
    fsApi: {
      mkdtemp: async (prefixo) => `${prefixo}log`,
      writeFile: async () => {},
      rm: async (pasta) => {
        removidos.push(pasta);
      },
    },
  });
  assert.match(eventos[0], /impressao-inicio/);
  assert.match(eventos[0], /print-engine\\SumatraPDF\.exe/);
  assert.match(eventos[0], /Bematech/);
  assert.equal(eventos.includes("pdf-temporario-criado"), true);
  assert.equal(eventos.includes("sumatra-inicio"), true);
  assert.equal(eventos.includes("sumatra-exit-code=0"), true);
  assert.equal(eventos.includes("impressao-ok"), true);
  assert.equal(removidos.length, 1);
});

test("versão 1.3.3 e faixa de portas 18181–18190 permanecem", () => {
  const versao = JSON.parse(fonte("../version.json"));
  assert.equal(versao.version, "1.3.3");
  assert.match(fonte("portas.mjs"), /PORTA_PADRAO = 18181/);
  assert.match(fonte("portas.mjs"), /PORTA_AUTO_MAX = 18190/);
});

