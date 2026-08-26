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

export function hostnameLoopback(hostname) {
  const h = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function hostnameIpv4Privado(hostname) {
  const m = String(hostname || "").match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  );
  if (!m) {
    return false;
  }
  const octetos = m.slice(1).map(Number);
  if (octetos.some((n) => !Number.isInteger(n) || n > 255)) {
    return false;
  }
  const [a, b] = octetos;
  if (a === 10 || a === 127) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

export function origemLocalOuPrivada(origem) {
  try {
    const u = new URL(String(origem || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return false;
    }
    return hostnameLoopback(u.hostname) || hostnameIpv4Privado(u.hostname);
  } catch {
    return false;
  }
}

export function origemPermitidaCors(origem, origens = ORIGENS_FIXAS) {
  const o = String(origem || "").trim();
  if (!o) {
    return true;
  }
  if (Array.isArray(origens) && origens.includes(o)) {
    return true;
  }
  return origemLocalOuPrivada(o);
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
