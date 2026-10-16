import { classificarFormaTef, type FormaTef, type ModalidadeTef } from "@/lib/pdv/tef/regras";

/**
 * PWINFO_CARDTYPE da PGWebLib, lido pelo ACBr em TACBrTEFResp.
 * 1 = crédito e 2 = débito. Qualquer outro valor, soma ou texto não vira modalidade.
 */
export const TPAG_CREDITO = "03";
export const TPAG_DEBITO = "04";

export const MENSAGEM_MODALIDADE_INDETERMINADA =
  "O TEF foi aprovado, mas o tipo do cartão não veio no campo oficial. A venda e a NFC-e não foram concluídas. Nenhuma nova cobrança foi iniciada.";

export function tipoCartaoOficial(valor: unknown) {
  if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0 || valor > 255) {
    return null;
  }
  return valor;
}

export function modalidadeDoTipoCartaoPayGo(valor: unknown): ModalidadeTef | null {
  const tipo = tipoCartaoOficial(valor);
  if (tipo === 1) {
    return "credito";
  }
  if (tipo === 2) {
    return "debito";
  }
  return null;
}

export function tPagDaModalidade(modalidade: ModalidadeTef) {
  return modalidade === "credito" ? TPAG_CREDITO : TPAG_DEBITO;
}

export function avisoModalidadeAutorizada(modalidade: ModalidadeTef) {
  return modalidade === "credito"
    ? "Pagamento aprovado no crédito"
    : "Pagamento aprovado no débito";
}

export function mensagemFormaAusente(modalidade: ModalidadeTef) {
  const nome = modalidade === "credito" ? "crédito" : "débito";
  const tPag = tPagDaModalidade(modalidade);
  return `O TEF autorizou o ${nome}, mas esta empresa não tem uma única forma com tPag ${tPag}. A venda não foi finalizada. Nenhuma nova cobrança foi iniciada.`;
}

export type DecisaoModalidadeOficial = {
  modalidade: ModalidadeTef;
  modalidadeSolicitada: ModalidadeTef;
  modalidadeEfetiva: ModalidadeTef | null;
  tipoCartao: number | null;
  conciliacao: boolean;
  aviso: string | null;
  motivo: string | null;
};

export function decidirModalidadeOficial(input: {
  solicitada: ModalidadeTef;
  tipoCartao: unknown;
  provaValida: boolean;
  pix: boolean;
}): DecisaoModalidadeOficial {
  const tipo = input.provaValida ? tipoCartaoOficial(input.tipoCartao) : null;
  const efetiva = modalidadeDoTipoCartaoPayGo(tipo);
  if (efetiva) {
    return {
      modalidade: efetiva,
      modalidadeSolicitada: input.solicitada,
      modalidadeEfetiva: efetiva,
      tipoCartao: tipo,
      conciliacao: false,
      aviso: efetiva === input.solicitada ? null : avisoModalidadeAutorizada(efetiva),
      motivo: null,
    };
  }
  if (input.pix) {
    return {
      modalidade: input.solicitada,
      modalidadeSolicitada: input.solicitada,
      modalidadeEfetiva: null,
      tipoCartao: tipo,
      conciliacao: false,
      aviso: null,
      motivo: null,
    };
  }
  return {
    modalidade: input.solicitada,
    modalidadeSolicitada: input.solicitada,
    modalidadeEfetiva: null,
    tipoCartao: tipo,
    conciliacao: true,
    aviso: null,
    motivo: MENSAGEM_MODALIDADE_INDETERMINADA,
  };
}

export function formaDaModalidadeEfetiva<T extends FormaTef & { id: string }>(
  formas: T[],
  modalidade: ModalidadeTef,
  formaAtualId?: string | null
) {
  const tPag = tPagDaModalidade(modalidade);
  const atual = formas.find((forma) => forma.id === formaAtualId);
  if (
    atual &&
    classificarFormaTef(atual) === modalidade &&
    String(atual.codigo_fiscal ?? "").trim() === tPag
  ) {
    return atual;
  }
  const candidatas = formas
    .filter(
      (forma) =>
        classificarFormaTef(forma) === modalidade &&
        String(forma.codigo_fiscal ?? "").trim() === tPag
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  return candidatas.length === 1 ? candidatas[0] : null;
}
