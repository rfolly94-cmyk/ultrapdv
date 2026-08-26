export const MENSAGEM_CONECTOR_AUSENTE =
  "UltraPDV Connector não encontrado neste computador.\n\nInstale o Connector e aguarde ele iniciar. Não é necessário informar porta.";

export const MENSAGEM_CONECTOR_SEM_PORTA =
  "O UltraPDV Connector não respondeu em nenhuma porta válida (18181 a 18190).\n\nVerifique se o Connector está em execução neste computador.";

export const MENSAGEM_CONECTOR_BLOQUEADO =
  "O navegador bloqueou o acesso ao UltraPDV Connector.\n\nPermita o acesso à rede local para este site e tente novamente.";

export const MENSAGEM_CONECTOR_NAO_CONTRATADO =
  "Impressão pelo UltraPDV Conector não está disponível no plano atual.\nVocê ainda pode visualizar ou baixar o documento.";

export const MENSAGEM_IMPRESSORA_CONECTOR =
  "Nenhuma impressora disponível/configurada no UltraPDV Conector.\n\nAbra o UltraPDV Conector e selecione uma impressora.";

export const MENSAGEM_IMPRESSORA_SELECIONADA_AUSENTE =
  "A impressora selecionada não existe neste computador.";

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
  if (
    /conector não encontrado|connector não encontrado|failed to fetch|networkerror|aborted/i.test(
      texto
    )
  ) {
    return MENSAGEM_CONECTOR_AUSENTE;
  }
  if (
    /impressora selecionada não existe|impressora não encontrada neste computador/i.test(
      texto
    )
  ) {
    return MENSAGEM_IMPRESSORA_SELECIONADA_AUSENTE;
  }
  if (/nenhuma impressora|não disponível\/configurada/i.test(texto)) {
    return MENSAGEM_IMPRESSORA_CONECTOR;
  }
  return texto;
}
