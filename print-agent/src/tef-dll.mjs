import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PGWEB_VERSAO = "4.1.50.924";
export const PGWEB_SHA256 = "d17ac81323396ae172648935b0b797b74705b1ca01c9ae0cd3b2ff78119d4220";
export const PGWEB_BYTES = 4460664;

export function arquiteturaPe(buffer) {
  const corpo = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (corpo.length < 0x40 || corpo.readUInt16LE(0) !== 0x5a4d) return "";
  const cabecalho = corpo.readUInt32LE(0x3c);
  if (cabecalho + 6 > corpo.length) return "";
  const maquina = corpo.readUInt16LE(cabecalho + 4);
  if (maquina === 0x8664) return "x64";
  if (maquina === 0x14c) return "x86";
  return "";
}

function contemVersao(buffer) {
  return buffer.includes(Buffer.from(PGWEB_VERSAO, "utf16le"));
}

async function assinaturaPadrao(arquivo) {
  const script = [
    "$sig = Get-AuthenticodeSignature -LiteralPath $args[0]",
    "$assunto = [string]$sig.SignerCertificate.Subject",
    "if ($sig.Status -eq 'Valid' -and $assunto -match 'SETIS') { 'setis' } else { 'invalida' }",
  ].join("; ");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script, String(arquivo)],
      { windowsHide: true, timeout: 20000 }
    );
    const assinatura = stdout.trim() === "setis" ? "setis" : "invalida";
    return { ok: assinatura === "setis", assinatura };
  } catch {
    return { ok: false, assinatura: "nao_verificada" };
  }
}

export function resumirDllPgWeb(dll) {
  const origem = dll && typeof dll === "object" ? dll : {};
  return {
    encontrada: origem.encontrada === true,
    versao: String(origem.versao ?? ""),
    arquitetura: String(origem.arquitetura ?? ""),
    integridade: origem.integridade === true,
    assinatura: String(origem.assinatura ?? ""),
    pronta: origem.pronta === true,
  };
}

export async function verificarDllPgWeb(diretorio, deps = {}) {
  const arquivo = path.join(diretorio, "PGWebLib.dll");
  let corpo;
  try {
    corpo = Buffer.from(typeof deps.ler === "function" ? await deps.ler(arquivo) : await readFile(arquivo));
  } catch (erro) {
    return {
      ok: false,
      pronta: false,
      encontrada: false,
      versao: "",
      arquitetura: "",
      integridade: false,
      assinatura: "nao_verificada",
      mensagem: erro?.code === "ENOENT" ? "PGWebLib.dll não foi encontrada." : "PGWebLib.dll não pôde ser lida.",
    };
  }

  const arquitetura = arquiteturaPe(corpo);
  const versaoOk = contemVersao(corpo);
  const integridade = createHash("sha256").update(corpo).digest("hex") === PGWEB_SHA256 && corpo.length === PGWEB_BYTES;
  let assinatura = "nao_verificada";
  if (integridade) {
    const verificada = typeof deps.assinar === "function" ? await deps.assinar(arquivo) : await assinaturaPadrao(arquivo);
    assinatura = String(verificada?.assinatura ?? "invalida");
  }
  const ok = arquitetura === "x64" && versaoOk && integridade && assinatura === "setis";
  const mensagem = !versaoOk
    ? `A PGWebLib precisa ser a versão ${PGWEB_VERSAO}.`
    : !integridade
      ? "A integridade da PGWebLib.dll não confere."
      : assinatura !== "setis"
        ? "A assinatura da PGWebLib.dll não confere."
        : arquitetura !== "x64"
          ? "A PGWebLib.dll precisa ser x64."
          : "";
  return {
    ok,
    pronta: ok,
    encontrada: true,
    versao: versaoOk ? PGWEB_VERSAO : "",
    arquitetura,
    integridade,
    assinatura,
    mensagem,
  };
}

export async function dllExigidaParaExecutavel(caminho) {
  try {
    await access(caminho);
  } catch {
    return { simulada: true };
  }
  return verificarDllPgWeb(path.dirname(String(caminho)));
}
