import { Buffer } from "node:buffer";

import { camposCredencialDoProvedor } from "./provedores-geranet";

const TAMANHO_MAXIMO_ARQUIVO = 2 * 1024 * 1024;

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

export async function arquivoParaHexadecimal(arquivo: File) {
  return Buffer.from(await arquivo.arrayBuffer()).toString("hex");
}

export async function coletarNovosSegredosDoFormulario(
  formData: FormData,
  provedor: string,
  ambiente?: string
): Promise<{ novos: Record<string, string>; erro?: string }> {
  const novos: Record<string, string> = {};

  for (const campo of camposCredencialDoProvedor(provedor, ambiente)) {
    const bruto = formData.get(campo.chave);

    if (campo.tipo === "file") {
      if (!(bruto instanceof File) || bruto.size === 0) {
        continue;
      }

      if (bruto.size > TAMANHO_MAXIMO_ARQUIVO) {
        return {
          novos,
          erro: `${campo.label} não pode ultrapassar 2 MB.`,
        };
      }

      if (
        !extensaoPermitida(
          bruto.name,
          campo.formatoArquivo ?? campo.formatosArquivo
        )
      ) {
        return {
          novos,
          erro: `Envie ${campo.label} no formato ${
            campo.formatoArquivo?.join(" ou ") ?? "esperado"
          }.`,
        };
      }

      novos[campo.chave] = await arquivoParaHexadecimal(bruto);
      continue;
    }

    const valor = texto(bruto);
    if (valor) {
      novos[campo.chave] = valor;
    }
  }

  return { novos };
}
