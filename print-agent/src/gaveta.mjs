import { spawn } from "node:child_process";

import {
  escolherImpressora,
  ehImpressoraSomenteArquivo,
  mensagemErroImpressora,
} from "./imprimir.mjs";

export const MENSAGEM_GAVETA_DESABILITADA =
  "Gaveta de dinheiro desabilitada no UltraPDV Conector.";
export const MENSAGEM_GAVETA_IMPRESSORA_OFFLINE =
  "A impressora selecionada está offline.";
export const MENSAGEM_GAVETA_NAO_SUPORTADA =
  "Esta impressora não suportou o comando de abertura da gaveta.";
export const MENSAGEM_GAVETA_RAW =
  "Não foi possível enviar o comando RAW para a impressora.";

/** ESC p n t1 t2 — pulso padrão (t1=25, t2=250). */
export const COMANDO_GAVETA_ESC_P = {
  id: "esc_p",
  nome: "ESC p",
  t1: 25,
  t2: 250,
};

export function sanitizarPinoGaveta(pino) {
  return Number(pino) === 1 ? 1 : 0;
}

export function sanitizarGavetaHabilitada(valor) {
  return valor === true;
}

/**
 * Monta o pulso ESC/POS da gaveta.
 * Pino 0: 1B 70 00 19 FA
 * Pino 1: 1B 70 01 19 FA
 */
export function montarComandoGaveta(pino = 0) {
  const pin = sanitizarPinoGaveta(pino);
  return Buffer.from([
    0x1b,
    0x70,
    pin,
    COMANDO_GAVETA_ESC_P.t1,
    COMANDO_GAVETA_ESC_P.t2,
  ]);
}

export function configuracaoGavetaDeConfig(cfg = {}) {
  return {
    habilitada: sanitizarGavetaHabilitada(cfg.drawerEnabled),
    pino: sanitizarPinoGaveta(cfg.drawerPin),
  };
}

function spawnTexto(comando, args, envExtra = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...envExtra },
    });
    let saida = "";
    let erro = "";
    filho.stdout.on("data", (data) => {
      saida += data.toString("utf8");
    });
    filho.stderr.on("data", (data) => {
      erro += data.toString("utf8");
    });
    filho.on("error", reject);
    filho.on("close", (code) => {
      if (code === 0) {
        resolve(saida);
      } else {
        reject(new Error(erro.trim() || saida.trim() || `Comando falhou (${code}).`));
      }
    });
  });
}

const SCRIPT_STATUS_IMPRESSORA =
  "$n = $env:ULTRAPDV_DRAWER_PRINTER; if (-not $n) { throw 'Impressora vazia.' }; $p = Get-Printer -Name $n -ErrorAction Stop; $st = [string]$p.PrinterStatus; Write-Output (@{ existe = $true; offline = ($st -eq 'Offline') } | ConvertTo-Json -Compress)";

const SCRIPT_RAW_WINSPOOL = `
$ErrorActionPreference = 'Stop'
$printer = $env:ULTRAPDV_DRAWER_PRINTER
$b64 = $env:ULTRAPDV_DRAWER_B64
if (-not $printer) { throw 'Impressora vazia.' }
if (-not $b64) { throw 'Comando RAW vazio.' }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class UltraPdvRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter = IntPtr.Zero;
    IntPtr pBytes = IntPtr.Zero;
    try {
      if (!OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) {
        throw new Exception("Nao foi possivel abrir a impressora.");
      }
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "UltraPDV Gaveta";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) {
        throw new Exception("Nao foi possivel iniciar o documento RAW.");
      }
      try {
        if (!StartPagePrinter(hPrinter)) {
          throw new Exception("Nao foi possivel iniciar a pagina RAW.");
        }
        try {
          pBytes = Marshal.AllocCoTaskMem(bytes.Length);
          Marshal.Copy(bytes, 0, pBytes, bytes.Length);
          int written = 0;
          if (!WritePrinter(hPrinter, pBytes, bytes.Length, out written) || written != bytes.Length) {
            throw new Exception("Falha ao escrever o comando RAW.");
          }
        } finally {
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      if (pBytes != IntPtr.Zero) { Marshal.FreeCoTaskMem(pBytes); }
      if (hPrinter != IntPtr.Zero) { ClosePrinter(hPrinter); }
    }
  }
}
"@
$bytes = [Convert]::FromBase64String($b64)
[UltraPdvRawPrinter]::SendBytes($printer, $bytes)
`;

export async function consultarStatusImpressora(
  impressora,
  { spawn = spawnTexto } = {}
) {
  try {
    const saida = await spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      SCRIPT_STATUS_IMPRESSORA,
    ], {
      ULTRAPDV_DRAWER_PRINTER: impressora,
    });
    const parsed = JSON.parse(String(saida || "{}"));
    return {
      existe: parsed.existe === true,
      offline: parsed.offline === true,
    };
  } catch (error) {
    const texto = error instanceof Error ? error.message : String(error ?? "");
    if (/cannot find|nao foi possivel encontrar|not found/i.test(texto)) {
      return { existe: false, offline: false };
    }
    throw error;
  }
}

export async function enviarRawImpressora({
  impressora,
  bytes,
  spawn = spawnTexto,
} = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new Error(MENSAGEM_GAVETA_RAW);
  }
  await spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    SCRIPT_RAW_WINSPOOL,
  ], {
    ULTRAPDV_DRAWER_PRINTER: impressora,
    ULTRAPDV_DRAWER_B64: bytes.toString("base64"),
  });
}

function mapearErroRaw(error) {
  const texto = error instanceof Error ? error.message : String(error ?? "");
  if (/offline/i.test(texto)) {
    return new Error(MENSAGEM_GAVETA_IMPRESSORA_OFFLINE);
  }
  if (
    /n[aã]o suport|not support|RAW|winspool|WritePrinter|StartDocPrinter|abrir a impressora/i.test(
      texto
    )
  ) {
    return new Error(MENSAGEM_GAVETA_NAO_SUPORTADA);
  }
  if (texto.trim()) {
    return new Error(texto.trim());
  }
  return new Error(MENSAGEM_GAVETA_RAW);
}

export async function abrirGaveta(
  impressora,
  configuracao = {},
  {
    impressoras = [],
    enviarRaw = enviarRawImpressora,
    consultarStatus = consultarStatusImpressora,
  } = {}
) {
  if (!sanitizarGavetaHabilitada(configuracao.habilitada)) {
    throw new Error(MENSAGEM_GAVETA_DESABILITADA);
  }

  const nome = escolherImpressora({
    pedida: impressora,
    lastPrinter: impressora,
    impressoras,
  });
  if (!nome) {
    throw new Error(
      mensagemErroImpressora({
        pedida: impressora,
        lastPrinter: impressora,
      })
    );
  }
  if (ehImpressoraSomenteArquivo(nome)) {
    throw new Error(MENSAGEM_GAVETA_NAO_SUPORTADA);
  }

  if (typeof consultarStatus === "function") {
    const status = await consultarStatus(nome);
    if (status && status.existe === false) {
      throw new Error(
        mensagemErroImpressora({
          pedida: nome,
          lastPrinter: nome,
        })
      );
    }
    if (status && status.offline === true) {
      throw new Error(MENSAGEM_GAVETA_IMPRESSORA_OFFLINE);
    }
  }

  const comando = montarComandoGaveta(configuracao.pino);
  try {
    await enviarRaw({ impressora: nome, bytes: comando });
  } catch (error) {
    throw mapearErroRaw(error);
  }

  return { ok: true, impressora: nome, pino: sanitizarPinoGaveta(configuracao.pino) };
}
