import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const TERMINAIS = new Set(["confirmada", "desfeita", "cancelada", "recusada", "ociosa", ""]);

export function registroVazio() {
  return {
    status: "",
    empresaId: "",
    terminalCodigo: "",
    vendaId: "",
    modalidade: "",
    valorCentavos: 0,
    reqNum: "",
    locRef: "",
    extRef: "",
    authSyst: "",
  };
}

export function bloqueiaNovaOperacao(journal) {
  const status = typeof journal?.status === "string" ? journal.status : "";
  return status.length > 0 && !TERMINAIS.has(status);
}

export function lerJournal(arquivo) {
  try {
    return JSON.parse(readFileSync(arquivo, "utf8"));
  } catch {
    return null;
  }
}

export function gravarJournalAtomico(arquivo, registro) {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  writeFileSync(temporario, JSON.stringify(registro));
  renameSync(temporario, arquivo);
  return registro;
}
