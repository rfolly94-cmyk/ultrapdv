import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PORTA_PADRAO, portaValida } from "./portas.mjs";
import { sanitizarGavetaHabilitada, sanitizarPinoGaveta } from "./gaveta.mjs";

let ultimoArquivo = null;

export function pastaConfigMaquina(env = process.env) {
  return candidatosPastaConfig(env)[0];
}

export function candidatosPastaConfig(env = process.env) {
  const isolada = String(env.ULTRAPDV_CONFIG_DIR ?? "").trim();
  if (isolada) {
    return [isolada];
  }
  const lista = [];
  const programData = String(env.PROGRAMDATA || env.ALLUSERSPROFILE || "").trim();
  const localApp = String(env.LOCALAPPDATA || "").trim();
  if (programData) {
    lista.push(path.join(programData, "UltraPDV"));
  }
  if (localApp) {
    lista.push(path.join(localApp, "UltraPDV"));
  }
  lista.push(path.join(os.homedir(), "UltraPDV"));
  return [...new Set(lista)];
}

export function arquivoConfigMaquina(env = process.env) {
  return path.join(pastaConfigMaquina(env), "print-agent.json");
}

export function arquivoConfigAtual(env = process.env) {
  return ultimoArquivo || arquivoConfigMaquina(env);
}

export function arquivoLogMaquina(env = process.env) {
  return path.join(path.dirname(arquivoConfigAtual(env)), "print-agent.log");
}

export function configPadrao() {
  return {
    preferredPort: PORTA_PADRAO,
    activePort: PORTA_PADRAO,
    lastPrinter: null,
    lastPaper: "80mm",
    drawerEnabled: false,
    drawerPin: 0,
  };
}

function sanitizar(bruto) {
  const preferred = portaValida(bruto?.preferredPort)
    ? Number(bruto.preferredPort)
    : PORTA_PADRAO;
  const active = portaValida(bruto?.activePort)
    ? Number(bruto.activePort)
    : preferred;
  const lastPrinter = String(bruto?.lastPrinter ?? "").trim() || null;
  const lastPaper = ["58mm", "80mm", "a4"].includes(bruto?.lastPaper)
    ? bruto.lastPaper
    : "80mm";
  return {
    preferredPort: preferred,
    activePort: active,
    lastPrinter,
    lastPaper,
    drawerEnabled: sanitizarGavetaHabilitada(bruto?.drawerEnabled),
    drawerPin: sanitizarPinoGaveta(bruto?.drawerPin),
  };
}

export async function carregarConfigLocal({
  env = process.env,
  fsApi = fs,
} = {}) {
  for (const pasta of candidatosPastaConfig(env)) {
    const arquivo = path.join(pasta, "print-agent.json");
    try {
      const bruto = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
      ultimoArquivo = arquivo;
      return sanitizar(bruto);
    } catch {
      continue;
    }
  }
  return configPadrao();
}

const CHAVES_CONFIG = new Set([
  "preferredPort",
  "activePort",
  "lastPrinter",
  "lastPaper",
  "drawerEnabled",
  "drawerPin",
]);

function extrasPreservados(bruto) {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
  const extras = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (CHAVES_CONFIG.has(chave) || chave.startsWith("_")) continue;
    extras[chave] = valor;
  }
  return extras;
}

async function gravarAtomico(fsApi, arquivo, json) {
  if (typeof fsApi.rename !== "function") {
    await fsApi.writeFile(arquivo, json, "utf8");
    return;
  }
  const temporario = `${arquivo}.${process.pid}.tmp`;
  await fsApi.writeFile(temporario, json, "utf8");
  try {
    await fsApi.rename(temporario, arquivo);
  } catch (erro) {
    if (erro?.code === "EEXIST" || erro?.code === "EPERM") {
      await fsApi.rm?.(arquivo, { force: true });
      await fsApi.rename(temporario, arquivo);
      return;
    }
    await fsApi.rm?.(temporario, { force: true });
    throw erro;
  }
}

export async function salvarConfigLocal(patch, { env = process.env, fsApi = fs } = {}) {
  let bruto = {};
  for (const pasta of candidatosPastaConfig(env)) {
    try {
      bruto = JSON.parse(await fsApi.readFile(path.join(pasta, "print-agent.json"), "utf8"));
      break;
    } catch {
      bruto = {};
    }
  }
  const atual = sanitizar(bruto);
  const proxima = sanitizar({ ...atual, ...patch });
  const gravada = { ...extrasPreservados(bruto), ...proxima };
  const json = `${JSON.stringify(gravada, null, 2)}\n`;
  let ultimoErro = null;
  for (const pasta of candidatosPastaConfig(env)) {
    try {
      await fsApi.mkdir(pasta, { recursive: true });
      const arquivo = path.join(pasta, "print-agent.json");
      await gravarAtomico(fsApi, arquivo, json);
      ultimoArquivo = arquivo;
      return proxima;
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  if (ultimoErro) throw ultimoErro;
  return proxima;
}
