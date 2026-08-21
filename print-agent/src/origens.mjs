import fs from "node:fs/promises";
import path from "node:path";

const ORIGENS_DESENVOLVIMENTO = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const ORIGENS_PRODUCAO = [
  "https://ultrapdv.app",
  "https://www.ultrapdv.app",
];

export const ORIGENS_FIXAS = [...ORIGENS_DESENVOLVIMENTO, ...ORIGENS_PRODUCAO];

function limparOrigem(valor) {
  return String(valor ?? "").trim().replace(/\/$/, "");
}

export async function carregarOrigens({
  env = process.env,
  raiz,
  fsApi = fs,
} = {}) {
  const extra = [];
  const doEnv = String(env.ULTRAPDV_ORIGINS ?? "").trim();
  if (doEnv) {
    extra.push(...doEnv.split(",").map(limparOrigem).filter(Boolean));
  }

  const arquivos = [
    path.join(raiz, "config", "origins.json"),
    path.join(raiz, "app", "config", "origins.json"),
  ];
  for (const arquivo of arquivos) {
    try {
      const bruto = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
      const lista = Array.isArray(bruto?.origens) ? bruto.origens : [];
      extra.push(...lista.map(limparOrigem).filter(Boolean));
      break;
    } catch {
      continue;
    }
  }

  return [...new Set([...ORIGENS_FIXAS, ...extra])];
}
