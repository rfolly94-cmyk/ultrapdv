import { spawn } from "node:child_process";
import path from "node:path";

import { resolverRaizAgente } from "./raiz.mjs";
import { registrarLog } from "./log.mjs";

export function iniciarTray({
  configPath,
  porta,
  raiz = resolverRaizAgente(),
  spawnFn = spawn,
} = {}) {
  if (process.platform !== "win32" || process.env.ULTRAPDV_NO_TRAY === "1") {
    return null;
  }

  const script = path.join(raiz, "launcher", "tray.ps1");
  const url = `http://127.0.0.1:${porta}/`;
  try {
    const filho = spawnFn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-ConfigPath",
        configPath,
        "-UrlInicial",
        url,
      ],
      {
        windowsHide: true,
        stdio: "ignore",
      }
    );
    filho.on("error", () => {
      void registrarLog("tray", "nao foi possivel iniciar o icone da bandeja");
    });
    return filho;
  } catch {
    void registrarLog("tray", "falha ao iniciar bandeja");
    return null;
  }
}
