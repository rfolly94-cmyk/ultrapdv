import { PRINT_AGENT_HOST, PRINT_AGENT_PORT, PRINT_AGENT_PORTA_MAX_AUTO } from "./tipos";

export function origemDoConnectorUnico(origem: string) {
  try {
    const url = new URL(origem);
    const porta = Number(url.port);
    const host = url.hostname;
    if (url.protocol !== "http:") return null;
    if (host !== PRINT_AGENT_HOST && host !== "localhost") return null;
    if (!Number.isInteger(porta) || porta < PRINT_AGENT_PORT || porta > PRINT_AGENT_PORTA_MAX_AUTO) {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
