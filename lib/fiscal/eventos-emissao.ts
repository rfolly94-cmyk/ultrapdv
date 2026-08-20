export type EventoEmissaoFiscal = {
  id: string;
  emissao_id?: string | null;
  tipo: string;
  status: string;
  sequencia?: number | null;
  justificativa?: string | null;
  texto_correcao?: string | null;
  cstat?: string | null;
  protocolo?: string | null;
  motivo?: string | null;
  xml_hex?: string | null;
  concluido_at?: string | null;
  created_at: string;
};

export function cancelamentoDaEmissao(
  eventos: EventoEmissaoFiscal[],
  emissaoId: string
) {
  return (
    eventos.find(
      (evento) =>
        String(evento.emissao_id ?? emissaoId) === emissaoId &&
        evento.tipo === "cancelamento"
    ) ?? null
  );
}

export function cartasCorrecaoDaEmissao(
  eventos: EventoEmissaoFiscal[],
  emissaoId: string
) {
  return eventos
    .filter(
      (evento) =>
        String(evento.emissao_id ?? emissaoId) === emissaoId &&
        evento.tipo === "carta_correcao"
    )
    .sort(
      (a, b) => Number(b.sequencia ?? 0) - Number(a.sequencia ?? 0)
    );
}

export function proximaSequenciaCce(cartas: EventoEmissaoFiscal[]) {
  const ultimaSucesso = cartas.find((evento) => evento.status === "sucesso");
  return ultimaSucesso ? Number(ultimaSucesso.sequencia ?? 0) + 1 : 1;
}

export function rotuloTipoEventoFiscal(tipo: string) {
  if (tipo === "cancelamento") {
    return "Cancelamento";
  }
  if (tipo === "carta_correcao") {
    return "Carta de Correção";
  }
  if (tipo === "consulta_status") {
    return "Consulta de situação";
  }
  if (tipo === "inutilizacao") {
    return "Inutilização";
  }
  return tipo.replace(/_/g, " ");
}
