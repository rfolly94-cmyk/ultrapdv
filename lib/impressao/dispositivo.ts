import { DISPOSITIVO_STORAGE_KEY } from "./tipos";
import { ehUuid } from "./regras";

function gerarUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const n = Math.floor(Math.random() * 16);
    const valor = char === "x" ? n : (n & 0x3) | 0x8;
    return valor.toString(16);
  });
}

export function aplicarDispositivoIdDoConector(id: string) {
  const valor = String(id ?? "").trim();
  if (!ehUuid(valor) || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(DISPOSITIVO_STORAGE_KEY, valor);
  } catch {
    // navegador sem storage
  }
}

export function obterDispositivoId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const atual = window.localStorage.getItem(DISPOSITIVO_STORAGE_KEY);
    if (ehUuid(atual)) {
      return atual;
    }

    const id = gerarUuid();
    window.localStorage.setItem(DISPOSITIVO_STORAGE_KEY, id);
    return id;
  } catch {
    return gerarUuid();
  }
}

export function rotuloDispositivo(dispositivoId: string) {
  const id = String(dispositivoId ?? "").trim();
  if (!ehUuid(id)) {
    return "Este computador";
  }
  return `Este computador · ${id.slice(0, 8)}`;
}
