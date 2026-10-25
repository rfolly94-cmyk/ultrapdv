import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const PREFIXO_EVIDENCIA_INSTALACAO = "ultrapdv-tef-instalacao-v1";

const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PONTO = /^[A-Za-z0-9._-]{1,40}$/;

export type AmbienteEvidenciaInstalacao = "homologacao" | "producao";

export type SituacaoAmbienteInstalacao = "comprovado" | "declarado" | "desconhecido";

export type OrigemAmbienteInstalacao = "instalacao_controlada" | "declarada" | "ausente";

export type EventoRevogacaoEvidencia = "nenhum" | "reset" | "reinstalacao" | "troca_ponto";

export type ObservacaoInstalacaoControlada = {
  empresaId: string;
  dispositivoId: string;
  terminalId: string;
  pontoCaptura: string;
  pontoInstalado: string;
  estabelecimento: string;
  ambienteSolicitado: AmbienteEvidenciaInstalacao;
  instalacaoId: string;
  pontoNaoExistia: boolean;
  retornoSetEnvironment: number;
  instalacaoConcluida: boolean;
  vinculoAutorizado: boolean;
};

export type CamposEvidenciaInstalacao = {
  empresaId: string;
  dispositivoId: string;
  terminalId: string;
  pontoCaptura: string;
  estabelecimento: string;
  ambiente: AmbienteEvidenciaInstalacao;
  instalacaoId: string;
};

export type ClassificacaoAmbienteInstalacao = {
  situacao: SituacaoAmbienteInstalacao;
  ambienteEfetivo: AmbienteEvidenciaInstalacao | null;
  origem: OrigemAmbienteInstalacao;
  deveRevogar: boolean;
  motivo: string;
};

export type RegistroEvidenciaInstalacao = {
  empresa_id: string;
  dispositivo_id: string;
  terminal_id: string;
  instalacao_id: string;
  ponto_captura: string;
  estabelecimento: string;
  ambiente: AmbienteEvidenciaInstalacao;
  origem: "instalacao_controlada";
  assinatura: string;
};

function limpar(valor: string) {
  return String(valor ?? "").trim().replace(/[\r\n]/g, "");
}

function identificador(valor: string) {
  const texto = limpar(valor).toLowerCase();
  return ID.test(texto) ? texto : "";
}

function ambiente(valor: string): AmbienteEvidenciaInstalacao | "" {
  return valor === "homologacao" || valor === "producao" ? valor : "";
}

/**
 * Mensagem exclusiva da instalação controlada.
 * Manter o texto idêntico a print-agent/src/tef-prova.mjs.
 * As quatro linhas finais registram ponto ausente, PWRET_OK, PWOPER_INSTALL e vínculo.
 */
export function mensagemEvidenciaInstalacao(campos: CamposEvidenciaInstalacao) {
  return [
    PREFIXO_EVIDENCIA_INSTALACAO,
    limpar(campos.empresaId).toLowerCase(),
    limpar(campos.dispositivoId).toLowerCase(),
    limpar(campos.terminalId).toLowerCase(),
    limpar(campos.pontoCaptura),
    limpar(campos.estabelecimento),
    limpar(campos.ambiente),
    limpar(campos.instalacaoId).toLowerCase(),
    "1",
    "0",
    "1",
    "1",
  ].join("\n");
}

export function avaliarEmissaoEvidencia(
  observacao: ObservacaoInstalacaoControlada
): { ok: true; campos: CamposEvidenciaInstalacao } | { ok: false; motivo: string } {
  const empresaId = identificador(observacao.empresaId);
  const dispositivoId = identificador(observacao.dispositivoId);
  const terminalId = identificador(observacao.terminalId);
  const instalacaoId = identificador(observacao.instalacaoId);
  const pontoCaptura = limpar(observacao.pontoCaptura);
  const pontoInstalado = limpar(observacao.pontoInstalado);
  const estabelecimento = limpar(observacao.estabelecimento);
  const ambienteSolicitado = ambiente(observacao.ambienteSolicitado);
  if (!empresaId || !dispositivoId || !terminalId || !instalacaoId) {
    return { ok: false, motivo: "Os identificadores da instalação estão incompletos." };
  }
  if (!PONTO.test(pontoCaptura)) {
    return { ok: false, motivo: "O ponto de captura da instalação é inválido." };
  }
  if (estabelecimento.length < 1 || estabelecimento.length > 40) {
    return { ok: false, motivo: "O estabelecimento da instalação é inválido." };
  }
  if (!ambienteSolicitado) {
    return { ok: false, motivo: "O ambiente solicitado da instalação é inválido." };
  }
  if (observacao.vinculoAutorizado !== true) {
    return { ok: false, motivo: "Empresa, dispositivo e terminal ainda não estavam autorizados." };
  }
  if (observacao.pontoNaoExistia !== true) {
    return { ok: false, motivo: "O ponto de captura já existia antes desta instalação." };
  }
  if (observacao.retornoSetEnvironment !== 0) {
    return { ok: false, motivo: "PW_iSetEnvironment não retornou sucesso para o ambiente solicitado." };
  }
  if (observacao.instalacaoConcluida !== true) {
    return { ok: false, motivo: "PWOPER_INSTALL não concluiu para este ponto." };
  }
  if (pontoInstalado !== pontoCaptura) {
    return { ok: false, motivo: "O ponto instalado diverge do ponto solicitado." };
  }
  return {
    ok: true,
    campos: {
      empresaId,
      dispositivoId,
      terminalId,
      pontoCaptura,
      estabelecimento,
      ambiente: ambienteSolicitado,
      instalacaoId,
    },
  };
}

export function camposEvidenciaValidos(campos: CamposEvidenciaInstalacao) {
  return (
    avaliarEmissaoEvidencia({
      ...campos,
      ambienteSolicitado: campos.ambiente,
      pontoInstalado: campos.pontoCaptura,
      pontoNaoExistia: true,
      retornoSetEnvironment: 0,
      instalacaoConcluida: true,
      vinculoAutorizado: true,
    }).ok === true
  );
}

export function assinarEvidenciaInstalacao(
  chavePrivadaPem: string,
  observacao: ObservacaoInstalacaoControlada
) {
  const emissao = avaliarEmissaoEvidencia(observacao);
  if (!emissao.ok) {
    return null;
  }
  const assinatura = sign(
    null,
    Buffer.from(mensagemEvidenciaInstalacao(emissao.campos)),
    createPrivateKey(chavePrivadaPem)
  ).toString("base64");
  return { campos: emissao.campos, assinatura };
}

export function verificarAssinaturaEvidenciaInstalacao(
  chavePublicaPem: string,
  campos: CamposEvidenciaInstalacao,
  assinatura: string
) {
  if (!chavePublicaPem || !assinatura || !camposEvidenciaValidos(campos)) {
    return false;
  }
  try {
    return verify(
      null,
      Buffer.from(mensagemEvidenciaInstalacao(campos)),
      createPublicKey(chavePublicaPem),
      Buffer.from(assinatura, "base64")
    );
  } catch {
    return false;
  }
}

export function classificacaoSemEvidencia(
  ambienteDeclarado: AmbienteEvidenciaInstalacao | ""
): ClassificacaoAmbienteInstalacao {
  if (ambienteDeclarado === "homologacao" || ambienteDeclarado === "producao") {
    return {
      situacao: "declarado",
      ambienteEfetivo: null,
      origem: "declarada",
      deveRevogar: false,
      motivo:
        "Ambiente declarado, sem evidência de instalação controlada. O formulário não comprova homologação nem produção.",
    };
  }
  return {
    situacao: "desconhecido",
    ambienteEfetivo: null,
    origem: "ausente",
    deveRevogar: false,
    motivo:
      "A PGWebLib não informa o ambiente em execução. O valor escolhido no formulário não comprova homologação nem produção.",
  };
}

function recusar(
  ambienteDeclarado: AmbienteEvidenciaInstalacao | "",
  motivo: string,
  deveRevogar: boolean
): ClassificacaoAmbienteInstalacao {
  return { ...classificacaoSemEvidencia(ambienteDeclarado), motivo, deveRevogar };
}

export function consultarEvidenciaArmazenada(input: {
  evidencia: {
    campos: CamposEvidenciaInstalacao;
    assinatura: string;
    revogada: boolean;
  } | null;
  chavePublicaPem: string;
  empresaSessaoId: string;
  dispositivoAutorizado: string;
  terminalAutorizadoId: string;
  pontoTerminal: string;
  pontoHomologacao?: string;
  estabelecimentoTerminal: string;
  ambienteDeclarado: AmbienteEvidenciaInstalacao | "";
  evento: EventoRevogacaoEvidencia;
}): ClassificacaoAmbienteInstalacao {
  if (!input.evidencia) {
    return classificacaoSemEvidencia(input.ambienteDeclarado);
  }
  if (input.evidencia.revogada) {
    return recusar(input.ambienteDeclarado, "A evidência de instalação foi revogada.", false);
  }
  if (input.evento === "reset") {
    return recusar(
      input.ambienteDeclarado,
      "A evidência de instalação deixou de valer após o reset do ponto.",
      true
    );
  }
  if (input.evento === "reinstalacao" || input.evento === "troca_ponto") {
    return recusar(
      input.ambienteDeclarado,
      input.evento === "reinstalacao"
        ? "A evidência de instalação deixou de valer após a reinstalação."
        : "A evidência de instalação deixou de valer porque o ponto de captura mudou.",
      true
    );
  }
  if (!input.chavePublicaPem || !identificador(input.terminalAutorizadoId)) {
    return recusar(
      input.ambienteDeclarado,
      input.evidencia.campos.ambiente === "homologacao"
        ? "A chave de homologação ainda não está vinculada a esta empresa."
        : "O terminal vinculado ainda não permite conferir a evidência de instalação.",
      false
    );
  }
  const normalizada = avaliarEmissaoEvidencia({
    ...input.evidencia.campos,
    ambienteSolicitado: input.evidencia.campos.ambiente,
    pontoInstalado: input.evidencia.campos.pontoCaptura,
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
  });
  const campos = normalizada.ok ? normalizada.campos : input.evidencia.campos;
  if (
    !normalizada.ok ||
    !verificarAssinaturaEvidenciaInstalacao(
      input.chavePublicaPem,
      campos,
      input.evidencia.assinatura
    )
  ) {
    return recusar(
      input.ambienteDeclarado,
      "A evidência de instalação não confere com a chave do terminal vinculado.",
      true
    );
  }
  if (campos.empresaId !== identificador(input.empresaSessaoId)) {
    return recusar(input.ambienteDeclarado, "A evidência de instalação pertence a outra empresa.", true);
  }
  if (campos.dispositivoId !== identificador(input.dispositivoAutorizado)) {
    return recusar(
      input.ambienteDeclarado,
      "A evidência de instalação pertence a outro computador.",
      true
    );
  }
  if (campos.terminalId !== identificador(input.terminalAutorizadoId)) {
    return recusar(
      input.ambienteDeclarado,
      "A evidência de instalação não confere com o terminal autorizado.",
      true
    );
  }
  const comparaHomologacao =
    campos.ambiente === "homologacao" && input.pontoHomologacao !== undefined;
  const pontoEsperado = comparaHomologacao ? limpar(input.pontoHomologacao ?? "") : limpar(input.pontoTerminal);
  if (campos.pontoCaptura !== pontoEsperado) {
    return recusar(
      input.ambienteDeclarado,
      comparaHomologacao
        ? "A evidência de homologação não confere com o ponto de homologação da empresa."
        : "A evidência de instalação deixou de valer porque o ponto de captura mudou.",
      true
    );
  }
  if (campos.estabelecimento !== limpar(input.estabelecimentoTerminal)) {
    return recusar(
      input.ambienteDeclarado,
      "A evidência de instalação não confere com o estabelecimento.",
      true
    );
  }
  return {
    situacao: "comprovado",
    ambienteEfetivo: campos.ambiente,
    origem: "instalacao_controlada",
    deveRevogar: false,
    motivo: `Ambiente comprovado por instalação controlada: ${campos.ambiente}. A assinatura do Connector registra a observação da instalação.`,
  };
}

export function prepararRegistroEvidencia(input: {
  campos: CamposEvidenciaInstalacao;
  assinatura: string;
  chavePublicaPem: string;
  empresaSessaoId: string;
  dispositivoAutorizado: string;
  terminalAutorizadoId: string;
  pontoAutorizado: string;
  estabelecimentoAutorizado: string;
  instalacaoJaRegistrada: boolean;
  evidenciaAtivaNoDispositivo: boolean;
}):
  | { ok: false; motivo: string }
  | { ok: true; revogarAtiva: boolean; registro: RegistroEvidenciaInstalacao } {
  if (input.instalacaoJaRegistrada) {
    return { ok: false, motivo: "Esta evidência de instalação já foi registrada." };
  }
  const consulta = consultarEvidenciaArmazenada({
    evidencia: {
      campos: input.campos,
      assinatura: input.assinatura,
      revogada: false,
    },
    chavePublicaPem: input.chavePublicaPem,
    empresaSessaoId: input.empresaSessaoId,
    dispositivoAutorizado: input.dispositivoAutorizado,
    terminalAutorizadoId: input.terminalAutorizadoId,
    pontoTerminal: input.pontoAutorizado,
    pontoHomologacao: input.campos.ambiente === "homologacao" ? input.pontoAutorizado : undefined,
    estabelecimentoTerminal: input.estabelecimentoAutorizado,
    ambienteDeclarado: "",
    evento: "nenhum",
  });
  if (consulta.situacao !== "comprovado" || !consulta.ambienteEfetivo) {
    return { ok: false, motivo: consulta.motivo };
  }
  const emitida = avaliarEmissaoEvidencia({
    ...input.campos,
    ambienteSolicitado: input.campos.ambiente,
    pontoInstalado: input.campos.pontoCaptura,
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
  });
  if (!emitida.ok) {
    return { ok: false, motivo: emitida.motivo };
  }
  return {
    ok: true,
    revogarAtiva: input.evidenciaAtivaNoDispositivo,
    registro: {
      empresa_id: emitida.campos.empresaId,
      dispositivo_id: emitida.campos.dispositivoId,
      terminal_id: emitida.campos.terminalId,
      instalacao_id: emitida.campos.instalacaoId,
      ponto_captura: emitida.campos.pontoCaptura,
      estabelecimento: emitida.campos.estabelecimento,
      ambiente: consulta.ambienteEfetivo,
      origem: "instalacao_controlada",
      assinatura: input.assinatura,
    },
  };
}
