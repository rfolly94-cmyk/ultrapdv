import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { MENSAGEM_MOTOR_AUSENTE } from "./motor.mjs";

const execFileAsync = promisify(execFileCb);

export const MENSAGEM_IMPRESSORA_AUSENTE =
  "Impressora não encontrada neste computador.";
export const MENSAGEM_PDF_INVALIDO = "Documento PDF inválido.";
export const MENSAGEM_IMPRESSORA_INDISPONIVEL =
  "Nenhuma impressora disponível/configurada no UltraPDV Conector.\n\nAbra o UltraPDV Conector e selecione uma impressora.";

export function impressoraSegura(nome) {
  const limpo = String(nome ?? "").trim();
  if (!limpo || limpo.length > 200) {
    return null;
  }
  if (/[<>"|?*\n\r]/.test(limpo) || limpo.includes("..")) {
    return null;
  }
  return limpo;
}

export function impressoraExiste(lista, nome) {
  const alvo = impressoraSegura(nome);
  if (!alvo) {
    return false;
  }
  return lista.some((item) => item.nome === alvo);
}

export function ehImpressoraSomenteArquivo(nome) {
  const n = String(nome ?? "").trim().toLowerCase();
  if (!n) {
    return false;
  }
  return (
    n.includes("microsoft print to pdf") ||
    n.includes("microsoft xps document writer") ||
    n === "fax" ||
    n.endsWith(" fax")
  );
}

export function escolherImpressora({ pedida, lastPrinter, impressoras } = {}) {
  const lista = Array.isArray(impressoras) ? impressoras : [];
  if (impressoraExiste(lista, pedida)) {
    return impressoraSegura(pedida);
  }
  if (impressoraExiste(lista, lastPrinter)) {
    return impressoraSegura(lastPrinter);
  }
  const padrao = lista.find((item) => item.padrao)?.nome;
  if (impressoraExiste(lista, padrao) && !ehImpressoraSomenteArquivo(padrao)) {
    return impressoraSegura(padrao);
  }
  return null;
}

export function validarPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    return false;
  }
  return buffer.subarray(0, 5).toString() === "%PDF-";
}

export function montarArgsSumatra({
  impressora,
  arquivo,
  copias = 1,
  papel,
}) {
  const copiasN = Math.min(10, Math.max(1, Math.floor(Number(copias) || 1)));
  const ajustes = [`${copiasN}x`];
  if (papel === "a4") {
    ajustes.push("paper=A4", "fit");
  } else if (papel === "80mm") {
    ajustes.push("fit");
  } else if (papel === "58mm") {
    ajustes.push("fit");
  }

  return [
    "-print-to",
    impressora,
    "-silent",
    "-print-settings",
    ajustes.join(","),
    arquivo,
  ];
}

function mensagemExitCode(code) {
  if (code === 2) {
    return "O motor PDF não conseguiu abrir o arquivo.";
  }
  if (code === 3) {
    return "O documento não permite impressão.";
  }
  if (code === 4) {
    return MENSAGEM_IMPRESSORA_AUSENTE;
  }
  if (code === 5) {
    return "Falha no driver da impressora.";
  }
  if (code === 6) {
    return "Impressão bloqueada por política do Windows.";
  }
  return `Falha na impressão (código ${code}).`;
}

export async function imprimirPdfComSumatra({
  motor,
  impressora,
  copias,
  papel,
  pdfBase64,
  impressoras,
  execFile = execFileAsync,
  fsApi = fs,
  onLog,
} = {}) {
  const log = async (evento, detalhe = "") => {
    if (typeof onLog === "function") {
      await onLog(evento, detalhe);
    }
  };

  if (!motor?.encontrado || !motor.caminho) {
    throw new Error(MENSAGEM_MOTOR_AUSENTE);
  }

  const nome = impressoraSegura(impressora);
  if (!nome) {
    throw new Error("Nome de impressora inválido.");
  }
  if (!impressoraExiste(impressoras, nome)) {
    throw new Error(MENSAGEM_IMPRESSORA_AUSENTE);
  }

  const pdf = Buffer.from(String(pdfBase64 ?? ""), "base64");
  if (!validarPdf(pdf)) {
    throw new Error(MENSAGEM_PDF_INVALIDO);
  }

  const pasta = await fsApi.mkdtemp(path.join(os.tmpdir(), "ultrapdv-print-"));
  const arquivo = path.join(pasta, "documento.pdf");
  const papelLog = papel || "-";

  try {
    await log(
      "impressao-inicio",
      `motor=${motor.caminho} impressora=${nome} papel=${papelLog}`
    );
    await fsApi.writeFile(arquivo, pdf);
    await log("pdf-temporario-criado");
    const args = montarArgsSumatra({
      impressora: nome,
      arquivo,
      copias,
      papel,
    });
    try {
      await log("sumatra-inicio");
      await execFile(motor.caminho, args, {
        windowsHide: true,
        timeout: 60000,
      });
      await log("sumatra-exit-code=0");
      await log("impressao-ok");
    } catch (error) {
      const code = Number(error?.code);
      if (Number.isInteger(code) && code > 0) {
        await log(`sumatra-exit-code=${code}`);
        const mensagem = mensagemExitCode(code);
        await log("impressao-erro", mensagem);
        throw new Error(mensagem);
      }
      const mensagem =
        error instanceof Error ? error.message : "Falha na impressão.";
      await log("sumatra-exit-code=-1");
      await log("impressao-erro", mensagem);
      throw new Error(mensagem);
    }
  } finally {
    await fsApi.rm(pasta, { recursive: true, force: true }).catch(() => {});
  }
}
