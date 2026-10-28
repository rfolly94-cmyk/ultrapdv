export const STATUS_BLOQUEIAM_TROCA = [
  "executando",
  "aguardando_confirmacao",
  "resultado_desconhecido",
  "aguardando_decisao",
] as const;

export function decidirTrocaAmbiente(input: {
  ambienteAtual: "homologacao" | "producao";
  ambienteNovo: "homologacao" | "producao";
  statuses: string[];
  motorOcupado: boolean;
  consultaOk: boolean;
}) {
  if (input.ambienteAtual === input.ambienteNovo) {
    return { pode: true as const, motivo: "" };
  }
  if (!input.consultaOk) {
    return {
      pode: false as const,
      motivo: "Não foi possível ler as pendências de homologação e produção. A configuração não foi alterada e nenhum journal foi modificado.",
    };
  }
  if (input.motorOcupado || input.statuses.some((status) => (STATUS_BLOQUEIAM_TROCA as readonly string[]).includes(status))) {
    return {
      pode: false as const,
      motivo: "Há transação em andamento, confirmação pendente ou desfazimento neste terminal. A troca foi impedida e nenhum journal foi modificado.",
    };
  }
  return { pode: true as const, motivo: "" };
}

export function origemLocalDoConector(valor: string) {
  try {
    const url = new URL(valor);
    const porta = Number(url.port);
    if (url.protocol !== "http:") return null;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
    if (!Number.isInteger(porta) || porta < 18181 || porta > 18190) return null;
    return `${url.protocol}//${url.hostname}:${porta}`;
  } catch {
    return null;
  }
}
