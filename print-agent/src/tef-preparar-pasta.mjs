import path from "node:path";
import { fileURLToPath } from "node:url";

import { diretorioProducaoPgWeb } from "./tef-diretorio.mjs";
import { instalarPastaPadrao } from "./tef-pasta.mjs";

export async function prepararPastaPadraoInstalador(env = process.env) {
  const biblioteca = diretorioProducaoPgWeb(env);
  const pai = biblioteca ? path.win32.dirname(biblioteca) : "";
  if (!pai) {
    return {
      ok: false,
      mensagem: "ProgramData ausente. Nenhum arquivo foi apagado.",
    };
  }
  return instalarPastaPadrao({ pai });
}

async function usarCli() {
  const resultado = await prepararPastaPadraoInstalador();
  const texto = resultado.ok
    ? "ok"
    : `diagnostico ${String(resultado.mensagem ?? "A pasta padrão não ficou gravável.").replace(/[\r\n]/g, " ")}`;
  process.stdout.write(`${texto}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await usarCli();
}
