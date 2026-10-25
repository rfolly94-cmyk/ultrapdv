export type TentativaMotorConfirmada = {
  idempotencyKey: string;
  chave: string;
  valorCentavos: number;
  modalidade: "debito" | "credito";
  origem: string;
  producao: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decidirRetomadaMotor(input: {
  tentativa: TentativaMotorConfirmada | null;
  modalidade: string;
  valorCentavos: number;
  ocupado: boolean;
}) {
  if (input.ocupado) {
    return { acao: "aguardar" as const };
  }
  const tentativa = input.tentativa;
  if (!tentativa || tentativa.modalidade !== input.modalidade || tentativa.valorCentavos !== input.valorCentavos) {
    return { acao: "cobrar" as const };
  }
  if (!UUID.test(tentativa.idempotencyKey) || tentativa.chave !== `${tentativa.idempotencyKey}:${tentativa.modalidade}:${tentativa.valorCentavos}`) {
    return { acao: "cobrar" as const };
  }
  return { acao: "finalizar" as const, tentativa };
}

export function classificarAmbienteDaConclusao(input: {
  pagamentoJaConfirmado: boolean;
  producaoDaCobranca: boolean;
}) {
  if (!input.pagamentoJaConfirmado) return "pendente" as const;
  return input.producaoDaCobranca ? "producao" as const : "homologacao" as const;
}

export function decidirEmissaoAposConfirmacao(input: {
  emitirAutomatico: boolean;
  temMotor: boolean;
  supressaoLocal: boolean;
  ambienteLocal: "producao" | "homologacao" | "pendente";
  supressaoServidor: boolean;
  ambienteServidor: "producao" | "homologacao" | "";
}) {
  if (!input.emitirAutomatico) {
    return { emitir: false, avisoHomologacao: false };
  }
  if (input.temMotor) {
    if (input.ambienteServidor === "producao" && !input.supressaoServidor) {
      return { emitir: true, avisoHomologacao: false };
    }
    return { emitir: false, avisoHomologacao: input.ambienteServidor === "homologacao" || input.supressaoServidor };
  }
  if (input.ambienteLocal === "homologacao" || input.supressaoLocal) {
    return { emitir: false, avisoHomologacao: input.ambienteLocal === "homologacao" };
  }
  return { emitir: true, avisoHomologacao: false };
}

export function decidirFalhaFiscalMotor() {
  return {
    preservarPagamento: true,
    repetirCobranca: false,
    emissaoRecuperavel: true,
  };
}

export function lerTentativaMotor(storage: { getItem(chave: string): string | null }) {
  try {
    const bruto = storage.getItem("ultrapdv.tef.motor.confirmado");
    if (!bruto) return null;
    const valor = JSON.parse(bruto) as Partial<TentativaMotorConfirmada>;
    if (valor.modalidade !== "debito" && valor.modalidade !== "credito") return null;
    if (!valor.idempotencyKey || !valor.chave || !valor.origem) return null;
    return {
      idempotencyKey: valor.idempotencyKey,
      chave: valor.chave,
      valorCentavos: Number(valor.valorCentavos),
      modalidade: valor.modalidade,
      origem: valor.origem,
      producao: valor.producao === true,
    };
  } catch {
    return null;
  }
}

export function gravarTentativaMotor(
  storage: { setItem(chave: string, valor: string): void },
  tentativa: TentativaMotorConfirmada,
) {
  storage.setItem("ultrapdv.tef.motor.confirmado", JSON.stringify(tentativa));
}

export function limparTentativaMotor(storage: { removeItem(chave: string): void }) {
  storage.removeItem("ultrapdv.tef.motor.confirmado");
}
