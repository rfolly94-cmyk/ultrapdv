import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ENVRMNT_PROD,
  ENVRMNT_TEST,
  FUNCOES_BLOQUEADAS,
  chamadaPermitidaNoDiagnostico,
  diretorioExclusivoHomologacao,
  esquecerComunicacaoPinpadHomologacao,
  executarDiagnosticoHomologacao,
  textoPinpadUltraPdv,
  garantirDiretorioHomologacao,
  pinpadEmOperacaoFinanceira,
  PWRET_NOTINST,
  PWRET_WRITERR,
} from "./tef-diagnostico-homologacao.mjs";
import { liberarHomologacao, reservarHomologacao } from "./tef-homologacao-ocupacao.mjs";

function bibliotecaOk(porta = 8) {
  const chamadas = [];
  return {
    chamadas,
    async setEnvironment(codigo) {
      chamadas.push(["PW_iSetEnvironment", codigo]);
      return 0;
    },
    async init(diretorio) {
      chamadas.push(["PW_iInit", diretorio]);
      return 0;
    },
    async ppCommTest(portaPedida) {
      chamadas.push(["PW_iPPCommTest", portaPedida]);
      return { codigo: 0, porta, mensagem: "" };
    },
    async newTransac() {
      chamadas.push(["PW_iNewTransac"]);
      return 0;
    },
    async addParam() {
      chamadas.push(["PW_iAddParam"]);
      return 0;
    },
    async execTransac() {
      chamadas.push(["PW_iExecTransac"]);
      return 0;
    },
    async confirmation() {
      chamadas.push(["PW_iConfirmation"]);
      return 0;
    },
    async end() {
      chamadas.push(["PW_End"]);
    },
  };
}

test("sem execução explícita a DLL não é aberta", async () => {
  let abriu = false;
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      raiz: "C:\\UltraPDV",
      verificarDll: async () => {
        throw new Error("não deveria verificar");
      },
      abrir: async () => {
        abriu = true;
      },
    }
  );
  assert.equal(resultado.executado, false);
  assert.equal(abriu, false);
  assert.equal(resultado.codigo, "DIAGNOSTICO_NAO_EXECUTADO");
});

test("o teste autorizado só usa o ciclo de diagnóstico e exige PWRET_OK", async () => {
  const lib = bibliotecaOk(12);
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => lib,
    }
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.codigo, "PWRET_OK");
  assert.equal(resultado.portaNome, "COM12");
  assert.deepEqual(
    lib.chamadas.map((item) => item[0]),
    ["PW_iSetEnvironment", "PW_iInit", "PW_iPPCommTest"]
  );
  assert.equal(lib.chamadas[0][1], ENVRMNT_TEST);
  assert.equal(lib.chamadas[2][1], 0);
  assert.equal(lib.chamadas.some((item) => FUNCOES_BLOQUEADAS.includes(item[0])), false);

  const falha = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => ({
        ...bibliotecaOk(),
        async ppCommTest() {
          return { codigo: -2489, porta: 255, mensagem: "" };
        },
      }),
    }
  );
  assert.equal(falha.ok, false);
  assert.notEqual(falha.codigo, "PWRET_OK");
  assert.equal(falha.codigoBiblioteca, -2489);

  const ambienteRecusado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => ({
        ...bibliotecaOk(),
        async setEnvironment(codigo) {
          this.chamadas.push(["PW_iSetEnvironment", codigo]);
          return -2487;
        },
      }),
    }
  );
  assert.equal(ambienteRecusado.ok, false);
  assert.equal(ambienteRecusado.codigo, "PW_iSetEnvironment");
  assert.equal(ambienteRecusado.codigoBiblioteca, -2487);
  assert.match(ambienteRecusado.mensagem, /Código -2487/);
  assert.equal(ambienteRecusado.chamadas.includes("PW_iPPCommTest"), false);
  assert.deepEqual(ambienteRecusado.chamadas.slice(0, 2), ["LoadLibrary", "PW_iSetEnvironment"]);
  assert.equal(ambienteRecusado.chamadas.includes("PW_iInit"), false);
});

test("o diretório exclusivo é criado antes de PW_iInit", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-homologacao-"));
  try {
    const lib = bibliotecaOk();
    let existia = false;
    const init = lib.init.bind(lib);
    lib.init = async (diretorio) => {
      existia = (await stat(diretorio)).isDirectory();
      return init(diretorio);
    };
    const resultado = await executarDiagnosticoHomologacao(
      { acao: "identificar" },
      {
        executar: true,
        raiz: base,
        verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
        abrir: async () => lib,
      }
    );
    assert.equal(existia, true);
    assert.equal(resultado.ok, true);
    assert.equal(lib.chamadas[0][0], "PW_iSetEnvironment");
    assert.equal(lib.chamadas[1][0], "PW_iInit");
    await assert.rejects(garantirDiretorioHomologacao("C:\\UltraPDV\\TEF\\Producao\\PGWeb"));
    const semPasta = await executarDiagnosticoHomologacao(
      { acao: "identificar" },
      {
        executar: true,
        raiz: base,
        criarDiretorio: async () => {
          throw new Error("sem pasta");
        },
        verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
        abrir: async () => {
          throw new Error("PW_iInit não deveria ser chamado");
        },
      }
    );
    assert.equal(semPasta.codigo, "PWRET_WRITERR");
    assert.equal(semPasta.codigoBiblioteca, PWRET_WRITERR);
    assert.equal(PWRET_WRITERR, -2485);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("identificar não testa o pinpad e a produção, o hash e a operação financeira bloqueiam", async () => {
  const lib = bibliotecaOk();
  const identificado = await executarDiagnosticoHomologacao(
    { acao: "identificar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => lib,
      comunicacaoConfirmada: null,
    }
  );
  assert.equal(identificado.ok, true);
  assert.equal(identificado.comunicacao, "nao_executada");
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iPPCommTest"), false);

  const producao = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    { executar: true, raiz: "C:\\UltraPDV\\TEF\\Producao", abrir: async () => bibliotecaOk() }
  );
  assert.equal(producao.codigo, "DIRETORIO_PRODUCAO");
  assert.equal(diretorioExclusivoHomologacao("C:\\UltraPDV\\TEF\\Producao"), "");

  const diretorioProducao = "C:\\Temp\\UltraPDV\\TEF\\Producao\\PGWeb";
  const libProducao = bibliotecaOk();
  const sessaoHomologacao = {
    inicializada: true,
    producao: false,
    homologacao: true,
    diretorio: "C:\\Users\\teste\\AppData\\Local\\UltraPDV\\conector-homologacao\\TEF\\Homologacao\\PGWeb",
    chamadas: [],
    async end() {
      this.chamadas.push("PW_End");
    },
  };
  let guardada = sessaoHomologacao;
  const testado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      ambiente: "producao",
      diretorio: diretorioProducao,
      pontoInstalado: true,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => libProducao,
      instancia: sessaoHomologacao,
      guardarInstancia(biblioteca) {
        guardada = biblioteca;
      },
      comunicacaoConfirmada: null,
    }
  );
  assert.equal(testado.ok, true);
  assert.equal(testado.comunicacao, "confirmada");
  assert.equal(sessaoHomologacao.chamadas.includes("PW_End"), true);
  assert.equal(libProducao.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);
  assert.equal(libProducao.chamadas.some((item) => item[0] === "PW_iInit" && item[1] === diretorioProducao), true);
  assert.equal(libProducao.chamadas.some((item) => item[0] === "PW_iNewTransac"), false);
  assert.equal(guardada, libProducao);
  assert.equal(libProducao.producao, true);

  const semPontoLib = bibliotecaOk();
  const semPonto = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      ambiente: "producao",
      diretorio: diretorioProducao,
      pontoInstalado: false,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => semPontoLib,
    }
  );
  assert.equal(semPonto.ok, true);
  assert.equal(semPontoLib.chamadas.some((item) => item[0] === "PW_iSetEnvironment" && item[1] === ENVRMNT_PROD), true);
  assert.equal(semPontoLib.chamadas.some((item) => item[0] === "PW_iInit" && item[1] === diretorioProducao), true);
  assert.equal(semPontoLib.chamadas.some((item) => item[0] === "PW_iNewTransac"), false);
  assert.equal(ENVRMNT_PROD, 0);

  const presa = bibliotecaOk();
  presa.setEnvironment = async (codigo) => {
    presa.chamadas.push(["PW_iSetEnvironment", codigo]);
    return PWRET_NOTINST;
  };
  const reaberta = bibliotecaOk();
  let aberturas = 0;
  const recuperada = await executarDiagnosticoHomologacao(
    { acao: "identificar" },
    {
      executar: true,
      ambiente: "producao",
      diretorio: diretorioProducao,
      pontoInstalado: false,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => {
        aberturas += 1;
        return aberturas === 1 ? presa : reaberta;
      },
    }
  );
  assert.equal(recuperada.ok, true);
  assert.equal(presa.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_End"), true);
  assert.equal(reaberta.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iSetEnvironment" && item[1] === ENVRMNT_PROD), true);
  assert.equal(reaberta.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iInit"), true);
  assert.equal(recuperada.dllInicializada, true);

  const insistente = bibliotecaOk();
  insistente.setEnvironment = async (codigo) => {
    insistente.chamadas.push(["PW_iSetEnvironment", codigo]);
    return PWRET_NOTINST;
  };
  const ainda = await executarDiagnosticoHomologacao(
    { acao: "identificar" },
    {
      executar: true,
      ambiente: "producao",
      diretorio: diretorioProducao,
      pontoInstalado: false,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => insistente,
    }
  );
  assert.equal(ainda.ok, true);
  assert.equal(ainda.dllInicializada, true);
  assert.equal(insistente.chamadas.filter((item) => Array.isArray(item) && item[0] === "PW_iSetEnvironment").length, 2);
  assert.equal(insistente.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iInit"), true);
  assert.equal(insistente.chamadas.some((item) => item[0] === "PW_iNewTransac"), false);

  const hash = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      verificarDll: async () => ({ ok: false, arquitetura: "x64", integridade: false }),
      abrir: async () => {
        throw new Error("não deveria carregar");
      },
    }
  );
  assert.equal(hash.codigo, "DLL_DIVERGENTE");

  const ocupado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    { executar: true, raiz: "C:\\UltraPDV", pinpadOcupado: true, abrir: async () => bibliotecaOk() }
  );
  assert.equal(ocupado.codigo, "TRANSACAO_EM_ANDAMENTO");
  assert.equal(ocupado.mensagem, "Transação em andamento");
  assert.equal(pinpadEmOperacaoFinanceira({ pendente: { acao: "pagamento" } }), true);
  assert.equal(pinpadEmOperacaoFinanceira({ pendente: { acao: "teste" } }), false);
  assert.equal(chamadaPermitidaNoDiagnostico("PW_iExecTransac"), false);
  assert.equal(chamadaPermitidaNoDiagnostico("PW_iInit"), true);
});

test("a rota nova não lê o vínculo do Connector e não chama o diagnóstico antigo", () => {
  const servidor = readFileSync(fileURLToPath(new URL("./server.mjs", import.meta.url)), "utf8");
  const inicio = servidor.indexOf('url.pathname === "/tef/homologacao/pinpad"');
  const fim = servidor.indexOf('url.pathname === "/tef/pinpad/diagnostico"');
  const bloco = servidor.slice(inicio, fim);
  assert.equal(inicio > 0 && fim > inicio, true);
  assert.match(bloco, /chave !== "acao"/);
  assert.equal(bloco.includes("lerVinculo"), false);
  assert.equal(bloco.includes("diagnosticarPinpad"), false);
  assert.equal(bloco.includes("PW_iExecTransac"), false);
  const nativo = readFileSync(
    fileURLToPath(new URL("./tef-diagnostico-homologacao.mjs", import.meta.url)),
    "utf8"
  );
  const abertura = nativo.slice(nativo.indexOf("export async function abrirDiagnosticoNativo"));
  for (const bloqueada of FUNCOES_BLOQUEADAS) {
    assert.equal(abertura.includes(bloqueada), false);
  }
  assert.match(abertura, /assinaturaNativa\("PW_iSetEnvironment"\)/);
  assert.match(abertura, /assinaturaNativa\("PW_iInit"\)/);
  assert.match(abertura, /assinaturaNativa\("PW_End"\)/);
  const contrato = readFileSync(fileURLToPath(new URL("./tef-pgweb.mjs", import.meta.url)), "utf8");
  assert.match(contrato, /int16 __stdcall PW_iSetEnvironment\(int16\)/);
  const ciclo = nativo.slice(nativo.indexOf("biblioteca = await deps.abrir"));
  assert.ok(ciclo.indexOf("biblioteca.setEnvironment") < ciclo.indexOf("biblioteca.init"));
});

test("PW_iInit -2494 não encerra a biblioteca", async () => {
  const lib = bibliotecaOk();
  lib.init = async (diretorio) => {
    lib.chamadas.push(["PW_iInit", diretorio]);
    return -2494;
  };
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => lib,
    }
  );
  assert.equal(resultado.codigo, "PW_iInit");
  assert.equal(resultado.codigoBiblioteca, -2494);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_End"), false);
});

test("PW_iSetEnvironment -2494 fora de ordem não inicializa nem testa o pinpad", async () => {
  const lib = bibliotecaOk();
  lib.setEnvironment = async (codigo) => {
    lib.chamadas.push(["PW_iSetEnvironment", codigo]);
    return -2494;
  };
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => lib,
    }
  );
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "PW_iSetEnvironment");
  assert.equal(resultado.codigoBiblioteca, -2494);
  assert.equal(resultado.fase, "ambiente");
  assert.equal(resultado.dllInicializada, false);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iInit"), false);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iPPCommTest"), false);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_End"), false);
});

test("diagnóstico não inicializa enquanto a instalação reserva a DLL", async () => {
  reservarHomologacao("instalacao");
  let abriu = false;
  try {
    const resultado = await executarDiagnosticoHomologacao(
      { acao: "testar" },
      {
        executar: true,
        raiz: "C:\\UltraPDV",
        criarDiretorio: async () => {},
        verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
        abrir: async () => {
          abriu = true;
          return bibliotecaOk();
        },
      }
    );
    assert.equal(resultado.codigo, "SESSAO_INSTALACAO_ATIVA");
    assert.equal(resultado.sessaoAberta, true);
    assert.equal(abriu, false);
  } finally {
    liberarHomologacao("instalacao");
  }
});

test("teste COM7 seguido de identificar preserva a comunicação e não altera o ambiente", async () => {
  esquecerComunicacaoPinpadHomologacao();
  const memoria = { atual: null };
  const depsBase = {
    executar: true,
    raiz: "C:\\UltraPDV",
    criarDiretorio: async () => {},
    verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
    pontoInstalado: true,
    memoria,
  };
  const semAmbiente = (lib) => {
    lib.setEnvironment = async () => {
      throw new Error("PW_iSetEnvironment não deve ser chamado em ponto instalado");
    };
    return lib;
  };
  try {
    const libTeste = semAmbiente(bibliotecaOk(7));
    const testado = await executarDiagnosticoHomologacao(
      { acao: "testar" },
      { ...depsBase, abrir: async () => libTeste }
    );
    assert.equal(testado.ok, true);
    assert.equal(testado.comunicacao, "confirmada");
    assert.equal(testado.porta, 7);
    assert.equal(testado.portaNome, "COM7");
    assert.equal(memoria.atual?.porta, 7);
    assert.equal(libTeste.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);
    assert.deepEqual(libTeste.chamadas.map((item) => item[0]), ["PW_iInit", "PW_iPPCommTest"]);

    const libId = semAmbiente(bibliotecaOk(7));
    const identificado = await executarDiagnosticoHomologacao(
      { acao: "identificar" },
      { ...depsBase, abrir: async () => libId }
    );
    assert.equal(identificado.ok, true);
    assert.equal(identificado.codigo, "PWRET_OK");
    assert.equal(identificado.comunicacaoDestaConsulta, "nao_executada");
    assert.equal(identificado.comunicacao, "confirmada");
    assert.equal(identificado.porta, 7);
    assert.equal(identificado.portaNome, "COM7");
    assert.equal(libId.chamadas.some((item) => item[0] === "PW_iPPCommTest"), false);
    assert.equal(libId.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);
    assert.deepEqual(libId.chamadas.map((item) => item[0]), ["PW_iInit"]);
  } finally {
    esquecerComunicacaoPinpadHomologacao();
  }
});

test("ponto instalado no disco não recebe PW_iSetEnvironment", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "conector-homologacao-"));
  const data = path.win32.join(raiz, "TEF", "Homologacao", "PGWeb", "Data");
  await mkdir(data, { recursive: true });
  await writeFile(path.win32.join(data, "certificado.crt"), "certificado");
  await writeFile(path.win32.join(data, "check.pos"), "ok");
  const chamadas = [];
  try {
    const resultado = await executarDiagnosticoHomologacao(
      { acao: "testar" },
      {
        executar: true,
        raiz,
        verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
        abrir: async () => ({
          async init() {
            chamadas.push("PW_iInit");
            return 0;
          },
          async setEnvironment() {
            chamadas.push("PW_iSetEnvironment");
            return -2494;
          },
          async ppCommTest() {
            chamadas.push("PW_iPPCommTest");
            return { codigo: 0, porta: 7, mensagem: "" };
          },
          async end() {
            chamadas.push("PW_End");
          },
        }),
      }
    );
    assert.equal(resultado.ok, true);
    assert.equal(resultado.pontoInstalado, true);
    assert.equal(resultado.dllInicializada, true);
    assert.equal(resultado.pinpadConectado, true);
    assert.deepEqual(chamadas, ["PW_iInit", "PW_iPPCommTest"]);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("transação ativa recusa o diagnóstico antes de inicializar a DLL", async () => {
  let abriu = false;
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      transacaoAtiva: true,
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => {
        abriu = true;
        throw new Error("não deveria abrir");
      },
    }
  );
  assert.equal(resultado.codigo, "TRANSACAO_EM_ANDAMENTO");
  assert.equal(resultado.mensagem, "Transação em andamento");
  assert.equal(resultado.dllInicializada, false);
  assert.equal(resultado.pinpadConectado, false);
  assert.equal(abriu, false);
});

test("a comunicação confirmada mostra UltraPDV e a versão no mesmo carregamento", async () => {
  const lib = bibliotecaOk(7);
  const vistos = [];
  lib.ppDisplay = async (texto) => {
    vistos.push(["display", texto]);
    return 0;
  };
  lib.ppSetIdleImage = async (texto) => {
    vistos.push(["ociosa", texto]);
    return 0;
  };
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      versaoPinpad: "1.3.19",
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => lib,
    }
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.exibicao.texto, textoPinpadUltraPdv("1.3.19"));
  assert.deepEqual(vistos, [
    ["ociosa", "UltraPDV\r1.3.19"],
    ["display", "UltraPDV\r1.3.19"],
  ]);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iNewTransac"), false);
  const segunda = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      versaoPinpad: "1.3.19",
      instancia: lib,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => {
        throw new Error("não deveria carregar de novo");
      },
    }
  );
  assert.equal(segunda.ok, true);
  assert.equal(vistos.filter((item) => item[0] === "ociosa").length, 1);
});

test("sessão já inicializada não chama SetEnvironment quando PW_iPPCommTest retorna -2494", async () => {
  esquecerComunicacaoPinpadHomologacao();
  const lib = bibliotecaOk(7);
  lib.inicializada = true;
  lib.ppCommTest = async (porta) => {
    lib.chamadas.push(["PW_iPPCommTest", porta]);
    return { codigo: -2494, porta: 0, mensagem: "" };
  };
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      pontoInstalado: true,
      memoria: { atual: { comunicacao: "confirmada", porta: 7, portaNome: "COM7" } },
      instancia: lib,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => {
        throw new Error("não deve recarregar a biblioteca");
      },
    }
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.comunicacao, "confirmada");
  assert.equal(resultado.porta, 7);
  assert.equal(resultado.portaNome, "COM7");
  assert.match(resultado.mensagem, /PW_iPPCommTest retornou -2494/);
  assert.equal(resultado.mensagem.includes("PW_iSetEnvironment recusou"), false);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iInit"), false);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iNewTransac"), false);
});

test("PW_iPPCommTest -2494 sem porta anterior não é atribuído a SetEnvironment", async () => {
  esquecerComunicacaoPinpadHomologacao();
  const lib = bibliotecaOk();
  lib.inicializada = true;
  lib.ppCommTest = async () => {
    lib.chamadas.push(["PW_iPPCommTest"]);
    return { codigo: -2494, porta: 0, mensagem: "" };
  };
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      pontoInstalado: true,
      instancia: lib,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => lib,
    }
  );
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "PW_iPPCommTest");
  assert.equal(resultado.codigoBiblioteca, -2494);
  assert.match(resultado.mensagem, /PW_iPPCommTest recusou a chamada/);
  assert.equal(resultado.mensagem.includes("PW_iSetEnvironment recusou"), false);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);
});

test("ponto instalado e PW_iInit -2494 segue o teste sem configurar o ambiente", async () => {
  const lib = bibliotecaOk(7);
  lib.setEnvironment = async () => {
    throw new Error("PW_iSetEnvironment não deve ser chamado");
  };
  lib.init = async (diretorio) => {
    lib.chamadas.push(["PW_iInit", diretorio]);
    return -2494;
  };
  const resultado = await executarDiagnosticoHomologacao(
    { acao: "testar" },
    {
      executar: true,
      raiz: "C:\\UltraPDV",
      pontoInstalado: true,
      criarDiretorio: async () => {},
      verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
      abrir: async () => lib,
    }
  );
  assert.equal(resultado.ok, true);
  assert.equal(resultado.porta, 7);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iSetEnvironment"), false);
  assert.equal(lib.chamadas.filter((item) => item[0] === "PW_iInit").length, 1);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_iPPCommTest"), true);
  assert.equal(lib.chamadas.some((item) => item[0] === "PW_End"), false);
});
