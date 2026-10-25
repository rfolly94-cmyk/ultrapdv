import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Fala JSON Lines com o UltraPDVPgWeb.exe.
 * permitirDll é ignorado: o Connector nunca pede o carregamento da DLL.
 */
export function criarPonteNativa({ executavel, argumentos = [] } = {}) {
  if (!executavel) {
    throw Object.assign(new Error("O executável da ponte PGWeb não foi informado."), {
      code: "PGWEB_PONTE_AUSENTE",
    });
  }
  const filho = spawn(executavel, argumentos, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let seq = 0;
  const pendentes = new Map();
  const leitura = createInterface({ input: filho.stdout });
  leitura.on("line", (linha) => {
    let resposta;
    try {
      resposta = JSON.parse(linha);
    } catch {
      return;
    }
    const espera = pendentes.get(resposta.id);
    if (!espera) return;
    pendentes.delete(resposta.id);
    espera.resolve(resposta);
  });
  filho.on("exit", () => {
    for (const espera of pendentes.values()) {
      espera.reject(Object.assign(new Error("A ponte PGWeb encerrou."), { code: "PGWEB_PONTE" }));
    }
    pendentes.clear();
  });
  filho.stderr.on("data", () => {});

  function rpc(op, campos = {}) {
    const id = ++seq;
    const pedido = { id, op, ...campos, permitir: false };
    return new Promise((resolve, reject) => {
      pendentes.set(id, { resolve, reject });
      filho.stdin.write(`${JSON.stringify(pedido)}\n`);
    });
  }

  function codigoDe(resposta) {
    if (!resposta || resposta.bloqueado === true || typeof resposta.codigo !== "number") {
      return "PGWEB_DLL_BLOQUEADA";
    }
    return resposta.codigo;
  }

  return {
    real: false,
    nativa: true,
    permitirDll: false,
    async ping() {
      return rpc("ping");
    },
    async carregar(caminho) {
      return rpc("carregar", { caminho, permitir: false });
    },
    async setEnvironment(codigo) {
      return codigoDe(await rpc("setEnvironment", { ambiente: codigo }));
    },
    async init(diretorio) {
      return codigoDe(await rpc("init", { diretorio }));
    },
    async newTransac(operacao) {
      return codigoDe(await rpc("newTransac", { operacao }));
    },
    async addParam(info, valor) {
      return codigoDe(await rpc("addParam", { info, valor }));
    },
    async execTransac() {
      const resposta = await rpc("execTransac", { maximo: 9 });
      if (!resposta || resposta.bloqueado === true) {
        return { codigo: "PGWEB_DLL_BLOQUEADA", captura: [] };
      }
      return {
        codigo: resposta.codigo,
        captura: Array.isArray(resposta.captura) ? resposta.captura : [],
        mensagem: typeof resposta.mensagem === "string" ? resposta.mensagem : "",
      };
    },
    async getResult(info) {
      const resposta = await rpc("getResult", { info });
      if (!resposta || resposta.bloqueado === true) return { codigo: "PGWEB_DLL_BLOQUEADA", valor: "" };
      return { codigo: resposta.codigo, valor: typeof resposta.valor === "string" ? resposta.valor : "" };
    },
    async confirmation(status, tupla = {}) {
      return codigoDe(await rpc("confirmation", { status, ...tupla }));
    },
    async waitConfirmation() {
      return codigoDe(await rpc("waitConfirmation"));
    },
    async idleProc() {
      return codigoDe(await rpc("idleProc"));
    },
    async ppCommTest(porta) {
      const resposta = await rpc("ppCommTest", { porta });
      if (!resposta || resposta.bloqueado === true) {
        return { codigo: "PGWEB_DLL_BLOQUEADA", mensagem: "", porta: null };
      }
      return {
        codigo: resposta.codigo,
        mensagem: typeof resposta.mensagem === "string" ? resposta.mensagem : "",
        porta: Number.isInteger(resposta.porta) ? resposta.porta : null,
      };
    },
    async ppEventLoop() {
      const resposta = await rpc("ppEventLoop");
      if (!resposta || resposta.bloqueado === true) {
        return { codigo: "PGWEB_DLL_BLOQUEADA", display: "" };
      }
      return { codigo: resposta.codigo, display: typeof resposta.display === "string" ? resposta.display : "" };
    },
    async encerrar() {
      filho.stdin.end();
      await new Promise((resolve) => {
        if (filho.exitCode !== null) resolve();
        else filho.once("exit", () => resolve());
      });
      leitura.close();
    },
  };
}

export async function criarBibliotecaMotor(opcoes = {}) {
  const { MOTOR_PADRAO, PGWEB2_PRODUCAO } = await import("./tef-pgweb.mjs");
  if (PGWEB2_PRODUCAO || opcoes.producao === true || opcoes.ensaio !== true || opcoes.motor !== "pgweb-2") {
    throw Object.assign(
      new Error("pgweb-2 está desabilitado. O motor padrão permanece acbr-1.3."),
      { code: "PGWEB2_DESABILITADO", motor: MOTOR_PADRAO }
    );
  }
  if (opcoes.modo === "nativo") {
    return criarPonteNativa({
      executavel: opcoes.executavel,
      argumentos: opcoes.argumentos,
    });
  }
  const { criarSimuladorPgWeb } = await import("./tef-pgweb-simulador.mjs");
  return criarSimuladorPgWeb(opcoes.roteiro ?? "aprovada");
}
