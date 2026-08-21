import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

export const PORTA_PADRAO = 18181;
export const HOST_LOCAL = "127.0.0.1";

export function arquivoPid(pasta) {
  return path.join(pasta, "connector.pid.json");
}

import { ehConectorUltraPdv } from "./mutex.mjs";

export { ehConectorUltraPdv };

export function consultarSaudeLocal(
  porta = PORTA_PADRAO,
  getJson = httpGetJson
) {
  return getJson(`http://${HOST_LOCAL}:${porta}/health`);
}

export async function descobrirSaudeConector(
  portas,
  getJson = httpGetJson
) {
  for (const porta of portas) {
    const saude = await getJson(`http://${HOST_LOCAL}:${porta}/health`);
    if (ehConectorUltraPdv(saude)) {
      return { porta, saude };
    }
  }
  return null;
}

export function solicitarShutdownLocal(
  porta = PORTA_PADRAO,
  postJson = httpPostJson
) {
  return postJson(`http://${HOST_LOCAL}:${porta}/shutdown`, {});
}

export async function gravarPid({ pasta, fsApi = fs, pid = process.pid }) {
  await fsApi.mkdir(pasta, { recursive: true });
  await fsApi.writeFile(
    arquivoPid(pasta),
    `${JSON.stringify(
      {
        pid,
        execPath: process.execPath,
        atualizadoEm: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function removerPid({ pasta, fsApi = fs }) {
  await fsApi.rm(arquivoPid(pasta), { force: true }).catch(() => {});
}

export async function encerrarInstanciaLocal({
  porta = PORTA_PADRAO,
  portas,
  pasta,
  execPath = process.execPath,
  fsApi = fs,
  getJson = httpGetJson,
  postJson = httpPostJson,
  kill = (pid) => process.kill(pid),
  pidVivo = pidExiste,
} = {}) {
  const lista = Array.isArray(portas) && portas.length > 0 ? portas : [porta];
  const encontrado = await descobrirSaudeConector(lista, getJson);
  if (encontrado) {
    await postJson(
      `http://${HOST_LOCAL}:${encontrado.porta}/shutdown`,
      {}
    ).catch(() => null);
    const ainda = await getJson(
      `http://${HOST_LOCAL}:${encontrado.porta}/health`
    );
    if (!ainda || !ehConectorUltraPdv(ainda)) {
      return 0;
    }
  }

  const saude = encontrado?.saude ?? null;

  try {
    const bruto = JSON.parse(
      await fsApi.readFile(arquivoPid(pasta), "utf8")
    );
    const pid = Number(bruto?.pid);
    const registrado = String(bruto?.execPath ?? "");
    if (
      Number.isInteger(pid) &&
      pid > 0 &&
      registrado === execPath &&
      pidVivo(pid)
    ) {
      try {
        kill(pid);
      } catch {
        return 1;
      }
    }
  } catch {
    if (!saude) {
      return 0;
    }
    return 1;
  }

  return 0;
}

function pidExiste(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function httpGetJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
        } catch {
          resolve(null);
        }
      });
    });
    req.setTimeout(800, () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

function httpPostJson(url, corpo) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(corpo ?? {}));
    const alvo = new URL(url);
    const req = http.request(
      {
        hostname: alvo.hostname,
        port: alvo.port,
        path: alvo.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
          } catch {
            resolve({ ok: res.statusCode === 200 });
          }
        });
      }
    );
    req.setTimeout(1500, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
