import fs from "node:fs";
import path from "node:path";

export const NOME_CONECTOR = "UltraPDV Connector";
export const APP_CONECTOR = "UltraPDV-Conector";
export const SERVICO_CONECTOR = "ultrapdv-connector";

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
        const agenteTef = String(bruto.agenteTef ?? "").trim();
        return {
          name: name || NOME_CONECTOR,
          version,
          agenteTef: /^UltraPDVTef_\d+\.exe$/i.test(agenteTef) ? agenteTef : "",
        };
      }
    } catch {
      continue;
    }
  }

  return { name: NOME_CONECTOR, version: "0.0.0-dev", agenteTef: "" };
}
