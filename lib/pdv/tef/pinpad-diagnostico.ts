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
  avisoBiblioteca?: string | null;
  duracaoMs?: number | null;
  chamadaNativaEmExecucao?: boolean;
};

export function simularDiagnosticoPinpad(roteiro: string) {
  const mensagens: Record<string, string> = {
    confirmado: "Pinpad conectado e comunicação confirmada.",
    conector_ausente: "Connector não encontrado.",
    ausente: "Pinpad ausente.",
    timeout: "Tempo esgotado.",
    ocupado: "Pinpad ocupado.",
  };
  return {
    cobrancaIniciada: false,
    dllCarregada: false,
    bibliotecaChamada: false,
    mensagem: mensagens[roteiro] ?? "Diagnóstico indisponível.",
  };
}

export function mensagemDiagnosticoPinpad(input: {
  resultado?: DiagnosticoPinpad | null;
  codigo?: string | null;
  erro?: string | null;
}) {
  const codigo = input.codigo ?? "";
  if (
    codigo === "TEF_OCUPADO" &&
    typeof input.erro === "string" &&
    input.erro.includes("ainda está em execução")
  ) {
    return input.erro;
  }
  if (
    codigo === "TEF_OCUPADO" ||
    codigo === "TEF_TRANSACAO_PENDENTE" ||
    codigo === "TEF_RECONCILIACAO_NECESSARIA" ||
    codigo === "PINPAD_OCUPADO"
  ) {
    return "Terminal ocupado com operação financeira.";
  }
  if (codigo === "TEF_TIMEOUT") {
    return "O teste de comunicação não retornou no tempo limite. A biblioteca não enviou código. Nenhuma cobrança foi iniciada.";
  }
  if (codigo === "PINPAD_PAYGO_NAO_INICIALIZADO" || codigo === "TEF_NAO_INICIALIZADO") {
    return "A PGWebLib ainda não foi inicializada. Este diagnóstico não a inicializa. O PayGoWeb não será reiniciado por este diagnóstico.";
  }
  const comunicacao = input.resultado?.comunicacao ?? "";
  if (comunicacao === "timeout") {
    return "O teste de comunicação não retornou no tempo limite. A biblioteca não enviou código. Nenhuma cobrança foi iniciada.";
  }
  if (comunicacao === "timeout_biblioteca") {
    return "A biblioteca informou tempo esgotado aguardando o pinpad.";
  }
  if (comunicacao === "nao_concluido") {
    return typeof input.resultado?.codigoBiblioteca === "number"
      ? `A biblioteca pediu para continuar o teste e não concluiu. Código ${input.resultado.codigoBiblioteca}.`
      : "A biblioteca pediu para continuar o teste e não concluiu.";
  }
  if (comunicacao === "sem_porta") {
    return "A biblioteca não tem porta de pinpad utilizável pela API. A porta do Windows não foi forçada.";
  }
  if (comunicacao === "codigo_biblioteca") {
    return typeof input.resultado?.codigoBiblioteca === "number"
      ? `A biblioteca devolveu o código ${input.resultado.codigoBiblioteca}.`
      : "A biblioteca devolveu um código não classificado.";
  }
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
