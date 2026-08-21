import fs from "node:fs";
import path from "node:path";

export const NOME_CONECTOR = "UltraPDV Connector";
export const APP_CONECTOR = "UltraPDV-Conector";

export function carregarVersao(raiz, ler = fs.readFileSync) {
  const candidatos = [
    path.join(raiz, "version.json"),
    path.join(raiz, "app", "version.json"),
  ];

  for (const arquivo of candidatos) {
    try {
      const bruto = JSON.parse(ler(arquivo, "utf8"));
      const version = String(bruto.version ?? "").trim();
      const name = String(bruto.name ?? NOME_CONECTOR).trim();
      if (version) {
        return { name: name || NOME_CONECTOR, version };
      }
    } catch {
      continue;
    }
  }

  return { name: NOME_CONECTOR, version: "0.0.0-dev" };
}
