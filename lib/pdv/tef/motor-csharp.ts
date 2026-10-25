export type OpcaoMotor = { texto: string; valor: string };

export type RespostaMotorCsharp = {
  ok: boolean;
  pagamentoRecebido: boolean;
  nativo: boolean;
  confirmada: boolean;
  codigo: string;
  erro: string;
  fase: "captura" | "resultado";
  sessao: string | null;
  prompt: string;
  oculto: boolean;
  opcoes: OpcaoMotor[];
  chave: string | null;
  tipoDado: number | null;
  codigoNativo: number | null;
  servidorValidado: boolean;
};

export function interpretarRespostaMotor(corpo: unknown): RespostaMotorCsharp {
  const resposta = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const fase = resposta.fase === "captura" ? "captura" : "resultado";
  const nativo = resposta.nativo === true;
  const confirmada = resposta.confirmada === true;
  const pagamentoRecebido =
    fase === "resultado" && nativo && confirmada && resposta.pagamentoRecebido === true && resposta.simulado !== true;
  const opcoes = Array.isArray(resposta.opcoes)
    ? resposta.opcoes
        .filter((opcao): opcao is Record<string, unknown> => Boolean(opcao) && typeof opcao === "object")
        .map((opcao) => ({
          texto: typeof opcao.texto === "string" ? opcao.texto : "",
          valor: typeof opcao.valor === "string" ? opcao.valor : "",
        }))
    : [];
  const prompt = typeof resposta.prompt === "string" ? resposta.prompt : "";
  const erroInformado = typeof resposta.erro === "string" ? resposta.erro.trim() : "";
  const codigoNativo = typeof resposta.codigoNativo === "number" ? resposta.codigoNativo : null;
  const cicloAberto = codigoNativo === -2497 || codigoNativo === -2495;
  const pagamentoEfetivo = pagamentoRecebido && !cicloAberto;
  return {
    ok: pagamentoEfetivo,
    pagamentoRecebido: pagamentoEfetivo,
    nativo,
    confirmada,
    codigo: typeof resposta.codigo === "string" ? resposta.codigo : "MOTOR_SEM_RESPOSTA",
    erro: fase === "captura" ? prompt || erroInformado || "A biblioteca pediu um dado." : pagamentoEfetivo ? "" : erroInformado || "O motor C# não confirmou a operação. Nenhum pagamento foi recebido.",
    fase,
    sessao: typeof resposta.sessao === "string" ? resposta.sessao : null,
    prompt,
    oculto: resposta.oculto === true,
    opcoes,
    chave: typeof resposta.chave === "string" ? resposta.chave : null,
    tipoDado: typeof resposta.tipoDado === "number" ? resposta.tipoDado : null,
    codigoNativo,
    servidorValidado: resposta.servidorValidado === true,
  };
}

export function instalacaoAceita(resposta: RespostaMotorCsharp) {
  return resposta.codigo === "instalada" && resposta.nativo && resposta.pagamentoRecebido === false;
}

export function pontoInstaladoNaSituacao(codigo: string) {
  return codigo === "ponto_instalado" || codigo === "venda_confirmada";
}

export function decidirComprovanteMotor(input: { ambienteGravado: string; codigo: string }) {
  if (input.codigo === "venda_confirmada") {
    return "aceitar" as const;
  }
  if (input.ambienteGravado === "producao") {
    return "producao_bloqueada" as const;
  }
  return "legado" as const;
}

const CHAVE_VENDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(debito|credito):\d+$/i;

export function haPendenciaFinanceiraNativa(mensagem: string) {
  return /confirmação financeira pendente|resultado desconhecido|aguardando confirmação|em execução/i.test(mensagem);
}

export function classificarPendenciaSituacao(mensagem: string, chave: string) {
  if (/resultado desconhecido/i.test(mensagem)) {
    return { pendencia: "resultado_desconhecido" as const, chave: "" };
  }
  if (/em execução/i.test(mensagem)) {
    return { pendencia: "executando" as const, chave: "" };
  }
  if (/aguardando confirmação/i.test(mensagem)) {
    return { pendencia: "aguardando_confirmacao" as const, chave: chave.trim() };
  }
  return { pendencia: "" as const, chave: "" };
}

export function decidirProximaCobranca(input: {
  pendencia: string;
  chavePendente: string;
  modalidade: string;
  valorCentavos: number;
}) {
  if (input.pendencia === "executando" || input.pendencia === "resultado_desconhecido") {
    return {
      acao: "aguardar" as const,
      erro: "Há uma operação financeira em andamento ou com resultado desconhecido. Nenhuma nova cobrança foi iniciada.",
    };
  }
  if (input.pendencia === "aguardando_confirmacao") {
    const chave = input.chavePendente.trim();
    const confere = chave.endsWith(`:${input.modalidade}:${input.valorCentavos}`);
    if (!confere) {
      return {
        acao: "aguardar" as const,
        erro: "Há uma autorização aguardando confirmação. O valor ou a modalidade não conferem. Nenhuma nova cobrança foi iniciada.",
      };
    }
    return { acao: "confirmar" as const, chave, erro: "" };
  }
  return { acao: "cobrar" as const, erro: "" };
}

export function faseDaCaptura(tipoDado: number | null, opcoes: Array<{ valor?: string }>) {
  const validas = opcoes.filter((opcao) => String(opcao.valor ?? "").trim().length > 0);
  if (tipoDado === 1 || validas.length > 0) return "menu" as const;
  if (tipoDado === 2 || tipoDado === 12 || tipoDado === 17) return "digitado" as const;
  return "pinpad" as const;
}

export function podeRetomarConfirmacao(
  requisitos: Array<{ id: string; ok: boolean }>,
  pendencia: string,
) {
  if (pendencia !== "aguardando_confirmacao") return false;
  return requisitos.filter((item) => item.id !== "pendencia").every((item) => item.ok);
}

export function decidirRegistroVendaMotor(input: {
  ambiente: "homologacao" | "producao";
  codigo: string;
  chave: string;
  modalidade: string;
  valorCentavos: number;
  empresaSessao: string;
  empresaJournal: string;
  vendaId?: string | null;
}) {
  if (!input.empresaSessao || input.empresaSessao.toLowerCase() !== input.empresaJournal.toLowerCase()) {
    return {
      acao: "recusar" as const,
      suprimirNfce: false,
      erro: "O pagamento pertence a outra empresa. A venda não foi registrada.",
    };
  }
  const chave = input.chave.trim();
  const confere = CHAVE_VENDA.test(chave) && chave.toLowerCase().endsWith(`:${input.modalidade}:${input.valorCentavos}`);
  if (!confere || (input.modalidade !== "debito" && input.modalidade !== "credito")) {
    return {
      acao: "recusar" as const,
      suprimirNfce: false,
      erro: "A chave não comprova esta modalidade e este valor. A venda não foi registrada e nenhuma nova cobrança foi iniciada.",
    };
  }
  if (input.codigo === "venda_vinculada") {
    const vendaId = input.vendaId?.trim() ?? "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vendaId)) {
      return {
        acao: "ja_registrada" as const,
        suprimirNfce: input.ambiente === "homologacao",
        erro: "",
        vendaId,
      };
    }
    return {
      acao: "recusar" as const,
      suprimirNfce: false,
      erro: "Este pagamento confirmado já está vinculado a uma venda. Ele não pode ser usado em outra venda. Nenhuma nova cobrança foi iniciada.",
    };
  }
  if (input.codigo !== "venda_confirmada") {
    return {
      acao: "recusar" as const,
      suprimirNfce: false,
      erro: "A operação TEF não está confirmada pela biblioteca. A venda não foi registrada como paga e nenhuma nova cobrança foi iniciada.",
    };
  }
  if (input.ambiente === "homologacao") {
    return { acao: "registrar_homologacao" as const, suprimirNfce: true, erro: "" };
  }
  return { acao: "registrar_producao" as const, suprimirNfce: false, erro: "" };
}

export function decidirTratamentoComprovante(input: {
  ambiente: "homologacao" | "producao";
  codigo: string;
  temChave: boolean;
}) {
  if (input.codigo === "venda_confirmada" && input.ambiente === "producao") {
    return { acao: "registrar_producao" as const, suprimirNfceComercial: false };
  }
  if (input.codigo === "venda_confirmada" && input.ambiente === "homologacao") {
    return { acao: "aceitar_homologacao" as const, suprimirNfceComercial: true };
  }
  if (input.codigo === "venda_pendente") {
    return {
      acao: "recusar" as const,
      erro: "A operação TEF ainda não está confirmada. A venda não foi registrada. Nenhuma nova cobrança foi iniciada.",
    };
  }
  if (input.ambiente === "producao") {
    return {
      acao: "recusar" as const,
      erro: input.temChave
        ? "A operação TEF de produção não está confirmada. A venda não foi registrada e nenhuma nova cobrança foi iniciada."
        : "A produção TEF não está habilitada. Nenhuma cobrança foi iniciada.",
    };
  }
  return { acao: "legado" as const };
}

export async function cobrarPeloMotorCsharp(entrada: {
  origem: string | null;
  comando?: "vender" | "instalar" | "configurar" | "cancelar" | "confirmar" | "recuperar" | "responder" | "situacao" | "pinpad";
  modalidade?: string;
  valorCentavos?: number;
  parcelas?: number;
  chave?: string;
  sessao?: string | null;
  valor?: string;
  cancelar?: boolean;
}) {
  const resposta = await fetch("/api/pdv/tef/motor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entrada),
    signal: AbortSignal.timeout(180000),
  });
  return interpretarRespostaMotor(await resposta.json().catch(() => null));
}
