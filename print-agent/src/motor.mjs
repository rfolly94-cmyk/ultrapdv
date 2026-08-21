import fs from "node:fs/promises";
import path from "node:path";

import { resolverRaizAgente } from "./raiz.mjs";

export const MENSAGEM_MOTOR_AUSENTE =
  "Motor de impressão PDF não encontrado neste computador.";
export const MENSAGEM_MOTOR_INSTALADOR =
  "o arquivo informado como motor SumatraPDF parece ser um instalador e não pode ser empacotado.";

export function motorEmpacotavel({
  nomeArquivo,
  temLibMupdf,
  productName,
} = {}) {
  const nome = String(nomeArquivo ?? "").toLowerCase();
  if (!nome.endsWith(".exe")) {
    return { ok: false, erro: "O motor precisa ser um arquivo .exe." };
  }
  if (!nome.includes("sumatrapdf")) {
    return { ok: false, erro: "O arquivo não parece ser o SumatraPDF." };
  }
  if (nome.includes("install") || nome.includes("setup")) {
    return { ok: false, erro: MENSAGEM_MOTOR_INSTALADOR };
  }
  const produto = String(productName ?? "").toLowerCase();
  if (produto && !produto.includes("sumatra")) {
    return { ok: false, erro: "O arquivo não parece ser o SumatraPDF." };
  }
  if (!temLibMupdf) {
    return { ok: false, erro: MENSAGEM_MOTOR_INSTALADOR };
  }
  return { ok: true };
}

export function candidatosMotorPdf(
  env = process.env,
  raiz = resolverRaizAgente()
) {
  const informado = String(env.ULTRAPDV_PDF_PRINTER ?? "").trim();
  const installDir = String(env.ULTRAPDV_INSTALL_DIR ?? "").trim();
  const localApp = String(env.LOCALAPPDATA ?? "").trim();
  const programFiles = String(env.ProgramFiles ?? "C:\\Program Files").trim();
  const programFilesX86 = String(
    env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"
  ).trim();

  return [
    informado,
    installDir ? path.join(installDir, "print-engine", "SumatraPDF.exe") : "",
    path.join(raiz, "print-engine", "SumatraPDF.exe"),
    path.join(programFiles, "UltraPDV Connector", "print-engine", "SumatraPDF.exe"),
    path.join(
      programFilesX86,
      "UltraPDV Connector",
      "print-engine",
      "SumatraPDF.exe"
    ),
    path.join(raiz, "bin", "SumatraPDF.exe"),
    path.join(raiz, "tools", "SumatraPDF.exe"),
    path.join(raiz, "sumatra", "SumatraPDF.exe"),
    path.join(raiz, "SumatraPDF.exe"),
    localApp ? path.join(localApp, "SumatraPDF", "SumatraPDF.exe") : "",
    path.join(programFiles, "SumatraPDF", "SumatraPDF.exe"),
    path.join(programFilesX86, "SumatraPDF", "SumatraPDF.exe"),
  ].filter((item) => item.length > 0);
}

function exePermitido(caminho, veioDoEnv) {
  const base = path.basename(caminho).toLowerCase();
  if (!base.endsWith(".exe")) {
    return false;
  }
  if (veioDoEnv) {
    return true;
  }
  return base.startsWith("sumatrapdf");
}

export async function localizarMotorPdf(
  env = process.env,
  access = fs.access,
  raiz = resolverRaizAgente()
) {
  const informado = String(env.ULTRAPDV_PDF_PRINTER ?? "").trim();
  for (const candidato of candidatosMotorPdf(env, raiz)) {
    try {
      await access(candidato);
      if (!exePermitido(candidato, candidato === informado)) {
        continue;
      }
      return {
        encontrado: true,
        tipo: "sumatrapdf",
        caminho: candidato,
      };
    } catch {
      continue;
    }
  }

  return {
    encontrado: false,
    tipo: null,
    caminho: null,
  };
}

export function motorParaHealth(motor) {
  return {
    encontrado: Boolean(motor?.encontrado),
    tipo: motor?.encontrado ? "sumatrapdf" : null,
    caminho: motor?.encontrado ? String(motor.caminho) : null,
  };
}
