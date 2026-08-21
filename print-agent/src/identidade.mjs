import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { pastaDados, resolverRaizAgente } from "./raiz.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ehUuid(valor) {
  return UUID_RE.test(String(valor ?? "").trim());
}

export function arquivoDispositivo(pasta) {
  return path.join(pasta, "device.json");
}

export async function obterOuCriarDispositivoId({
  pasta,
  fsApi = fs,
  criarId = randomUUID,
} = {}) {
  await fsApi.mkdir(pasta, { recursive: true });
  const arquivo = arquivoDispositivo(pasta);

  try {
    const bruto = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
    const atual = String(bruto?.dispositivoId ?? "").trim();
    if (ehUuid(atual)) {
      return atual;
    }
  } catch {
    // primeira execução ou arquivo ilegível
  }

  const dispositivoId = criarId();
  await fsApi.writeFile(
    arquivo,
    `${JSON.stringify(
      {
        dispositivoId,
        criadoEm: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return dispositivoId;
}

const ehPrincipal =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ehPrincipal && process.argv.includes("--ensure")) {
  const id = await obterOuCriarDispositivoId({
    pasta: pastaDados(resolverRaizAgente()),
  });
  process.stdout.write(`${id}\n`);
}
