import { Buffer } from "node:buffer";

import { ehArquivoUpload, metaArquivoFormData } from "./arquivo-formdata";
import { camposCredencialDoProvedor } from "./provedores-geranet";

const TAMANHO_MAXIMO_ARQUIVO = 2 * 1024 * 1024;

export type MotivoNaoIncluido =
  | "campo_nao_permitido"
  | "upload_invalido"
  | "size_zero"
  | "sem_array_buffer"
  | "erro_array_buffer"
  | "bytes_vazios"
  | "hex_vazio"
  | "segredo_existente_preservado"
  | "outro";

export type DiagnosticoArquivoColetado = {
  campo: string;
  recebido: boolean;
  size: number | null;
  bytes: number | null;
  hexLength: number;
  incluidoEmNovos: boolean;
  instanceofFile: boolean;
  duckTypeValido: boolean;
  constructorName: string | null;
  arrayBufferExecutou: boolean;
  motivoNaoIncluido: MotivoNaoIncluido | null;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function extensaoPermitida(nome: string, formatos?: string[]) {
  if (!formatos?.length) {
    return true;
  }

  const lower = nome.toLowerCase();
  return formatos.some((ext) => lower.endsWith(ext.toLowerCase()));
}

export async function arquivoParaHexadecimal(arquivo: {
  arrayBuffer: () => Promise<ArrayBuffer>;
}) {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  return Buffer.from(bytes).toString("hex");
}

function motivoUploadInvalido(valor: unknown): MotivoNaoIncluido {
  if (valor == null || valor === "") {
    return "segredo_existente_preservado";
  }
  if (typeof valor !== "object") {
    return "upload_invalido";
  }
  const item = valor as { size?: unknown; arrayBuffer?: unknown };
  if (typeof item.size === "number" && item.size === 0) {
    return "size_zero";
  }
  if (typeof item.arrayBuffer !== "function") {
    return "sem_array_buffer";
  }
  return "upload_invalido";
}

async function lerBytesUpload(valor: {
  arrayBuffer: () => Promise<ArrayBuffer>;
  bytes?: () => Promise<Uint8Array>;
}): Promise<{
  bytes: Uint8Array | null;
  arrayBufferExecutou: boolean;
  motivo: MotivoNaoIncluido | null;
}> {
  try {
    const buffer = await valor.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > 0) {
      return { bytes, arrayBufferExecutou: true, motivo: null };
    }
    if (typeof valor.bytes === "function") {
      const extra = await valor.bytes();
      if (extra && extra.byteLength > 0) {
        return {
          bytes: extra instanceof Uint8Array ? extra : new Uint8Array(extra),
          arrayBufferExecutou: true,
          motivo: null,
        };
      }
    }
    return {
      bytes: null,
      arrayBufferExecutou: true,
      motivo: "bytes_vazios",
    };
  } catch {
    return {
      bytes: null,
      arrayBufferExecutou: false,
      motivo: "erro_array_buffer",
    };
  }
}

export async function coletarNovosSegredosDoFormulario(
  formData: FormData,
  provedor: string,
  ambiente?: string
): Promise<{
  novos: Record<string, string>;
  erro?: string;
  diagnosticoArquivos: DiagnosticoArquivoColetado[];
}> {
  const novos: Record<string, string> = {};
  const diagnosticoArquivos: DiagnosticoArquivoColetado[] = [];

  for (const campo of camposCredencialDoProvedor(provedor, ambiente)) {
    const bruto = formData.get(campo.chave);

    if (campo.tipo === "file") {
      const meta = metaArquivoFormData(bruto);
      const diagnostico: DiagnosticoArquivoColetado = {
        campo: campo.chave,
        recebido: meta.existe,
        size: meta.size,
        bytes: null,
        hexLength: 0,
        incluidoEmNovos: false,
        instanceofFile: meta.instanceofFile,
        duckTypeValido: meta.duckTypeValido,
        constructorName: meta.constructorName,
        arrayBufferExecutou: false,
        motivoNaoIncluido: null,
      };

      if (!ehArquivoUpload(bruto)) {
        diagnostico.motivoNaoIncluido = motivoUploadInvalido(bruto);
        diagnosticoArquivos.push(diagnostico);
        continue;
      }

      if (bruto.size > TAMANHO_MAXIMO_ARQUIVO) {
        diagnostico.motivoNaoIncluido = "outro";
        diagnosticoArquivos.push(diagnostico);
        return {
          novos,
          erro: `${campo.label} não pode ultrapassar 2 MB.`,
          diagnosticoArquivos,
        };
      }

      const lido = await lerBytesUpload(bruto);
      diagnostico.arrayBufferExecutou = lido.arrayBufferExecutou;
      diagnostico.bytes = lido.bytes?.byteLength ?? 0;
      if (!lido.bytes) {
        diagnostico.motivoNaoIncluido = lido.motivo ?? "bytes_vazios";
        diagnosticoArquivos.push(diagnostico);
        continue;
      }

      const hex = Buffer.from(lido.bytes).toString("hex");
      diagnostico.hexLength = hex.length;
      if (hex.length > 0) {
        novos[campo.chave] = hex;
        diagnostico.incluidoEmNovos = true;
        diagnostico.motivoNaoIncluido = null;
      } else {
        diagnostico.motivoNaoIncluido = "hex_vazio";
      }
      diagnosticoArquivos.push(diagnostico);
      continue;
    }

    const valor = texto(bruto);
    if (valor) {
      novos[campo.chave] = valor;
    }
  }

  return { novos, diagnosticoArquivos };
}
