import { mensagemPortaForaDaFaixa, mensagemPortaOcupada, portaValida } from "./portas.mjs";

export const CODIGO_SAIDA_REINICIO = 75;
export const PRAZO_REINICIO_MS = 8000;

const MENSAGENS_BLOQUEIO = Object.freeze({
  transacao: "Há uma transação financeira ativa. A operação foi recusada.",
  ocupacao: "O PinPad está em uso. A operação foi recusada.",
  desconhecido: "Há resultado financeiro desconhecido. A operação foi recusada.",
  sessao: "A sessão nativa ainda está aberta. A operação foi recusada.",
});

export function avaliarBloqueioCiclo({ ocupacao = null, journal = null, pendente = null } = {}) {
  const status = String(journal?.status ?? "");
  const acao = String(pendente?.acao ?? "");
  if (ocupacao) return { permitido: false, motivo: "ocupacao", preservarJournal: true };
  if (journal?.sessaoNativa === "residente") return { permitido: false, motivo: "sessao", preservarJournal: true };
  if (
    journal?.resultado === "desconhecido" ||
    status === "desconhecido" ||
    status === "resultado_desconhecido"
  ) {
    return { permitido: false, motivo: "desconhecido", preservarJournal: true };
  }
  if (
    acao === "pagamento" ||
    acao === "confirmar" ||
    acao === "desfazer" ||
    acao === "instalar" ||
    pendente?.transacaoPendente != null ||
    [
      "iniciada",
      "autorizada",
      "aguardando_captura",
      "aguardando_confirmacao",
      "pagamento_em_andamento",
      "aguardando_decisao",
      "desfazimento_pendente",
    ].includes(status)
  ) {
    return { permitido: false, motivo: "transacao", preservarJournal: true };
  }
  return { permitido: true, motivo: "ocioso", preservarJournal: true };
}

export function mensagemBloqueioCiclo(motivo) {
  return MENSAGENS_BLOQUEIO[motivo] || "A operação do Connector foi recusada.";
}

export function planejarReinicio(bloqueio = { permitido: true }, { supervisor = false } = {}) {
  if (bloqueio?.permitido !== true) {
    return {
      ok: false,
      status: 409,
      codigo: bloqueio.motivo || "transacao",
      concluido: false,
      erro: mensagemBloqueioCiclo(bloqueio.motivo),
      preservarJournal: true,
    };
  }
  return {
    ok: true,
    status: "reiniciando",
    concluido: false,
    supervisor: supervisor === true,
    codigoSaida: supervisor === true ? CODIGO_SAIDA_REINICIO : null,
    preservarJournal: true,
  };
}

export function confirmarDisponibilidade(saude, { portaEsperada, prazoEsgotado = false } = {}) {
  if (prazoEsgotado) {
    return { ok: false, status: "falha", mensagem: "O Connector não voltou a responder." };
  }
  if (saude?.ok === true && Number(saude.port) === Number(portaEsperada)) {
    return { ok: true, status: "reiniciado", mensagem: "Reiniciado com sucesso" };
  }
  return { ok: false, status: "aguardando", mensagem: "Reiniciando…" };
}

export function planejarAlteracaoPorta({
  porta,
  portaAtual,
  ocupada = false,
  bloqueio = { permitido: true },
  reservadas = [],
} = {}) {
  if (bloqueio?.permitido !== true) {
    return {
      ok: false,
      status: 409,
      codigo: bloqueio.motivo || "transacao",
      erro: mensagemBloqueioCiclo(bloqueio.motivo),
      preservarDispositivo: true,
    };
  }
  const numero = Number(porta);
  if (!portaValida(numero)) {
    return { ok: false, status: 400, codigo: "faixa", erro: mensagemPortaForaDaFaixa(), preservarDispositivo: true };
  }
  if (reservadas.includes(numero)) {
    return { ok: false, status: 400, codigo: "reservada", erro: mensagemPortaOcupada(numero), preservarDispositivo: true };
  }
  if (numero !== Number(portaAtual) && ocupada) {
    return { ok: false, status: 409, codigo: "ocupada", erro: mensagemPortaOcupada(numero), preservarDispositivo: true };
  }
  return {
    ok: true,
    porta: numero,
    patch: { preferredPort: numero, activePort: numero },
    reinicio: false,
    preservarDispositivo: true,
  };
}

export function planejarRollbackPorta(anterior = {}) {
  return {
    preferredPort: Number(anterior.preferredPort),
    activePort: Number(anterior.activePort),
    motivo: "escuta_falhou",
    preservarDispositivo: true,
  };
}

export function planejarEncerramento(modo = "aplicativo", bloqueio = { permitido: true }) {
  if (modo === "janela" || modo === "bandeja") {
    return {
      ok: true,
      encerraProcesso: false,
      concluido: true,
      mensagem: "O Connector continua em execução.",
    };
  }
  if (modo !== "aplicativo") {
    return { ok: false, status: 400, encerraProcesso: false, erro: "Modo de saída desconhecido." };
  }
  if (bloqueio?.permitido !== true) {
    return {
      ok: false,
      status: 409,
      encerraProcesso: false,
      codigo: bloqueio.motivo || "transacao",
      erro: mensagemBloqueioCiclo(bloqueio.motivo),
      preservarJournal: true,
    };
  }
  return { ok: true, status: "encerrando", encerraProcesso: true, concluido: false, preservarJournal: true };
}

export function resolverPerfilTef(ambiente) {
  if (ambiente === "homologacao") {
    return {
      ambiente: "homologacao",
      ponto: "ponto_homologacao",
      diretorio: ["TEF", "Homologacao", "PGWeb"],
      credencial: "sandbox",
    };
  }
  if (ambiente === "producao") {
    return {
      ambiente: "producao",
      ponto: "ponto_captura",
      diretorio: ["TEF", "Producao", "PGWeb"],
      credencial: "comercial",
    };
  }
  return { ambiente: "", ponto: "", diretorio: [], credencial: "" };
}

export function redigirDiagnostico(texto) {
  return String(texto ?? "")
    .replace(/\b\d{14}\b/g, "[documento]")
    .replace(/senha\S*/gi, "[oculto]")
    .replace(/chave\S*/gi, "[oculto]")
    .slice(0, 180);
}

export function montarDiagnosticoConector(entrada = {}) {
  const dll = entrada.dll ?? {};
  const pgweb = entrada.pgwebLib ?? {};
  const versaoBiblioteca = String(dll.versao || pgweb.versao || "");
  return {
    conector: {
      nome: String(entrada.nome || "UltraPDV Connector"),
      versao: String(entrada.versao || ""),
    },
    tef: {
      modulo: dll.ok === true || pgweb.pronta === true ? "PGWebLib.dll" : "",
      versao: versaoBiblioteca,
    },
    pgweb: {
      versao: String(dll.versao || ""),
      arquitetura: String(dll.arquitetura || ""),
      estado: dll.ok === true ? "validada" : "nao_validada",
    },
    biblioteca: entrada.bibliotecaInicializada === true ? "inicializada" : "nao_inicializada",
    ambiente: entrada.ambiente === "homologacao" ? "homologacao" : entrada.ambiente === "producao" ? "producao" : "",
    pinpad: entrada.pinpadOcupado === true ? "ocupado" : entrada.pinpadConfirmado === true ? "comunicando" : "ocioso",
    portaHttp: Number(entrada.porta) || null,
    ultimaFalha: redigirDiagnostico(entrada.ultimaFalha),
  };
}
