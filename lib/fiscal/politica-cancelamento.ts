import {
  formatarDataHoraFiscalPtBr,
  fusoFiscalPadrao,
  parseDataFiscal,
} from "@/lib/fiscal/geranet/data-hora";

export type CodigoPoliticaCancelamento =
  | "dentro_do_prazo"
  | "proximo_do_fim"
  | "prazo_encerrado"
  | "politica_nao_configurada"
  | "data_autorizacao_ausente"
  | "ja_cancelada"
  | "status_invalido"
  | "modelo_invalido"
  | "uf_invalida";

export type PoliticaCancelamento = {
  codigo: CodigoPoliticaCancelamento;
  permitido: boolean;
  uf: string;
  modelo: string;
  prazoNormalMinutos: number | null;
  prazoRotulo: string | null;
  autorizadoEm: Date | null;
  limiteEm: Date | null;
  restanteMs: number | null;
  motivoBloqueio: string | null;
  mensagemInformativa: string | null;
  alertaProximoFim: boolean;
  exigeConfirmacaoCirculacao: boolean;
  exigeConfirmacaoDuplicata: boolean;
  situacaoTexto: string;
  autorizadoEmTexto: string | null;
  limiteEmTexto: string | null;
  restanteTexto: string | null;
  fusoHorario: string;
};

export type PoliticaCancelamentoPublica = {
  codigo: CodigoPoliticaCancelamento;
  permitido: boolean;
  uf: string;
  modelo: string;
  prazoNormalMinutos: number | null;
  prazoRotulo: string | null;
  autorizadoEmIso: string | null;
  autorizadoEmTexto: string | null;
  limiteEmIso: string | null;
  limiteEmTexto: string | null;
  restanteMs: number | null;
  restanteTexto: string | null;
  motivoBloqueio: string | null;
  mensagemInformativa: string | null;
  alertaProximoFim: boolean;
  exigeConfirmacaoCirculacao: boolean;
  exigeConfirmacaoDuplicata: boolean;
  situacaoTexto: string;
  fusoHorario: string;
};

type RegraPrazo = {
  minutos: number;
  rotulo: string;
};

const POLITICAS_POR_UF: Record<string, Partial<Record<"55" | "65", RegraPrazo>>> =
  {
    MT: {
      "65": { minutos: 30, rotulo: "30 minutos" },
      "55": { minutos: 24 * 60, rotulo: "24 horas" },
    },
  };

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function regraPrazo(uf: string, modelo: string) {
  return POLITICAS_POR_UF[uf]?.[modelo as "55" | "65"] ?? null;
}

function formatarExibicaoSegura(data: Date, fuso: string) {
  try {
    return formatarDataHoraFiscalPtBr(data, fuso);
  } catch {
    return data.toISOString();
  }
}

function limiarAlertaMs(prazoMinutos: number) {
  if (prazoMinutos <= 30) {
    return 5 * 60 * 1000;
  }

  return 2 * 60 * 60 * 1000;
}

export function formatarRestanteCancelamento(restanteMs: number | null) {
  if (restanteMs === null || restanteMs <= 0) {
    return null;
  }

  const totalMinutos = Math.floor(restanteMs / 60_000);
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;

  if (horas > 0) {
    return `Restam ${horas}h ${String(minutos).padStart(2, "0")}min`;
  }

  if (totalMinutos < 1) {
    return "Restam menos de 1 minuto";
  }

  return `Restam aproximadamente ${totalMinutos} minutos`;
}

export function resolverPoliticaCancelamentoFiscal({
  uf,
  modelo,
  status,
  autorizadoEm,
  agora = new Date(),
  fusoHorario,
}: {
  uf: string;
  modelo: string;
  status: string;
  autorizadoEm?: string | Date | null;
  agora?: Date;
  fusoHorario?: string | null;
}): PoliticaCancelamento {
  const ufLimpa = texto(uf).toUpperCase();
  const modeloLimpo = texto(modelo);
  const statusLimpo = texto(status);
  const fuso = fusoFiscalPadrao(ufLimpa, fusoHorario);

  const base = {
    uf: ufLimpa,
    modelo: modeloLimpo,
    prazoNormalMinutos: null as number | null,
    prazoRotulo: null as string | null,
    autorizadoEm: null as Date | null,
    limiteEm: null as Date | null,
    restanteMs: null as number | null,
    motivoBloqueio: null as string | null,
    mensagemInformativa: null as string | null,
    alertaProximoFim: false,
    exigeConfirmacaoCirculacao: true,
    exigeConfirmacaoDuplicata: modeloLimpo === "55",
    autorizadoEmTexto: null as string | null,
    limiteEmTexto: null as string | null,
    restanteTexto: null as string | null,
    fusoHorario: fuso,
  };

  if (statusLimpo === "cancelada") {
    return {
      ...base,
      codigo: "ja_cancelada",
      permitido: false,
      motivoBloqueio: "Documento já cancelado.",
      situacaoTexto: "Documento já cancelado",
    };
  }

  if (statusLimpo !== "autorizada") {
    return {
      ...base,
      codigo: "status_invalido",
      permitido: false,
      motivoBloqueio: `Somente documento autorizado pode ser cancelado. Status atual: ${statusLimpo || "—"}.`,
      situacaoTexto: "Cancelamento indisponível",
    };
  }

  if (modeloLimpo !== "55" && modeloLimpo !== "65") {
    return {
      ...base,
      codigo: "modelo_invalido",
      permitido: false,
      motivoBloqueio: "Modelo fiscal não suportado pelo cancelamento.",
      situacaoTexto: "Cancelamento indisponível",
    };
  }

  if (!/^[A-Z]{2}$/.test(ufLimpa)) {
    return {
      ...base,
      codigo: "uf_invalida",
      permitido: false,
      motivoBloqueio: "UF fiscal do emitente inválida.",
      situacaoTexto: "Cancelamento indisponível",
    };
  }

  const regra = regraPrazo(ufLimpa, modeloLimpo);
  if (!regra) {
    return {
      ...base,
      codigo: "politica_nao_configurada",
      permitido: true,
      mensagemInformativa:
        "A política de prazo de cancelamento desta UF ainda não está configurada no UltraPDV. O sistema não aplica automaticamente os prazos de Mato Grosso.",
      situacaoTexto: "Política de prazo não configurada para esta UF",
    };
  }

  const autorizado = parseDataFiscal(autorizadoEm);
  if (!autorizado) {
    return {
      ...base,
      codigo: "data_autorizacao_ausente",
      permitido: false,
      prazoNormalMinutos: regra.minutos,
      prazoRotulo: regra.rotulo,
      motivoBloqueio:
        "Não foi possível validar previamente o prazo de cancelamento porque a data/hora da Autorização de Uso não está armazenada. Consulte/reconcilie a situação fiscal antes de enviar o cancelamento.",
      situacaoTexto: "Data de autorização indisponível",
    };
  }

  const limite = new Date(autorizado.getTime() + regra.minutos * 60_000);
  const restanteMs = limite.getTime() - agora.getTime();
  const autorizadoEmTexto = formatarExibicaoSegura(autorizado, fuso);
  const limiteEmTexto = formatarExibicaoSegura(limite, fuso);
  const restanteTexto = formatarRestanteCancelamento(restanteMs);

  const comum = {
    ...base,
    permitido: restanteMs >= 0,
    prazoNormalMinutos: regra.minutos,
    prazoRotulo: regra.rotulo,
    autorizadoEm: autorizado,
    limiteEm: limite,
    restanteMs,
    autorizadoEmTexto,
    limiteEmTexto,
    restanteTexto,
  };

  if (restanteMs < 0) {
    const mensagemNfce =
      "Prazo normal de cancelamento da NFC-e encerrado. Em Mato Grosso, o cancelamento normal deve ser solicitado em até 30 minutos após a autorização. Verifique se o caso permite procedimento extemporâneo ou outra forma de regularização fiscal.";
    const mensagemNfe =
      "Prazo normal de cancelamento da NF-e encerrado. Em Mato Grosso, o cancelamento normal deve ser solicitado em até 24 horas após a autorização. Verifique procedimento fiscal aplicável para cancelamento extemporâneo.";

    return {
      ...comum,
      codigo: "prazo_encerrado",
      permitido: false,
      motivoBloqueio: modeloLimpo === "65" ? mensagemNfce : mensagemNfe,
      mensagemInformativa:
        modeloLimpo === "65"
          ? "Cancelamento normal indisponível. Prazo de 30 minutos encerrado. Mato Grosso possui hipóteses/procedimentos específicos posteriores; o UltraPDV não implementa cancelamento extemporâneo nem cancelamento por substituição nesta etapa."
          : "Cancelamento normal indisponível. Prazo de 24 horas encerrado. Verifique procedimento fiscal aplicável para cancelamento extemporâneo. O UltraPDV não gera guia/taxa automaticamente.",
      situacaoTexto: "Prazo normal encerrado",
    };
  }

  const proximo = restanteMs <= limiarAlertaMs(regra.minutos);

  return {
    ...comum,
    codigo: proximo ? "proximo_do_fim" : "dentro_do_prazo",
    permitido: true,
    alertaProximoFim: proximo,
    situacaoTexto: proximo
      ? "Prazo próximo do encerramento"
      : "Dentro do prazo normal",
  };
}

export function serializarPoliticaCancelamento(
  politica: PoliticaCancelamento
): PoliticaCancelamentoPublica {
  return {
    codigo: politica.codigo,
    permitido: politica.permitido,
    uf: politica.uf,
    modelo: politica.modelo,
    prazoNormalMinutos: politica.prazoNormalMinutos,
    prazoRotulo: politica.prazoRotulo,
    autorizadoEmIso: politica.autorizadoEm?.toISOString() ?? null,
    autorizadoEmTexto: politica.autorizadoEmTexto,
    limiteEmIso: politica.limiteEm?.toISOString() ?? null,
    limiteEmTexto: politica.limiteEmTexto,
    restanteMs: politica.restanteMs,
    restanteTexto: politica.restanteTexto,
    motivoBloqueio: politica.motivoBloqueio,
    mensagemInformativa: politica.mensagemInformativa,
    alertaProximoFim: politica.alertaProximoFim,
    exigeConfirmacaoCirculacao: politica.exigeConfirmacaoCirculacao,
    exigeConfirmacaoDuplicata: politica.exigeConfirmacaoDuplicata,
    situacaoTexto: politica.situacaoTexto,
    fusoHorario: politica.fusoHorario,
  };
}

export function eventoCancelamentoPendente(statusEvento?: string | null) {
  return ["processando", "aguardando_reconciliacao"].includes(
    texto(statusEvento)
  );
}

export function avaliarEnvioCancelamentoNormal({
  statusEmissao,
  statusEventoCancelamento,
  politica,
  confirmouNaoCirculacao,
  confirmouSemDuplicataEscritural,
  justificativa,
}: {
  statusEmissao: string;
  statusEventoCancelamento?: string | null;
  politica: PoliticaCancelamento;
  confirmouNaoCirculacao: boolean;
  confirmouSemDuplicataEscritural: boolean;
  justificativa: string;
}): {
  permitirEnvio: boolean;
  codigo: string;
  motivo: string | null;
} {
  if (texto(statusEmissao) === "cancelada" || politica.codigo === "ja_cancelada") {
    return {
      permitirEnvio: false,
      codigo: "ja_cancelada",
      motivo: "Documento já cancelado.",
    };
  }

  if (eventoCancelamentoPendente(statusEventoCancelamento)) {
    return {
      permitirEnvio: false,
      codigo: "aguardando_reconciliacao",
      motivo:
        "Existe uma tentativa de cancelamento com resultado pendente. Consulte a situação antes de reenviar.",
    };
  }

  if (texto(justificativa).length < 15) {
    return {
      permitirEnvio: false,
      codigo: "justificativa_invalida",
      motivo: "A justificativa deve possuir pelo menos 15 caracteres.",
    };
  }

  if (!confirmouNaoCirculacao) {
    return {
      permitirEnvio: false,
      codigo: "confirmacao_circulacao_ausente",
      motivo:
        "Confirme que não houve circulação/saída ou prestação que impeça o cancelamento.",
    };
  }

  if (politica.exigeConfirmacaoDuplicata && !confirmouSemDuplicataEscritural) {
    return {
      permitirEnvio: false,
      codigo: "confirmacao_duplicata_ausente",
      motivo:
        "Confirme que esta NF-e não possui vinculação à Duplicata Escritural que impeça seu cancelamento.",
    };
  }

  if (politica.codigo === "prazo_encerrado") {
    return {
      permitirEnvio: false,
      codigo: "prazo_encerrado",
      motivo:
        "O prazo normal de cancelamento encerrou antes da confirmação da operação.",
    };
  }

  if (!politica.permitido) {
    return {
      permitirEnvio: false,
      codigo: politica.codigo,
      motivo: politica.motivoBloqueio,
    };
  }

  return {
    permitirEnvio: true,
    codigo: politica.codigo,
    motivo: null,
  };
}

export function resumoAuditoriaCancelamento({
  politica,
  confirmouNaoCirculacao,
  confirmouSemDuplicataEscritural,
  solicitadoEm,
}: {
  politica: PoliticaCancelamento;
  confirmouNaoCirculacao: boolean;
  confirmouSemDuplicataEscritural: boolean;
  solicitadoEm: Date;
}) {
  return {
    uf: politica.uf,
    modelo: politica.modelo,
    autorizado_em: politica.autorizadoEm?.toISOString() ?? null,
    prazo_normal_minutos: politica.prazoNormalMinutos,
    prazo_rotulo: politica.prazoRotulo,
    limite_em: politica.limiteEm?.toISOString() ?? null,
    solicitado_em: solicitadoEm.toISOString(),
    confirmou_nao_circulacao: confirmouNaoCirculacao,
    confirmou_sem_duplicata_escritural:
      politica.modelo === "55" ? confirmouSemDuplicataEscritural : null,
    politica: politica.codigo,
  };
}
