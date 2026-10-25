import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIRMACAO_INSTALACAO,
  CONFIRMACAO_INSTALACAO_PRODUCAO,
  ENVRMNT_TEST,
  PWOPER_INSTALL,
  definirRelogioCapturaPinpad,
  avaliarPrecondicoesReinstalacao,
  encerrarInstalacaoSemConfirmacao,
  executarInstalacaoIsolada,
  instalacaoHomologacaoConcluida,
  interromperProcessoInstalacao,
  INTERVALO_PW_IPP_EVENT_LOOP_MS,
  prepararTipoGetDataInstalacao,
  PWRET_INVCALL,
  PWRET_TIMEOUT,
  consultarSessaoInstalacao,
  TETO_SEM_ESTADO_TERMINAL_MS,
} from "./tef-instalacao-homologacao.mjs";
import { executarDiagnosticoHomologacao } from "./tef-diagnostico-homologacao.mjs";

function biblioteca(parcial = {}) {
  const chamadas = [];
  const lib = {
    chamadas,
    respondido: false,
    cnfreq: "0",
    codigoExec: 0,
    falha: false,
    espera: false,
    ...parcial,
    async init() {
      chamadas.push("PW_iInit");
      return 0;
    },
    async setEnvironment(codigo) {
      chamadas.push(["PW_iSetEnvironment", codigo]);
      return 0;
    },
    async newTransac(operacao) {
      chamadas.push(["PW_iNewTransac", operacao]);
      return 0;
    },
    async execTransac() {
      chamadas.push("PW_iExecTransac");
      if (this.tresCampos) {
        if (this.fase === "seguinte") return { codigo: 0, capturas: [] };
        return {
          codigo: -2497,
          capturas: [
            { wIdentificador: 0x11, bTipoDeDado: 2, szPrompt: "ponto", bAceitaNulo: 0 },
            { wIdentificador: 0x1c, bTipoDeDado: 2, szPrompt: "documento", bAceitaNulo: 0 },
            { wIdentificador: 0x1b, bTipoDeDado: 2, szPrompt: "servidor", bAceitaNulo: 0 },
          ],
        };
      }
      if (this.falha) return { codigo: -2491, capturas: [] };
      if (this.espera) return { codigo: -2493, capturas: [] };
      if (!this.respondido) {
        return {
          codigo: -2497,
          capturas: [{ wIdentificador: 0x11, bTipoDeDado: 2, szPrompt: "Informe o ponto", bAceitaNulo: 0 }],
        };
      }
      return { codigo: this.codigoExec, capturas: [] };
    },
    async addParam(identificador, valor) {
      chamadas.push(["PW_iAddParam", identificador, valor]);
      if (this.tresCampos && (identificador === 0x11 || identificador === 0x1c || identificador === 0x1b)) {
        this.manuais = (this.manuais ?? 0) + 1;
        if (this.manuais >= 3) this.fase = "seguinte";
      }
      if (!this.tresCampos && identificador === 0x11) this.respondido = true;
      return 0;
    },
    async getResult(info) {
      chamadas.push(["PW_iGetResult", info]);
      if (info === 0x43) return this.cnfreq;
      if (info === 0x11) return "ponto-lab";
      return "ref";
    },
    async confirmation() {
      chamadas.push("PW_iConfirmation");
      return 0;
    },
    async end() {
      chamadas.push("PW_End");
      this.encerrada = true;
    },
  };
  return lib;
}

const pedido = {
  confirmacao: CONFIRMACAO_INSTALACAO,
  ponto: "ponto-lab",
  servidor: "lab.exemplo:31735",
  cnpj: "11222333000181",
};

const depsBase = {
  raiz: "C:\\UltraPDV\\conector-homologacao",
  criarDiretorio: async () => {},
  verificarDll: async () => ({
    ok: true,
    arquitetura: "x64",
    integridade: true,
    versao: "4.1.50.924",
    arquivo: "PGWebLib.dll",
  }),
};

test("o resumo e a falta de confirmação não abrem a DLL", async () => {
  let abriu = false;
  const resumo = await executarInstalacaoIsolada(
    { acao: "resumo" },
    { ...depsBase, abrir: async () => { abriu = true; } }
  );
  assert.equal(resumo.executado, false);
  assert.equal(resumo.abiComprovado, false);
  assert.equal(resumo.ambienteBiblioteca, "ENVRMNT_TEST");
  assert.equal(abriu, false);

  const semFrase = await executarInstalacaoIsolada(
    { acao: "executar", confirmacao: "sim" },
    { ...depsBase, abrir: async () => { abriu = true; } }
  );
  assert.equal(semFrase.codigo, "CONFIRMACAO_AUSENTE");
  assert.equal(semFrase.executado, false);
  assert.equal(abriu, false);
});

let serie = Promise.resolve();

function emSerie(trabalho) {
  const resultado = serie.then(trabalho, trabalho);
  serie = resultado.then(
    () => undefined,
    () => undefined
  );
  return resultado;
}

test("sucesso, confirmação pendente, falha e interrupção não se misturam", async () => {
  await emSerie(async () => {
  const lib = biblioteca();
  const iniciado = await executarInstalacaoIsolada(
    { acao: "executar", ...pedido },
    { ...depsBase, abrir: async () => lib }
  );
  assert.equal(iniciado.codigo, "PWRET_MOREDATA");
  assert.equal(iniciado.sessaoAberta, true);
  const repetida = await executarInstalacaoIsolada(
    { acao: "executar", ...pedido },
    { ...depsBase, abrir: async () => { throw new Error("PW_iInit não deveria ser chamado"); } }
  );
  assert.equal(repetida.codigo, "SESSAO_INSTALACAO_ATIVA");
  assert.equal(repetida.execucaoId, iniciado.execucaoId);
  assert.equal(repetida.sessaoAberta, true);
  assert.equal(lib.encerrada, undefined);
  assert.equal(iniciado.instalado, false);
  assert.equal(iniciado.evidencia, false);
  assert.equal(lib.encerrada, undefined);
  const indiceAmbiente = lib.chamadas.findIndex(
    (item) => Array.isArray(item) && item[0] === "PW_iSetEnvironment"
  );
  const indiceInit = lib.chamadas.indexOf("PW_iInit");
  const indiceInstalacao = lib.chamadas.findIndex(
    (item) => Array.isArray(item) && item[0] === "PW_iNewTransac" && item[1] === PWOPER_INSTALL
  );
  assert.equal(lib.chamadas[indiceAmbiente][1], ENVRMNT_TEST);
  assert.ok(indiceAmbiente < indiceInit);
  assert.ok(indiceInit < indiceInstalacao);
  const execucaoId = iniciado.execucaoId;

  const outraSessao = await executarInstalacaoIsolada({
    acao: "responder",
    execucaoId: "00000000-0000-4000-8000-000000000099",
    respostas: [{ identificador: 0x11, valor: "ponto-lab" }],
  });
  assert.equal(outraSessao.codigo, "SESSAO_DIVERGENTE");
  assert.equal(outraSessao.instalado, false);
  assert.equal(lib.encerrada, undefined);

  const estranho = await executarInstalacaoIsolada({
    acao: "responder",
    execucaoId,
    respostas: [{ identificador: 0x21, valor: "venda" }],
  });
  assert.equal(estranho.codigo, "CAPTURA_NAO_SOLICITADA");
  assert.equal(estranho.instalado, false);

  const seguido = await executarInstalacaoIsolada({
    acao: "responder",
    execucaoId,
    respostas: [{ identificador: 0x11, valor: "ponto-lab" }],
  });
  assert.equal(seguido.codigo, "PWRET_OK");
  assert.equal(seguido.execucaoId, execucaoId);
  assert.equal(seguido.instalado, true);
  assert.equal(seguido.evidencia, true);
  assert.equal(seguido.cnfreq, "0");
  assert.equal(seguido.sessaoAberta, false);
  assert.equal(JSON.stringify(seguido).includes("11222333000181"), false);
  assert.equal(lib.encerrada, true);
  const par = generateKeyPairSync("ed25519");
  const assinada = await executarInstalacaoIsolada(
    {
      acao: "assinar",
      execucaoId: seguido.execucaoId,
      empresaId: "11111111-1111-4111-8111-111111111111",
      dispositivoId: "33333333-3333-4333-8333-333333333333",
      terminalId: "44444444-4444-4444-8444-444444444444",
      estabelecimento: "LAB",
      ponto: "outro-ponto",
    },
    {
      lerChave: async () => ({
        id: "55555555-5555-4555-8555-555555555555",
        publica: par.publicKey.export({ type: "spki", format: "pem" }).toString(),
        privada: par.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
    }
  );
  assert.equal(assinada.ok, true);
  assert.equal(assinada.ponto, "ponto-lab");
  assert.equal("privada" in assinada, false);
  assert.equal(JSON.stringify(assinada).includes("BEGIN PRIVATE"), false);

  const pendenteLib = biblioteca({ cnfreq: "1" });
  const pendenteInicio = await executarInstalacaoIsolada(
    { acao: "executar", ...pedido },
    { ...depsBase, abrir: async () => pendenteLib }
  );
  const pendente = await executarInstalacaoIsolada({
    acao: "responder",
    execucaoId: pendenteInicio.execucaoId,
    respostas: [{ identificador: 0x11, valor: "ponto-lab" }],
  });
  assert.equal(pendente.codigo, "AGUARDANDO_CONFIRMACAO");
  assert.equal(pendente.instalado, false);
  assert.equal(pendente.sessaoAberta, true);
  assert.equal(pendente.cnfreq, "1");
  assert.equal(pendenteLib.encerrada, undefined);
  assert.equal("reqNum" in pendente, false);
  assert.equal(JSON.stringify(pendente).includes("11222333000181"), false);
  const confirmado = await executarInstalacaoIsolada({
    acao: "confirmar",
    confirmacao: CONFIRMACAO_INSTALACAO,
    execucaoId: pendente.execucaoId,
  });
  assert.equal(confirmado.codigo, "INSTALADO_CONFIRMADO");
  assert.equal(confirmado.instalado, true);
  assert.equal(confirmado.evidencia, true);
  assert.equal(JSON.stringify(confirmado).includes("11222333000181"), false);

  const desfazerLib = biblioteca({ cnfreq: "1" });
  const desfazerInicio = await executarInstalacaoIsolada(
    { acao: "executar", ...pedido },
    { ...depsBase, abrir: async () => desfazerLib }
  );
  const desfazerPendente = await executarInstalacaoIsolada({
    acao: "responder",
    execucaoId: desfazerInicio.execucaoId,
    respostas: [{ identificador: 0x11, valor: "ponto-lab" }],
  });
  const desfeita = await executarInstalacaoIsolada({
    acao: "desfazer",
    confirmacao: CONFIRMACAO_INSTALACAO,
    execucaoId: desfazerPendente.execucaoId,
  });
  assert.equal(desfeita.codigo, "DESFEITA");
  assert.equal(desfeita.instalado, false);
  assert.equal(desfeita.evidencia, false);

  const falhaLib = biblioteca({ falha: true, respondido: true });
  const falha = await executarInstalacaoIsolada(
    { acao: "executar", ...pedido },
    { ...depsBase, abrir: async () => falhaLib }
  );
  assert.equal(falha.ok, false);
  assert.equal(falha.instalado, false);
  assert.equal(falha.evidencia, false);
  assert.equal(falhaLib.encerrada, true);

  const esperaLib = biblioteca({ espera: true, respondido: true });
  const espera = await executarInstalacaoIsolada(
    { acao: "executar", ...pedido },
    { ...depsBase, abrir: async () => esperaLib }
  );
  assert.equal(espera.codigo, "PWRET_NOTHING");
  assert.equal(espera.instalado, false);

  const aberta = biblioteca();
  const abertaInicio = await executarInstalacaoIsolada(
    { acao: "executar", ...pedido },
    { ...depsBase, abrir: async () => aberta }
  );
  interromperProcessoInstalacao();
  const morta = await executarInstalacaoIsolada({
    acao: "responder",
    execucaoId: abertaInicio.execucaoId,
    respostas: [{ identificador: 0x11, valor: "ponto-lab" }],
  });
  assert.equal(morta.codigo, "SESSAO_AUSENTE");
  assert.equal(morta.interrompida, true);
  assert.equal(morta.instalado, false);
  assert.equal(
    aberta.chamadas.some((item) => item === "PW_End" || (Array.isArray(item) && item[1] === 0x11)),
    false
  );
  assert.deepEqual(
    aberta.chamadas.filter((item) => Array.isArray(item) && item[1] === 0x7f01),
    [["PW_iAddParam", 0x7f01, "1"]]
  );
  assert.deepEqual(
    aberta.chamadas.filter((item) => Array.isArray(item) && item[1] === 0x7f02),
    [["PW_iAddParam", 0x7f02, "0"]]
  );
  assert.equal(Number(aberta.chamadas.find((item) => Array.isArray(item) && item[1] === 0x24)?.[2]) & 64, 0);
  const retroativa = await executarInstalacaoIsolada({
    acao: "assinar",
    execucaoId: abertaInicio.execucaoId,
    empresaId: "11111111-1111-4111-8111-111111111111",
    dispositivoId: "33333333-3333-4333-8333-333333333333",
    terminalId: "44444444-4444-4444-8444-444444444444",
    estabelecimento: "LAB",
  });
  assert.equal(retroativa.codigo, "CONCLUSAO_AUSENTE");
  assert.equal(retroativa.instalado, false);
  assert.equal("assinatura" in retroativa, false);
  });
});

test("instalação simulada percorre capturas, espera, confirmação, PinPad e encerramento", async () => {
  await emSerie(async () => {
    interromperProcessoInstalacao();
    const chamadas = [];
    let fase = "ponto";
    let esperaExec = 0;
    const lib = {
      async init() {
        chamadas.push("PW_iInit");
        return 0;
      },
      async setEnvironment(codigo) {
        chamadas.push("PW_iSetEnvironment");
        assert.equal(codigo, 1);
        return 0;
      },
      async newTransac(operacao) {
        chamadas.push("PW_iNewTransac");
        assert.equal(operacao, 0x01);
        return 0;
      },
      async execTransac() {
        chamadas.push("PW_iExecTransac");
        if (fase === "ponto") {
          return { codigo: -2497, capturas: [{ wIdentificador: 0x11, bTipoDeDado: 2, szPrompt: "ponto" }] };
        }
        if (fase === "pinpad") {
          return { codigo: -2497, capturas: [{ wIdentificador: 0x15, bTipoDeDado: 5, szPrompt: "digite no pinpad" }] };
        }
        if (fase === "pin") {
          return { codigo: -2497, capturas: [{ wIdentificador: 0xcf, bTipoDeDado: 6, szPrompt: "senha" }] };
        }
        if (fase === "espera") {
          esperaExec += 1;
          if (esperaExec === 1) return { codigo: -2493, capturas: [] };
          fase = "ok";
          return { codigo: -2495, capturas: [] };
        }
        return { codigo: 0, capturas: [] };
      },
      async addParam(identificador, valor) {
        chamadas.push(["PW_iAddParam", identificador, valor]);
        if (identificador === 0x11) fase = "pinpad";
        return 0;
      },
      async ppGetData(indice) {
        chamadas.push(["PW_iPPGetData", indice]);
        fase = "pin";
        return 0;
      },
      async ppGetPin(indice) {
        chamadas.push(["PW_iPPGetPIN", indice]);
        fase = "espera";
        return 0;
      },
      async ppEventLoop() {
        chamadas.push("PW_iPPEventLoop");
        return 0;
      },
      async getResult(info) {
        if (info === 0x43) return "1";
        if (info === 0x11) return "ponto-lab";
        return "ref";
      },
      async confirmation() {
        chamadas.push("PW_iConfirmation");
        return 0;
      },
      async end() {
        chamadas.push("PW_End");
        this.encerrada = true;
      },
    };
    const deps = { ...depsBase, abrir: async () => lib };
    const inicio = await executarInstalacaoIsolada({ acao: "executar", ...pedido }, deps);
    assert.equal(inicio.codigo, "PWRET_MOREDATA");
    const resposta = await executarInstalacaoIsolada(
      {
        acao: "responder",
        confirmacao: CONFIRMACAO_INSTALACAO,
        execucaoId: inicio.execucaoId,
        respostas: [{ identificador: 0x11, valor: "ponto-lab" }],
      },
      deps
    );
    assert.equal(resposta.codigo, "AGUARDANDO_CONFIRMACAO");
    assert.equal(resposta.instalado, false);
    assert.deepEqual(
      chamadas.filter((item) => Array.isArray(item) && item[0] === "PW_iPPGetData"),
      [["PW_iPPGetData", 0]]
    );
    assert.deepEqual(
      chamadas.filter((item) => Array.isArray(item) && item[0] === "PW_iPPGetPIN"),
      [["PW_iPPGetPIN", 0]]
    );
    assert.ok(chamadas.includes("PW_iPPEventLoop"));
    const confirmada = await executarInstalacaoIsolada(
      { acao: "confirmar", confirmacao: CONFIRMACAO_INSTALACAO, execucaoId: inicio.execucaoId },
      deps
    );
    assert.equal(confirmada.codigo, "INSTALADO_CONFIRMADO");
    assert.equal(confirmada.instalado, true);
    assert.equal(lib.encerrada, true);
    assert.equal(chamadas.at(-1), "PW_End");

    const semPinpad = [];
    const ausente = await executarInstalacaoIsolada(
      { acao: "executar", ...pedido },
      {
        ...depsBase,
        abrir: async () => ({
          async init() {
            return 0;
          },
          async setEnvironment() {
            return 0;
          },
          async newTransac() {
            return 0;
          },
          async addParam() {
            return 0;
          },
          async execTransac() {
            semPinpad.push("PW_iExecTransac");
            return { codigo: -2497, capturas: [{ wIdentificador: 0x15, bTipoDeDado: 5, szPrompt: "pinpad" }] };
          },
          async end() {
            semPinpad.push("PW_End");
          },
        }),
        perfil: async () => ({ ok: true, diretorio: "C:\\lab\\homologacao" }),
      }
    );
    assert.equal(ausente.codigo, "CAPTURA_PINPAD_AUSENTE");
    assert.equal(ausente.instalado, false);
    assert.equal(ausente.capturas, undefined);
    assert.deepEqual(semPinpad, ["PW_iExecTransac"]);
    interromperProcessoInstalacao();
  });
});

test("remoção de cartão distingue início, espera e estado terminal", async () => {
  await emSerie(async () => {
    let instante = 0;
    definirRelogioCapturaPinpad({
      agora: () => instante,
      esperar: async (milissegundos) => {
        instante += milissegundos;
      },
    });
    try {
      assert.equal(INTERVALO_PW_IPP_EVENT_LOOP_MS, 500);
      interromperProcessoInstalacao();
      let sondagens = 0;
      let fase = "remover";
      const chamadas = [];
      const lib = {
        async init() {
          return 0;
        },
        async setEnvironment() {
          return 0;
        },
        async newTransac() {
          return 0;
        },
        async addParam() {
          return 0;
        },
        async execTransac() {
          chamadas.push("PW_iExecTransac");
          if (fase === "remover") {
            return { codigo: -2497, capturas: [{ wIdentificador: 0, bTipoDeDado: 13, szPrompt: "retire o cartao" }] };
          }
          return { codigo: 0, capturas: [] };
        },
        async ppRemoveCard() {
          chamadas.push("PW_iPPRemoveCard");
          return 0;
        },
        async ppEventLoop() {
          sondagens += 1;
          chamadas.push("PW_iPPEventLoop");
          if (sondagens <= 9) return { codigo: -2493, display: "aguardando" };
          fase = "seguinte";
          return { codigo: 0, display: "" };
        },
        async ppAbort() {
          chamadas.push("PW_iPPAbort");
          return 0;
        },
        async getResult(info) {
          if (info === 0x43) return "0";
          if (info === 0x11) return "ponto-lab";
          return "";
        },
        async end() {
          chamadas.push("PW_End");
          this.encerrada = true;
        },
      };
      const deps = { ...depsBase, abrir: async () => lib };
      const removido = await executarInstalacaoIsolada({ acao: "executar", ...pedido }, deps);
      assert.equal(removido.instalado, true);
      assert.equal(sondagens, 10);
      assert.equal(chamadas.includes("PW_iPPAbort"), false);
      assert.equal(chamadas.filter((item) => item === "PW_iExecTransac").length, 2);
      assert.equal(lib.encerrada, true);

      instante = 0;
      const timeout = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        {
          ...depsBase,
          abrir: async () => ({
            async init() {
              return 0;
            },
            async setEnvironment() {
              return 0;
            },
            async newTransac() {
              return 0;
            },
            async addParam() {
              return 0;
            },
            async execTransac() {
              return { codigo: -2497, capturas: [{ bTipoDeDado: 13 }] };
            },
            async ppRemoveCard() {
              return 0;
            },
            async ppEventLoop() {
              return { codigo: PWRET_TIMEOUT, display: "tempo esgotado" };
            },
            async ppAbort() {
              throw new Error("PW_iPPAbort não deveria interromper um PWRET_TIMEOUT");
            },
            async end() {
              this.encerrada = true;
            },
          }),
        }
      );
      assert.equal(timeout.codigo, "PWRET_TIMEOUT");
      assert.equal(timeout.codigoBiblioteca, -2490);
      assert.equal(timeout.instalado, false);
      assert.equal(timeout.sessaoAberta, true);
      assert.equal(timeout.display, "tempo esgotado");
      interromperProcessoInstalacao();

      const invalida = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        {
          ...depsBase,
          abrir: async () => ({
            async init() {
              return 0;
            },
            async setEnvironment() {
              return 0;
            },
            async newTransac() {
              return 0;
            },
            async addParam() {
              return 0;
            },
            async execTransac() {
              return { codigo: -2497, capturas: [{ bTipoDeDado: 13 }] };
            },
            async ppRemoveCard() {
              return 0;
            },
            async ppEventLoop() {
              return PWRET_INVCALL;
            },
            async end() {
              this.encerrada = true;
            },
          }),
        }
      );
      assert.equal(invalida.codigo, "PWRET_INVCALL");
      assert.equal(invalida.instalado, false);
      assert.equal(invalida.sessaoAberta, true);
      interromperProcessoInstalacao();

      let voltas = 0;
      let abortou = false;
      const teto = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        {
          ...depsBase,
          abrir: async () => ({
            async init() {
              return 0;
            },
            async setEnvironment() {
              return 0;
            },
            async newTransac() {
              return 0;
            },
            async addParam() {
              return 0;
            },
            async execTransac() {
              return { codigo: -2497, capturas: [{ bTipoDeDado: 13 }] };
            },
            async ppRemoveCard() {
              return 0;
            },
            async ppEventLoop() {
              voltas += 1;
              return { codigo: -2495, display: "retire o cartao" };
            },
            async ppAbort() {
              abortou = true;
              return 0;
            },
            async end() {
              this.encerrada = true;
            },
          }),
        }
      );
      assert.equal(teto.codigo, "CAPTURA_SEM_ESTADO_TERMINAL");
      assert.equal(teto.instalado, false);
      assert.equal(teto.sessaoAberta, true);
      assert.equal(abortou, true);
      assert.ok(voltas > 8);
      assert.ok(instante >= TETO_SEM_ESTADO_TERMINAL_MS);
      interromperProcessoInstalacao();
    } finally {
      definirRelogioCapturaPinpad(null);
    }
  });
});

test("duas preparações registram PW_GetDataInstalacao uma única vez", () => {
  const chamadas = [];
  const koffi = {
    array(tipo, tamanho) {
      return { tipo, tamanho };
    },
    struct(nome, campos) {
      chamadas.push(nome);
      if (chamadas.filter((item) => item === nome).length > 1) {
        throw new Error(`Duplicate type name '${nome}'`);
      }
      return { nome, campos };
    },
  };
  const cache = { tipo: null };
  const primeiro = prepararTipoGetDataInstalacao(koffi, cache);
  const segundo = prepararTipoGetDataInstalacao(koffi, cache);
  assert.equal(primeiro, segundo);
  assert.deepEqual(chamadas, ["PW_GetDataInstalacao"]);
  assert.equal(Object.keys(primeiro.campos).length, 31);
  assert.equal(primeiro.campos.szPrompt.tamanho, 84);
  assert.equal(primeiro.campos.vszTextoMenu.tamanho, 40);
  assert.equal(primeiro.campos.vszTextoMenu.tipo.tamanho, 41);
  assert.equal(primeiro.campos.vszValorMenu.tamanho, 40);
  assert.equal(primeiro.campos.vszValorMenu.tipo.tamanho, 256);
  assert.equal(primeiro.campos.szMascaraDeCaptura.tamanho, 41);
  assert.equal(primeiro.campos.ulValorMinimo, "uint32");
  assert.equal(primeiro.campos.ulValorMaximo, "uint32");
  assert.equal(primeiro.campos.ulTipoEntradaCartao, "uint32");
  assert.equal(primeiro.campos.bAlinhaPelaDireita, "uint8");
  const koffiProcesso = {
    array(tipo, tamanho) {
      return { tipo, tamanho };
    },
    struct(nome, campos) {
      if (koffiProcesso.registrado) throw new Error(`Duplicate type name '${nome}'`);
      koffiProcesso.registrado = true;
      return { nome, campos };
    },
    registrado: false,
  };
  const noProcesso = prepararTipoGetDataInstalacao(koffiProcesso);
  assert.equal(prepararTipoGetDataInstalacao(koffiProcesso), noProcesso);
  assert.equal(noProcesso, primeiro);
  assert.equal(koffiProcesso.registrado, false);
  const pgweb = readFileSync(fileURLToPath(new URL("./tef-pgweb.mjs", import.meta.url)), "utf8");
  assert.match(pgweb, /ABI_COMPROVADO = false/);
  assert.match(pgweb, /LAYOUT_HOMOLOGADO = false/);
});

test("venda, produção e o Connector financeiro permanecem fora", async () => {
  const venda = await executarInstalacaoIsolada(
    { acao: "executar", confirmacao: CONFIRMACAO_INSTALACAO, operacao: 0x21 },
    { ...depsBase, abrir: async () => { throw new Error("não deveria abrir"); } }
  );
  assert.equal(venda.codigo, "OPERACAO_BLOQUEADA");

  const producao = await executarInstalacaoIsolada(
    { acao: "executar", confirmacao: CONFIRMACAO_INSTALACAO },
    { ...depsBase, raiz: "C:\\ProgramData\\UltraPDV\\TEF\\Producao", abrir: async () => { throw new Error("não deveria abrir"); } }
  );
  assert.equal(producao.codigo, "DIRETORIO_PRODUCAO");

  const servidor = readFileSync(fileURLToPath(new URL("./server.mjs", import.meta.url)), "utf8");
  assert.equal(servidor.includes("PW_iExecTransac"), false);
  assert.equal(servidor.includes("18281"), false);
  assert.match(servidor, /\/tef\/homologacao\/instalacao/);
  assert.match(servidor, /pastaConectorHomologacao\(\)/);
  const fonte = readFileSync(fileURLToPath(new URL("./tef-instalacao-homologacao.mjs", import.meta.url)), "utf8");
  assert.equal(fonte.includes("lerVinculo"), false);
  assert.equal(fonte.includes("print-agent.json"), false);
  assert.equal(fonte.includes("18181"), false);
});

test("três campos digitados seguem juntos com a mesma execução", async () => {
  await emSerie(async () => {
    const lib = biblioteca({ tresCampos: true });
    try {
      const iniciado = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        { ...depsBase, abrir: async () => lib }
      );
      assert.equal(iniciado.codigo, "PWRET_MOREDATA");
      assert.equal(iniciado.execucaoId.length > 0, true);
      assert.deepEqual(
        iniciado.capturas.map((item) => item.identificador),
        [0x11, 0x1c, 0x1b]
      );
      assert.equal(iniciado.capturas.every((item) => item.tipo === 2), true);
      const execucaoId = iniciado.execucaoId;
      const adicoes = () =>
        lib.chamadas.filter(
          (item) => Array.isArray(item) && item[0] === "PW_iAddParam" && [0x11, 0x1c, 0x1b].includes(item[1])
        ).length;
      assert.equal(adicoes(), 0);

      const divergente = await executarInstalacaoIsolada({
        acao: "responder",
        execucaoId: "00000000-0000-4000-8000-000000000099",
        respostas: [
          { identificador: 0x11, valor: "ponto-lab" },
          { identificador: 0x1c, valor: "documento-lab" },
          { identificador: 0x1b, valor: "lab.exemplo:31735" },
        ],
      });
      assert.equal(divergente.codigo, "SESSAO_DIVERGENTE");
      assert.equal(adicoes(), 0);

      const vazio = await executarInstalacaoIsolada({
        acao: "responder",
        execucaoId,
        respostas: [
          { identificador: 0x11, valor: "ponto-lab" },
          { identificador: 0x1c, valor: " " },
          { identificador: 0x1b, valor: "lab.exemplo:31735" },
        ],
      });
      assert.equal(vazio.codigo, "CAPTURA_VAZIA");
      assert.equal(adicoes(), 0);
      assert.equal(Array.isArray(vazio.capturas), false);

      const execucoes = lib.chamadas.filter((item) => item === "PW_iExecTransac").length;
      const seguido = await executarInstalacaoIsolada({
        acao: "responder",
        execucaoId,
        respostas: [
          { identificador: 0x11, valor: "ponto-lab" },
          { identificador: 0x1c, valor: "documento-lab" },
          { identificador: 0x1b, valor: "lab.exemplo:31735" },
        ],
      });
      assert.equal(seguido.codigo, "PWRET_OK");
      assert.equal(seguido.execucaoId, execucaoId);
      assert.equal(Array.isArray(seguido.capturas) ? seguido.capturas.length : 0, 0);
      assert.equal(adicoes(), 3);
      assert.equal(lib.chamadas.filter((item) => item === "PW_iExecTransac").length, execucoes + 1);
      assert.equal(JSON.stringify(seguido).includes("documento-lab"), false);
    } finally {
      interromperProcessoInstalacao();
    }
  });
});

test("a consulta lê a sessão aberta sem nova operação nativa", async () => {
  await emSerie(async () => {
    const lib = biblioteca({ tresCampos: true });
    try {
      const iniciado = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        { ...depsBase, abrir: async () => lib }
      );
      const antes = lib.chamadas.length;
      const consulta = await executarInstalacaoIsolada({ acao: "consultar" });
      assert.equal(lib.chamadas.length, antes);
      assert.equal(
        lib.chamadas.some((item) => item === "PW_End" || item === "PW_iConfirmation" || item === "PW_iPPAbort"),
        false
      );
      assert.equal(consulta.codigo, "INSTALACAO_ABERTA");
      assert.equal(consulta.ativa, true);
      assert.equal(consulta.execucaoId, iniciado.execucaoId);
      assert.deepEqual(
        consulta.capturas.map((item) => item.identificador),
        [0x11, 0x1c, 0x1b]
      );
      assert.equal(consulta.capturas.every((item) => item.valorSugerido === ""), true);
      const texto = JSON.stringify(consulta);
      assert.equal(texto.includes(pedido.cnpj), false);
      assert.equal(texto.includes(pedido.ponto), false);
      assert.equal(texto.includes(pedido.servidor), false);
      const segue = await executarInstalacaoIsolada({
        acao: "responder",
        execucaoId: "",
        respostas: [],
      });
      assert.equal(segue.codigo, "SESSAO_DIVERGENTE");
      assert.equal(segue.execucaoId, iniciado.execucaoId);
      assert.equal(lib.chamadas.length, antes);
    } finally {
      interromperProcessoInstalacao();
    }
    const vazia = await executarInstalacaoIsolada({ acao: "consultar" });
    assert.equal(vazia.ativa, false);
    assert.equal(vazia.capturas.length, 0);
  });
});

test("instalação concluída seguida do diagnóstico não altera o ambiente", async () => {
  await emSerie(async () => {
    const lib = biblioteca();
    try {
      const iniciado = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        { ...depsBase, abrir: async () => lib }
      );
      const concluida = await executarInstalacaoIsolada({
        acao: "responder",
        execucaoId: iniciado.execucaoId,
        respostas: [{ identificador: 0x11, valor: "ponto-lab" }],
      });
      assert.equal(concluida.codigo, "PWRET_OK");
      assert.equal(concluida.sessaoAberta, false);
      assert.equal(consultarSessaoInstalacao().ativa, false);
      assert.equal(instalacaoHomologacaoConcluida(), true);
      assert.equal(lib.chamadas.some((item) => item === "PW_End"), true);

      let alterouAmbiente = false;
      const diagnostico = await executarDiagnosticoHomologacao(
        { acao: "testar" },
        {
          executar: true,
          raiz: "C:\\UltraPDV",
          pontoInstalado: true,
          criarDiretorio: async () => {},
          verificarDll: async () => ({ ok: true, arquitetura: "x64", integridade: true, arquivo: "PGWebLib.dll" }),
          abrir: async () => ({
            async init() {
              return 0;
            },
            async setEnvironment() {
              alterouAmbiente = true;
              return -2494;
            },
            async ppCommTest() {
              return { codigo: 0, porta: 7, mensagem: "" };
            },
            async end() {},
          }),
        }
      );
      assert.equal(alterouAmbiente, false);
      assert.equal(diagnostico.ok, true);
      assert.equal(diagnostico.codigo, "PWRET_OK");
      assert.equal(diagnostico.chamadas.includes("PW_iInit"), true);
      assert.equal(diagnostico.chamadas.includes("PW_iSetEnvironment"), false);
      assert.equal(diagnostico.chamadas.includes("PW_iPPCommTest"), true);
      assert.equal(diagnostico.chamadas.includes("PW_End"), false);
      assert.equal(consultarSessaoInstalacao().ativa, false);
    } finally {
      interromperProcessoInstalacao();
    }
  });
});

test("instalação sem confirmação encerra a DLL e a confirmação pendente permanece", async () => {
  await emSerie(async () => {
    interromperProcessoInstalacao();
    const aberta = biblioteca();
    try {
      const inicio = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        { ...depsBase, abrir: async () => aberta }
      );
      assert.equal(inicio.codigo, "PWRET_MOREDATA");
      const encerrada = await encerrarInstalacaoSemConfirmacao();
      assert.equal(encerrada.ok, true);
      assert.equal(encerrada.instalado, false);
      assert.equal(aberta.chamadas.includes("PW_End"), true);
      assert.equal(consultarSessaoInstalacao().ativa, false);

      const confirmavel = biblioteca({ cnfreq: "1", respondido: true });
      const aguardando = await executarInstalacaoIsolada(
        { acao: "executar", ...pedido },
        { ...depsBase, abrir: async () => confirmavel }
      );
      assert.equal(aguardando.codigo, "AGUARDANDO_CONFIRMACAO");
      const preservada = await encerrarInstalacaoSemConfirmacao();
      assert.equal(preservada.ok, false);
      assert.equal(preservada.codigo, "CONFIRMACAO_PENDENTE");
      assert.equal(confirmavel.chamadas.includes("PW_End"), false);
      assert.equal(consultarSessaoInstalacao().ativa, true);
    } finally {
      interromperProcessoInstalacao();
    }
  });
});

test("reinstalar produção apaga só Data e volta a pedir o ambiente antes do Init", async () => {
  await emSerie(async () => {
    interromperProcessoInstalacao();
    const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-reinstalar-"));
    const diretorio = path.win32.join(base, "TEF", "Producao", "PGWeb");
    const data = path.win32.join(diretorio, "Data");
    await mkdir(data, { recursive: true });
    await writeFile(path.win32.join(data, "certificado.crt"), "x");
    await writeFile(path.win32.join(data, "check.pos"), "x");
    await writeFile(path.win32.join(diretorio, "tef-journal-manter.json"), "{}");
    const lib = biblioteca();
    try {
      const aberto = await executarInstalacaoIsolada(
        {
          acao: "executar",
          confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO,
          reinstalar: true,
          ponto: "ponto-lab",
          servidor: "lab.exemplo:31735",
          cnpj: "11222333000181",
        },
        {
          ambiente: "producao",
          diretorio,
          criarDiretorio: async () => {},
          verificarDll: depsBase.verificarDll,
          abrir: async () => lib,
        }
      );
      assert.equal(aberto.codigo, "PWRET_MOREDATA");
      assert.equal(
        lib.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iSetEnvironment" && item[1] === 0),
        true
      );
      await assert.rejects(stat(data));
      const journal = await readFile(path.win32.join(diretorio, "tef-journal-manter.json"), "utf8");
      assert.equal(journal, "{}");
    } finally {
      interromperProcessoInstalacao();
      await rm(base, { recursive: true, force: true });
    }
  });
});

test("pré-condição recusada não remove Data e a senha técnica não entra no retorno", async () => {
  await emSerie(async () => {
    interromperProcessoInstalacao();
    const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-precondicao-"));
    const diretorio = path.win32.join(base, "TEF", "Producao", "PGWeb");
    const data = path.win32.join(diretorio, "Data");
    await mkdir(data, { recursive: true });
    await writeFile(path.win32.join(data, "certificado.crt"), "x");
    await writeFile(path.win32.join(data, "check.pos"), "x");
    const senha = "segredo-nao-gravar";
    const lib = biblioteca();
    const acrescentar = lib.addParam.bind(lib);
    lib.addParam = async (identificador, valor) => {
      if (identificador === 0xf6) lib.respondido = true;
      return acrescentar(identificador, valor);
    };
    lib.execTransac = async () => {
      lib.chamadas.push("PW_iExecTransac");
      if (!lib.respondido) {
        return {
          codigo: -2497,
          capturas: [{ wIdentificador: 0xf6, bTipoDeDado: 17, szPrompt: "tecnica", bAceitaNulo: 0 }],
        };
      }
      return { codigo: 0, capturas: [] };
    };
    let abriu = false;
    try {
      const bloqueada = await executarInstalacaoIsolada(
        {
          acao: "executar",
          confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO,
          reinstalar: true,
          ponto: "ponto-lab",
          servidor: "lab.exemplo:31735",
          cnpj: "11222333000181",
        },
        {
          ambiente: "producao",
          diretorio,
          porta: 18182,
          ouvintes: 2,
          criarDiretorio: async () => {},
          verificarDll: depsBase.verificarDll,
          abrir: async () => {
            abriu = true;
            return lib;
          },
        }
      );
      assert.equal(bloqueada.ok, false);
      assert.equal(bloqueada.codigo, "PRECONDICOES");
      assert.equal(bloqueada.removeData, false);
      assert.deepEqual(bloqueada.falhas, ["CONECTOR_UNICO"]);
      assert.equal(abriu, false);
      assert.equal((await stat(path.win32.join(data, "certificado.crt"))).isFile(), true);

      const previa = await executarInstalacaoIsolada(
        { acao: "precondicoes", confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO },
        { ambiente: "producao", diretorio, porta: 18182, ouvintes: 1 }
      );
      assert.equal(previa.ok, true);
      assert.equal(previa.removeData, false);
      assert.equal(avaliarPrecondicoesReinstalacao({
        ambiente: "producao",
        confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO,
        diretorioValido: true,
        porta: 18182,
        ouvintes: 1,
        ocupacao: "livre",
      }).ok, true);

      const aberto = await executarInstalacaoIsolada(
        {
          acao: "executar",
          confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO,
          reinstalar: true,
          ponto: "ponto-lab",
          servidor: "lab.exemplo:31735",
          cnpj: "11222333000181",
        },
        {
          ambiente: "producao",
          diretorio,
          porta: 18182,
          ouvintes: 1,
          criarDiretorio: async () => {},
          verificarDll: depsBase.verificarDll,
          abrir: async () => lib,
        }
      );
      assert.equal(aberto.codigo, "PWRET_MOREDATA");
      assert.equal(aberto.capturas[0].identificador, 0xf6);
      assert.equal(aberto.capturas[0].prompt, "Senha técnica");
      assert.equal("valor" in aberto.capturas[0], false);
      assert.equal(aberto.etapas.some((item) => item.funcao === "PW_iSetEnvironment" && item.codigo === 0), true);
      assert.equal(aberto.etapas.some((item) => item.funcao === "PW_iInit" && item.codigo === 0), true);
      assert.equal(aberto.etapas.some((item) => item.funcao === "PW_iNewTransac" && item.codigo === 0), true);
      assert.equal(aberto.etapas.some((item) => item.funcao === "PW_iExecTransac" && item.codigo === -2497), true);
      assert.equal(aberto.etapas.some((item) => item.funcao === "PW_GetData" && item.identificador === 0xf6), true);
      const respondido = await executarInstalacaoIsolada({
        acao: "responder",
        execucaoId: aberto.execucaoId,
        respostas: [{ identificador: 0xf6, valor: senha }],
      });
      assert.equal(JSON.stringify(respondido).includes(senha), false);
      assert.equal(JSON.stringify(aberto).includes(senha), false);
    } finally {
      interromperProcessoInstalacao();
      await rm(base, { recursive: true, force: true });
    }
  });
});

test("evidência validada impede nova instalação e PW_iSetEnvironment", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "conector-homologacao-"));
  const data = path.win32.join(raiz, "TEF", "Homologacao", "PGWeb", "Data");
  await mkdir(data, { recursive: true });
  await writeFile(path.win32.join(data, "certificado.crt"), "certificado");
  await writeFile(path.win32.join(data, "check.pos"), "ok");
  let abriu = false;
  try {
    const consulta = await executarInstalacaoIsolada({ acao: "consultar" }, { raiz });
    assert.equal(consulta.codigo, "JA_INSTALADO");
    assert.equal(consulta.mensagem, "Já instalado");
    const resultado = await executarInstalacaoIsolada(
      { acao: "executar", confirmacao: CONFIRMACAO_INSTALACAO, operacao: PWOPER_INSTALL },
      {
        raiz,
        abrir: async () => {
          abriu = true;
          throw new Error("não deveria abrir");
        },
      }
    );
    assert.equal(resultado.codigo, "JA_INSTALADO");
    assert.equal(resultado.mensagem, "Já instalado");
    assert.equal(resultado.executado, false);
    assert.deepEqual(resultado.chamadas, []);
    assert.equal(abriu, false);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("produção sem ponto usa ENVRMNT_PROD antes do Init e o ponto instalado não abre a biblioteca", async () => {
  await emSerie(async () => {
    interromperProcessoInstalacao();
    const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-prod-"));
    const diretorio = path.win32.join(base, "TEF", "Producao", "PGWeb");
    await mkdir(diretorio, { recursive: true });
    const lib = biblioteca();
    try {
      const aberto = await executarInstalacaoIsolada(
        {
          acao: "executar",
          confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO,
          ponto: "ponto-lab",
          servidor: "lab.exemplo:31735",
          cnpj: "11222333000181",
        },
        {
          ambiente: "producao",
          diretorio,
          criarDiretorio: async () => {},
          verificarDll: depsBase.verificarDll,
          abrir: async () => lib,
        }
      );
      assert.equal(aberto.codigo, "PWRET_MOREDATA");
      const indiceAmbiente = lib.chamadas.findIndex(
        (item) => Array.isArray(item) && item[0] === "PW_iSetEnvironment"
      );
      const indiceInit = lib.chamadas.indexOf("PW_iInit");
      assert.equal(lib.chamadas[indiceAmbiente][1], 0);
      assert.ok(indiceAmbiente < indiceInit);
      assert.equal(lib.chamadas.some((item) => Array.isArray(item) && item[1] === 0xf6), false);
      interromperProcessoInstalacao();
      const data = path.win32.join(diretorio, "Data");
      await mkdir(data, { recursive: true });
      await writeFile(path.win32.join(data, "certificado.crt"), "x");
      await writeFile(path.win32.join(data, "check.pos"), "x");
      let abriu = false;
      const ja = await executarInstalacaoIsolada(
        { acao: "executar", confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO },
        {
          ambiente: "producao",
          diretorio,
          abrir: async () => {
            abriu = true;
            throw new Error("não deveria abrir");
          },
        }
      );
      assert.equal(ja.codigo, "JA_INSTALADO");
      assert.equal(abriu, false);

      interromperProcessoInstalacao();
      await rm(path.win32.join(diretorio, "Data"), { recursive: true, force: true });
      const preso = biblioteca();
      let tentativasAmbiente = 0;
      preso.setEnvironment = async (codigo) => {
        preso.chamadas.push(["PW_iSetEnvironment", codigo]);
        tentativasAmbiente += 1;
        return tentativasAmbiente === 1 ? -2498 : 0;
      };
      let residenteEncerrada = false;
      const retomada = await executarInstalacaoIsolada(
        {
          acao: "executar",
          confirmacao: CONFIRMACAO_INSTALACAO_PRODUCAO,
          ponto: "ponto-lab",
          servidor: "lab.exemplo:31735",
          cnpj: "11222333000181",
        },
        {
          ambiente: "producao",
          diretorio,
          criarDiretorio: async () => {},
          verificarDll: depsBase.verificarDll,
          encerrarResidente: async () => {
            residenteEncerrada = true;
          },
          abrir: async () => preso,
        }
      );
      assert.equal(residenteEncerrada, true);
      assert.equal(retomada.codigo, "PWRET_MOREDATA");
      assert.equal(tentativasAmbiente, 2);
      assert.equal(preso.chamadas.includes("PW_End"), true);
      assert.equal(preso.chamadas.includes("PW_iInit"), true);
      assert.equal(
        preso.chamadas.some((item) => Array.isArray(item) && item[0] === "PW_iNewTransac" && item[1] === PWOPER_INSTALL),
        true
      );
    } finally {
      interromperProcessoInstalacao();
      await rm(base, { recursive: true, force: true });
    }
  });
});
