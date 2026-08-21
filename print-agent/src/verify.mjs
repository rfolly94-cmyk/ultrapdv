import { execFile } from "node:child_process";

import { carregarConfigLocal } from "./config-local.mjs";
import { descobrirSaudeConector, ehConectorUltraPdv } from "./instancia.mjs";
import { candidatosPorta } from "./portas.mjs";

const config = await carregarConfigLocal();
const portas = candidatosPorta(
  config.activePort || config.preferredPort,
  process.env.ULTRAPDV_PRINT_PORT
);

const encontrado = await descobrirSaudeConector(portas);
const saude = encontrado?.saude;

if (!saude || !ehConectorUltraPdv(saude) || saude.ok !== true) {
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(saude)}\n`);

if (process.argv.includes("--open") && encontrado?.porta) {
  const url = `http://127.0.0.1:${encontrado.porta}/`;
  if (process.platform === "win32") {
    execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true });
  }
}

process.exit(0);
