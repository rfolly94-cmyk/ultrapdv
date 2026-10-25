import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PORTA_CONECTOR_HOMOLOGACAO = 18281;
export const HOST_CONECTOR_HOMOLOGACAO = "127.0.0.1";

export function pastaConectorHomologacao(env = process.env) {
  const local = String(env.LOCALAPPDATA || "").trim()
    || path.join(os.homedir(), "AppData", "Local");
  return path.win32.join(local, "UltraPDV", "conector-homologacao");
}

export function prepararAmbienteHomologacao(env = process.env) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  env.ULTRAPDV_HOMOLOGACAO = "1";
  env.ULTRAPDV_NO_TRAY = "1";
  env.ULTRAPDV_CONFIG_DIR = pastaConectorHomologacao(env);
  if (!String(env.ULTRAPDV_INSTALL_DIR ?? "").trim()) {
    env.ULTRAPDV_INSTALL_DIR = raiz;
  }
  return {
    porta: PORTA_CONECTOR_HOMOLOGACAO,
    host: HOST_CONECTOR_HOMOLOGACAO,
    configuracao: env.ULTRAPDV_CONFIG_DIR,
    instalacao: env.ULTRAPDV_INSTALL_DIR,
  };
}

export async function escutarHomologacao(servidor, porta, host) {
  await new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(porta, host, () => {
      servidor.off("error", reject);
      resolve();
    });
  });
}

const ehPrincipal = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ehPrincipal) {
  const ambiente = prepararAmbienteHomologacao();
  const { criarServidor } = await import("./server.mjs");
  const servidor = criarServidor({
    diagnosticoHomologacao: true,
    estado: { porta: ambiente.porta, status: "conectado" },
  });
  await escutarHomologacao(servidor, ambiente.porta, ambiente.host);
  console.log(
    `Connector de homologação em http://${ambiente.host}:${ambiente.porta}`
  );
  console.log(`Configuração e logs: ${ambiente.configuracao}`);
  console.log("Sem serviço do Windows e sem inicialização automática.");
}
