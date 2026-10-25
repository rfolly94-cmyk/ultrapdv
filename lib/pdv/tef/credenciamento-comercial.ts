export const PROVEDOR_CREDENCIAMENTO_TEF = "PayGo";
export const ACAO_REGISTRAR_COMPROVACAO = "REGISTRAR_COMPROVACAO_COMERCIAL";

export type SituacaoCredenciamento = "nao_informado" | "informado" | "comprovado";

const SEGREDO = /senha|password|token|secret|\bpin\b|chave.?privada/i;

export function referenciaCredenciamento(valor: unknown) {
  return String(valor ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
}

export function validarIdentificacaoCredenciamento(referenciaInformada: unknown) {
  const referencia = referenciaCredenciamento(referenciaInformada);
  if (referencia.length < 3) {
    return { ok: false as const, erro: "Informe a referência comercial do credenciamento." };
  }
  if (SEGREDO.test(referencia)) {
    return { ok: false as const, erro: "A referência não pode conter senha ou segredo." };
  }
  return {
    ok: true as const,
    provedor: PROVEDOR_CREDENCIAMENTO_TEF,
    referencia,
    situacao: "informado" as const,
    comprovado: false as const,
  };
}

export function decidirRegistroComprovacao(input: {
  administrador: boolean;
  acao: unknown;
  referencia: unknown;
}) {
  if (input.administrador !== true) {
    return { ok: false as const, comprovado: false as const, erro: "Somente o administrador da empresa pode registrar a comprovação." };
  }
  if (input.acao !== ACAO_REGISTRAR_COMPROVACAO) {
    return {
      ok: false as const,
      comprovado: false as const,
      erro: "Preencher a referência não comprova o credenciamento.",
    };
  }
  const identificacao = validarIdentificacaoCredenciamento(input.referencia);
  if (!identificacao.ok) {
    return { ok: false as const, comprovado: false as const, erro: identificacao.erro };
  }
  return {
    ok: true as const,
    comprovado: true as const,
    provedor: identificacao.provedor,
    referencia: identificacao.referencia,
    situacao: "comprovado" as const,
  };
}

export function rotuloSituacaoCredenciamento(situacao: SituacaoCredenciamento) {
  if (situacao === "comprovado") return "Comprovada";
  if (situacao === "informado") return "Identificada, aguardando comprovação";
  return "Não informada";
}
