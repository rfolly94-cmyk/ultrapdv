import type { ModoPix } from "./types";

export const CAMPOS_PIX_LOCAL = [
  "id",
  "empresa_id",
  "modo",
  "ativo",
  "chave_pix",
  "recebedor_nome",
  "recebedor_cidade",
] as const;

export function ehModoPix(valor: unknown): valor is ModoPix {
  return valor === "local_manual" || valor === "geranet";
}

export function validarConfiguracaoPixLocal(config: {
  chave_pix?: string | null;
  recebedor_nome?: string | null;
  recebedor_cidade?: string | null;
  provedor?: string | null;
  client_id?: string | null;
  certificado?: string | null;
}) {
  const erros: string[] = [];
  if (!String(config.chave_pix ?? "").trim()) {
    erros.push("Informe a Chave PIX.");
  }
  if (!String(config.recebedor_nome ?? "").trim()) {
    erros.push("Informe o nome do recebedor.");
  }
  if (!String(config.recebedor_cidade ?? "").trim()) {
    erros.push("Informe a cidade do recebedor.");
  }
  return { ok: erros.length === 0, erros };
}
