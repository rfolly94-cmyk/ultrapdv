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

export function preservarDiagnosticoInstalacao(valor) {
  let texto = String(valor ?? "").replace(/\s+/g, " ").trim();
  texto = texto.replace(/%\S{0,160}/g, "[trilha]");
  texto = texto.replace(/;[0-9*]{8,}(?:=[^\s]*)?/g, "[trilha]");
  texto = texto.replace(/\b(?:\d[ -]?){12,19}\b/g, "[cartao]");
  texto = texto.replace(/\d(?:[.\-/\s]?\d){10,17}/g, "[digitos]");
  texto = texto.replace(/\b\d{6,}\b/g, "[digitos]");
  texto = texto.replace(
    /\b(senha|password|cvv2?|cvc)\s*[:=]?\s*\d{3,8}\b/gi,
    "$1 [omitido]"
  );
  if (texto.length > 400) {
    return `${texto.slice(0, 400)}…`;
  }
  return texto;
}

export async function registrarLog(evento, detalhe = "", {
  fsApi = fs,
  env = process.env,
  diagnosticoInstalacao = false,
} = {}) {
  const agora = new Date().toISOString();
  const detalheLimpo = diagnosticoInstalacao
    ? preservarDiagnosticoInstalacao(detalhe)
    : limpar(detalhe);
  const linha = `[${agora}] ${limpar(evento)}${detalhe ? ` ${detalheLimpo}` : ""}\n`;
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
