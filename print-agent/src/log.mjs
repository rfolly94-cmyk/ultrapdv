import fs from "node:fs/promises";
import path from "node:path";

import { arquivoLogMaquina } from "./config-local.mjs";

const SENSIVEL =
  /token|senha|password|secret|certificado|a1|geranet|supabase|cnpj/i;

function limpar(valor) {
  const texto = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (SENSIVEL.test(texto)) {
    return "[redigido]";
  }
  if (texto.length > 400) {
    return `${texto.slice(0, 400)}…`;
  }
  return texto;
}

export async function registrarLog(evento, detalhe = "", { fsApi = fs, env = process.env } = {}) {
  const agora = new Date().toISOString();
  const linha = `[${agora}] ${limpar(evento)}${detalhe ? ` ${limpar(detalhe)}` : ""}\n`;
  try {
    const arquivo = arquivoLogMaquina(env);
    await fsApi.mkdir(path.dirname(arquivo), { recursive: true });
    await fsApi.appendFile(arquivo, linha, "utf8");
    try {
      const st = await fsApi.stat(arquivo);
      if (st.size > 1024 * 1024) {
        const bruto = await fsApi.readFile(arquivo, "utf8");
        await fsApi.writeFile(arquivo, bruto.slice(-256 * 1024), "utf8");
      }
    } catch {
      // tamanho opcional
    }
  } catch {
    // log nunca derruba o agente
  }
  if (process.env.ULTRAPDV_NO_TRAY !== "1") {
    process.stdout.write(linha);
  }
}
