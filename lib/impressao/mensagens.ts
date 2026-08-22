export const MENSAGEM_CONECTOR_AUSENTE =
  "UltraPDV Conector não encontrado.\n\nVerifique se o Conector está instalado e em execução neste computador.";

export const MENSAGEM_CONECTOR_NAO_CONTRATADO =
  "Impressão pelo UltraPDV Conector não está disponível no plano atual.\nVocê ainda pode visualizar ou baixar o documento.";

export const MENSAGEM_IMPRESSORA_CONECTOR =
  "Nenhuma impressora disponível/configurada no UltraPDV Conector.\n\nAbra o UltraPDV Conector e selecione uma impressora.";

export function mensagemDocumentoEnviado(impressora: string | null | undefined) {
  const nome = String(impressora ?? "").trim();
  if (!nome) {
    return "Enviado para impressão";
  }
  return `Documento enviado para ${nome}.`;
}

export function normalizarErroImpressaoConector(erro: string | null | undefined) {
  const texto = String(erro ?? "").trim();
  if (!texto) {
    return MENSAGEM_CONECTOR_AUSENTE;
  }
  if (/conector não encontrado|failed to fetch|networkerror|aborted/i.test(texto)) {
    return MENSAGEM_CONECTOR_AUSENTE;
  }
  if (/nenhuma impressora|impressora não encontrada|não disponível/i.test(texto)) {
    return MENSAGEM_IMPRESSORA_CONECTOR;
  }
  return texto;
}
