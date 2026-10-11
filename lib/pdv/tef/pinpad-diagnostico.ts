export type DiagnosticoPinpad = {
  codigo?: string;
  mensagem?: string;
  comunicacao?: string;
  paygoInicializado?: boolean;
  portaConfigurada?: number | null;
  portaConfiguradaDescricao?: string;
  portaUtilizada?: number | null;
  fabricante?: string;
  modelo?: string;
  firmware?: string;
  aplicacao?: string;
  serieMascarada?: string;
  ppinfoDisponivel?: boolean;
  limitacaoModelo?: string;
  codigoBiblioteca?: number | null;
};

export function mensagemDiagnosticoPinpad(input: {
  resultado?: DiagnosticoPinpad | null;
  codigo?: string | null;
  erro?: string | null;
}) {
  const codigo = input.codigo ?? "";
  if (
    codigo === "TEF_OCUPADO" ||
    codigo === "TEF_TRANSACAO_PENDENTE" ||
    codigo === "TEF_RECONCILIACAO_NECESSARIA" ||
    codigo === "PINPAD_OCUPADO"
  ) {
    return "Terminal ocupado com operação financeira.";
  }
  if (
    codigo === "PINPAD_PAYGO_NAO_INICIALIZADO" ||
    codigo === "TEF_NAO_INICIALIZADO" ||
    codigo === "TEF_TIMEOUT"
  ) {
    return codigo === "TEF_TIMEOUT"
      ? "Comunicação indisponível."
      : "Comunicação indisponível. O PayGoWeb não será reiniciado por este diagnóstico.";
  }
  const comunicacao = input.resultado?.comunicacao ?? "";
  if (comunicacao === "confirmada") {
    return "Pinpad conectado e comunicação confirmada.";
  }
  if (comunicacao === "nao_encontrado") {
    return "Pinpad não encontrado.";
  }
  if (comunicacao === "modelo_nao_reconhecido") {
    return "Modelo não reconhecido.";
  }
  if (comunicacao === "aplicacao_indisponivel") {
    return "Aplicação ou chaves necessárias não disponíveis.";
  }
  if (comunicacao === "indisponivel") {
    return "Comunicação indisponível.";
  }
  if (comunicacao === "nao_executada") {
    return input.resultado?.ppinfoDisponivel
      ? "Dados do pinpad lidos. A comunicação ainda não foi testada."
      : "A biblioteca não disponibilizou os dados do pinpad. O diagnóstico não inicia transação.";
  }
  return input.erro || "Comunicação indisponível.";
}

export function observacaoModeloPinpad(resultado?: DiagnosticoPinpad | null) {
  if (!resultado) {
    return "";
  }
  if (
    resultado.limitacaoModelo === "nao_reconhecido" ||
    resultado.comunicacao === "modelo_nao_reconhecido"
  ) {
    return "Modelo não reconhecido pela lista interna da biblioteca. Isso não é uma homologação.";
  }
  if (resultado.limitacaoModelo === "conhecido_sem_homologacao") {
    return "A biblioteca reconhece este identificador. Isso não comprova homologação.";
  }
  if (resultado.ppinfoDisponivel === false) {
    return "Fabricante e modelo não foram informados pela biblioteca. Uma porta USB do Windows não comprova compatibilidade.";
  }
  return "";
}

export function portaPinpad(resultado?: DiagnosticoPinpad | null) {
  if (!resultado) {
    return "";
  }
  const usada =
    typeof resultado.portaUtilizada === "number" && resultado.portaUtilizada > 0
      ? `porta ${resultado.portaUtilizada}`
      : "";
  const configurada = resultado.portaConfiguradaDescricao || "";
  if (usada && configurada) {
    return `${configurada} · utilizada ${usada}`;
  }
  return usada || configurada;
}
