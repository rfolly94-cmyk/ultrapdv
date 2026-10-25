import { contratoNativoAtual } from "@/lib/pdv/tef/contrato-nativo";
import { contratoOficialAtual } from "@/lib/pdv/tef/contrato-oficial";
import { PGWEB2_PRODUCAO } from "@/lib/pdv/tef/motor";

export const ESTADOS_CONCLUSAO_TEF = [
  "aguardando",
  "autorizada_para_execucao",
  "executando",
  "aguardando_confirmacao",
  "confirmada",
  "recusada",
  "cancelada",
  "resultado_desconhecido",
] as const;

export type EstadoConclusaoTef = (typeof ESTADOS_CONCLUSAO_TEF)[number];

export type EvidenciaExecucaoTef = {
  abi: boolean;
  layout: boolean;
  producaoLiberada: boolean;
  abortComprovado: boolean;
  eventoComprovado: boolean;
  confirmacaoComprovada: boolean;
  esperaConfirmacaoComprovada: boolean;
};

export type AmbienteTefServidor = "" | "homologacao" | "producao";

const ESTADOS_QUE_IMPEDIR_FECHAR = new Set<EstadoConclusaoTef>([
  "autorizada_para_execucao",
  "executando",
  "aguardando_confirmacao",
]);

const RETORNO_OK = 0;
const RETORNO_TIMEOUT = -2490;
const RETORNO_CANCEL = -2491;
const RETORNO_PPCOMERR = -2484;
const RETORNO_FROMHOST = -2596;

export function evidenciaAtual(): EvidenciaExecucaoTef {
  const contrato = contratoNativoAtual();
  const oficial = contratoOficialAtual();
  return {
    abi: oficial.ok,
    layout: oficial.layout,
    producaoLiberada: PGWEB2_PRODUCAO,
    abortComprovado: contrato.abort,
    eventoComprovado: contrato.evento,
    confirmacaoComprovada: contrato.confirmacao,
    esperaConfirmacaoComprovada: contrato.espera,
  };
}

export function posidDoAmbiente(ambiente: AmbienteTefServidor) {
  if (ambiente === "homologacao") return "ponto_homologacao" as const;
  if (ambiente === "producao") return "ponto_captura" as const;
  return "" as const;
}

export function requisitosPendentes(input: {
  ambiente: AmbienteTefServidor;
  evidencia?: EvidenciaExecucaoTef;
}) {
  const evidencia = input.evidencia ?? evidenciaAtual();
  const pendencias: string[] = [];
  if (input.ambiente !== "homologacao" && input.ambiente !== "producao") {
    pendencias.push("O ambiente TEF não está definido em Configurações, Financeiro, TEF. Nenhuma cobrança foi iniciada.");
  }
  if (!evidencia.abi || !evidencia.layout) {
    pendencias.push(
      "O contrato Windows x64 da PGWebLib não confere com PGWebLib.h. PWL_Type.h não é exigido. Nenhuma cobrança foi iniciada."
    );
  }
  if (!evidencia.abortComprovado || !evidencia.eventoComprovado) {
    pendencias.push("O contrato de PW_iPPAbort ou PW_iPPEventLoop diverge do PGWebLib.h. Nenhuma cobrança foi iniciada.");
  }
  if (!evidencia.confirmacaoComprovada || !evidencia.esperaConfirmacaoComprovada) {
    pendencias.push("O contrato de PW_iConfirmation ou PW_iWaitConfirmation diverge do PGWebLib.h. Nenhuma cobrança foi iniciada.");
  }
  if (input.ambiente === "producao" && !evidencia.producaoLiberada) {
    pendencias.push(
      "A produção só cobra com o ponto de captura instalado e a confirmação financeira. Nenhuma cobrança foi iniciada."
    );
  }
  return pendencias;
}

export function avaliarConclusaoTefF2(input: {
  ambiente: AmbienteTefServidor;
  evidencia?: EvidenciaExecucaoTef;
}) {
  const requisitos = requisitosPendentes(input);
  if (requisitos.length === 0) {
    return {
      podeCobrar: true as const,
      requisitos,
      mensagem: "",
      cartaoManual: false as const,
    };
  }
  return {
    podeCobrar: false as const,
    requisitos,
    mensagem: `${requisitos.join("\n")}\nNenhuma cobrança foi iniciada. O cartão manual não foi acionado.`,
    cartaoManual: false as const,
  };
}

export function liberacaoConformeDocumentacao(ambiente: "" | "homologacao" | "producao") {
  void ambiente;
  return {
    cobrancaRealBloqueada: true,
    ativacaoExplicita: false,
  };
}

export function impedeFechamentoPagamento(estado: EstadoConclusaoTef | "") {
  return ESTADOS_QUE_IMPEDIR_FECHAR.has(estado as EstadoConclusaoTef);
}

export function ambienteServidor(input: {
  servidor: AmbienteTefServidor;
  navegador?: string;
}) {
  const navegador = String(input.navegador ?? "").trim();
  if (navegador && navegador !== input.servidor) {
    return {
      ok: false as const,
      ambiente: input.servidor,
      mensagem: "O ambiente é o definido em Configurações, Financeiro, TEF. O navegador não escolhe o ambiente.",
    };
  }
  return { ok: true as const, ambiente: input.servidor, mensagem: "" };
}

export type ParcelaConclusaoTef = {
  formaPagamentoId: string;
  modalidade: "debito" | "credito" | null;
  valorCentavos: number;
  idempotencyKey: string;
  parcelasCredito?: number;
  operacaoManual?: boolean;
};

export type ReferenciasTef = {
  reqNum: string;
  locRef: string;
  extRef: string;
  virtMerch: string;
  authSyst: string;
};

export type RegistroConclusaoTef = {
  estado: EstadoConclusaoTef;
  ambiente: "homologacao" | "producao";
  idempotencyKey: string;
  valorCentavos: number;
  modalidade: "debito" | "credito";
  referencias: ReferenciasTef;
  pagamentoRecebido: boolean;
  simulado: boolean;
  journalApagado: false;
};

export type TransporteConclusaoTef = {
  simulado: boolean;
  newTransac: () => Promise<number>;
  addParam: (info: number, valor: string) => Promise<number>;
  execTransac: () => Promise<{
    codigo: number;
    instrucao?: string;
    menu?: string[];
    pinpad?: boolean;
    recusaComprovada?: boolean;
  }>;
  ppAbort: () => Promise<number>;
  ppEventLoop: () => Promise<{ codigo: number }>;
  getResult: (info: number) => Promise<{ valor: string }>;
  confirmation: (refs: ReferenciasTef) => Promise<number>;
  waitConfirmation: () => Promise<number>;
};

type MemoriaConclusao = Map<string, RegistroConclusaoTef>;

function referenciasVazias(): ReferenciasTef {
  return { reqNum: "", locRef: "", extRef: "", virtMerch: "", authSyst: "" };
}

function referenciasCompletas(refs: ReferenciasTef) {
  return [refs.reqNum, refs.locRef, refs.extRef, refs.virtMerch, refs.authSyst].every((item) => item.trim());
}

function chaveMemoria(empresaId: string, idempotencyKey: string) {
  return `${empresaId}|${idempotencyKey}`;
}

export function decidirFiscalAposTef(input: {
  ambiente: "homologacao" | "producao";
  estado: EstadoConclusaoTef;
  pagamentoRecebido: boolean;
  simulado: boolean;
  fiscalFalhou?: boolean;
}) {
  const parado = {
    registrarPagamento: false,
    emitirNfce: false,
    baixarEstoque: false,
    concluirVenda: false,
    preservarRecuperacao: false,
    cobrarDeNovo: false,
  };
  if (input.estado !== "confirmada" || input.pagamentoRecebido !== true || input.simulado) {
    return parado;
  }
  if (input.ambiente === "homologacao") {
    return { ...parado, preservarRecuperacao: true };
  }
  if (input.fiscalFalhou) {
    return {
      registrarPagamento: true,
      emitirNfce: false,
      baixarEstoque: true,
      concluirVenda: true,
      preservarRecuperacao: true,
      cobrarDeNovo: false,
    };
  }
  return {
    registrarPagamento: true,
    emitirNfce: true,
    baixarEstoque: true,
    concluirVenda: true,
    preservarRecuperacao: false,
    cobrarDeNovo: false,
  };
}

export async function concluirParcelasTef(
  input: {
    empresaId: string;
    ambienteServidor: "homologacao" | "producao" | "";
    ambienteNavegador?: string;
    evidencia?: EvidenciaExecucaoTef;
    parcelas: ParcelaConclusaoTef[];
    transporte: TransporteConclusaoTef;
    memoria?: MemoriaConclusao;
    cancelar?: boolean;
    fiscal?: () => Promise<{ ok: boolean }>;
  }
) {
  const memoria = input.memoria ?? new Map<string, RegistroConclusaoTef>();
  const ambiente = ambienteServidor({
    servidor: input.ambienteServidor,
    navegador: input.ambienteNavegador,
  });
  if (!ambiente.ok || (ambiente.ambiente !== "homologacao" && ambiente.ambiente !== "producao")) {
    return {
      ok: false as const,
      estado: "aguardando" as const,
      pagamentoRecebido: false,
      podeFinalizar: false,
      cartaoManual: false,
      comandoEnviado: false,
      cobrarDeNovo: false,
      mensagem: ambiente.mensagem || "O ambiente TEF não está definido. Nenhuma cobrança foi iniciada.",
      instrucoes: [] as string[],
      operacoes: [] as RegistroConclusaoTef[],
      fiscal: decidirFiscalAposTef({
        ambiente: "homologacao",
        estado: "aguardando",
        pagamentoRecebido: false,
        simulado: true,
      }),
    };
  }
  const avaliacao = avaliarConclusaoTefF2({
    ambiente: ambiente.ambiente,
    evidencia: input.evidencia,
  });
  if (!avaliacao.podeCobrar) {
    return {
      ok: false as const,
      estado: "aguardando" as const,
      pagamentoRecebido: false,
      podeFinalizar: false,
      cartaoManual: false,
      comandoEnviado: false,
      cobrarDeNovo: false,
      mensagem: avaliacao.mensagem,
      instrucoes: avaliacao.requisitos,
      operacoes: [] as RegistroConclusaoTef[],
      fiscal: decidirFiscalAposTef({
        ambiente: ambiente.ambiente,
        estado: "aguardando",
        pagamentoRecebido: false,
        simulado: input.transporte.simulado,
      }),
    };
  }

  const instrucoes: string[] = [];
  const operacoes: RegistroConclusaoTef[] = [];
  const tef = input.parcelas.filter(
    (parcela) =>
      (parcela.modalidade === "debito" || parcela.modalidade === "credito") &&
      parcela.operacaoManual !== true &&
      parcela.valorCentavos > 0
  );

  for (const parcela of tef) {
    const id = chaveMemoria(input.empresaId, parcela.idempotencyKey);
    const existente = memoria.get(id);
    if (memoria.get(`${input.empresaId}|ocupada`)) {
      return respostaParada(ambiente.ambiente, input.transporte.simulado, operacoes, instrucoes, "executando", "O F2 já está concluindo esta venda. A repetição não iniciou outra cobrança.");
    }
    if (existente && existente.ambiente !== ambiente.ambiente) {
      return respostaParada(ambiente.ambiente, input.transporte.simulado, operacoes, instrucoes, existente.estado, "A operação já iniciada permanece no ambiente original. Nenhuma cobrança nova foi iniciada.");
    }
    if (existente?.estado === "confirmada") {
      operacoes.push(existente);
      continue;
    }
    if (existente?.estado === "resultado_desconhecido" || existente?.estado === "aguardando_confirmacao" || existente?.estado === "executando") {
      return respostaParada(
        ambiente.ambiente,
        input.transporte.simulado,
        operacoes,
        instrucoes,
        existente.estado,
        "Há operação TEF pendente nesta chave. Nenhuma nova cobrança foi iniciada."
      );
    }
    memoria.set(`${input.empresaId}|ocupada`, {
      estado: "executando",
      ambiente: ambiente.ambiente,
      idempotencyKey: parcela.idempotencyKey,
      valorCentavos: parcela.valorCentavos,
      modalidade: parcela.modalidade as "debito" | "credito",
      referencias: referenciasVazias(),
      pagamentoRecebido: false,
      simulado: input.transporte.simulado,
      journalApagado: false,
    });
    const registro: RegistroConclusaoTef = {
      estado: "autorizada_para_execucao",
      ambiente: ambiente.ambiente,
      idempotencyKey: parcela.idempotencyKey,
      valorCentavos: parcela.valorCentavos,
      modalidade: parcela.modalidade as "debito" | "credito",
      referencias: referenciasVazias(),
      pagamentoRecebido: false,
      simulado: input.transporte.simulado,
      journalApagado: false,
    };
    memoria.set(id, registro);
    try {
      registro.estado = "executando";
      const inicio = await input.transporte.newTransac();
      if (inicio !== RETORNO_OK) {
        registro.estado = "recusada";
        operacoes.push(registro);
        memoria.delete(`${input.empresaId}|ocupada`);
        continue;
      }
      await input.transporte.addParam(0x23, String(parcela.valorCentavos));
      if (parcela.modalidade === "credito" && parcela.parcelasCredito && parcela.parcelasCredito > 1) {
        await input.transporte.addParam(0x24, String(parcela.parcelasCredito));
      }
      if (input.cancelar) {
        const abortado = await input.transporte.ppAbort();
        const evento = await input.transporte.ppEventLoop();
        registro.estado = abortado === RETORNO_OK && evento.codigo === RETORNO_CANCEL ? "cancelada" : "resultado_desconhecido";
        operacoes.push(registro);
        memoria.delete(`${input.empresaId}|ocupada`);
        continue;
      }
      const execucao = await input.transporte.execTransac();
      if (execucao.instrucao) instrucoes.push(execucao.instrucao);
      if (execucao.menu?.length) instrucoes.push(execucao.menu.join(" | "));
      if (
        execucao.codigo === RETORNO_TIMEOUT ||
        execucao.codigo === RETORNO_PPCOMERR ||
        (execucao.codigo === RETORNO_FROMHOST && execucao.recusaComprovada !== true)
      ) {
        registro.estado = "resultado_desconhecido";
        operacoes.push(registro);
        memoria.delete(`${input.empresaId}|ocupada`);
        return respostaParada(ambiente.ambiente, input.transporte.simulado, operacoes, instrucoes, registro.estado, "O resultado financeiro é desconhecido. A venda não foi concluída e o journal foi preservado.");
      }
      if (execucao.codigo === RETORNO_CANCEL) {
        registro.estado = "cancelada";
        operacoes.push(registro);
        memoria.delete(`${input.empresaId}|ocupada`);
        continue;
      }
      if (execucao.codigo !== RETORNO_OK) {
        registro.estado = "recusada";
        operacoes.push(registro);
        memoria.delete(`${input.empresaId}|ocupada`);
        continue;
      }
      registro.referencias = {
        reqNum: (await input.transporte.getResult(0x32)).valor,
        locRef: (await input.transporte.getResult(0x44)).valor,
        extRef: (await input.transporte.getResult(0x45)).valor,
        virtMerch: (await input.transporte.getResult(0x36)).valor,
        authSyst: (await input.transporte.getResult(0x35)).valor,
      };
      if (!referenciasCompletas(registro.referencias)) {
        registro.estado = "resultado_desconhecido";
        operacoes.push(registro);
        memoria.delete(`${input.empresaId}|ocupada`);
        return respostaParada(ambiente.ambiente, input.transporte.simulado, operacoes, instrucoes, registro.estado, "A aprovação não trouxe as referências da confirmação. Nenhum pagamento foi recebido.");
      }
      registro.estado = "aguardando_confirmacao";
      const confirmacao = await input.transporte.confirmation(registro.referencias);
      const espera = confirmacao === RETORNO_OK ? await input.transporte.waitConfirmation() : RETORNO_TIMEOUT;
      if (confirmacao !== RETORNO_OK || espera !== RETORNO_OK) {
        registro.estado = "resultado_desconhecido";
        registro.pagamentoRecebido = false;
        operacoes.push(registro);
        memoria.delete(`${input.empresaId}|ocupada`);
        return respostaParada(ambiente.ambiente, input.transporte.simulado, operacoes, instrucoes, registro.estado, "A confirmação financeira falhou. O pagamento não foi marcado e o journal foi preservado.");
      }
      registro.estado = "confirmada";
      registro.pagamentoRecebido = !input.transporte.simulado && ambiente.ambiente === "producao";
      operacoes.push(registro);
      memoria.delete(`${input.empresaId}|ocupada`);
    } catch {
      registro.estado = "resultado_desconhecido";
      registro.pagamentoRecebido = false;
      operacoes.push(registro);
      memoria.delete(`${input.empresaId}|ocupada`);
      return respostaParada(ambiente.ambiente, input.transporte.simulado, operacoes, instrucoes, registro.estado, "A comunicação com o Connector caiu. A venda não foi concluída e o journal foi preservado.");
    }
  }

  const recebidas = operacoes.filter((item) => item.pagamentoRecebido && item.estado === "confirmada");
  const fiscalBase = decidirFiscalAposTef({
    ambiente: ambiente.ambiente,
    estado: recebidas.length === tef.length && tef.length > 0 ? "confirmada" : operacoes.at(-1)?.estado ?? "aguardando",
    pagamentoRecebido: recebidas.length === tef.length && tef.length > 0,
    simulado: input.transporte.simulado,
  });
  let fiscal = fiscalBase;
  if (fiscalBase.concluirVenda && input.fiscal) {
    try {
      const nota = await input.fiscal();
      if (!nota.ok) {
        fiscal = decidirFiscalAposTef({
          ambiente: ambiente.ambiente,
          estado: "confirmada",
          pagamentoRecebido: true,
          simulado: false,
          fiscalFalhou: true,
        });
      }
    } catch {
      fiscal = decidirFiscalAposTef({
        ambiente: ambiente.ambiente,
        estado: "confirmada",
        pagamentoRecebido: true,
        simulado: false,
        fiscalFalhou: true,
      });
    }
  }
  const estado = operacoes.at(-1)?.estado ?? "aguardando";
  return {
    ok: fiscal.concluirVenda || (ambiente.ambiente === "homologacao" && operacoes.every((item) => item.estado === "confirmada") && operacoes.length === tef.length),
    estado,
    pagamentoRecebido: recebidas.length === tef.length && tef.length > 0 && !input.transporte.simulado,
    podeFinalizar: fiscal.concluirVenda,
    cartaoManual: false,
    comandoEnviado: operacoes.length > 0,
    cobrarDeNovo: false,
    mensagem: mensagemDoEstado(estado, input.transporte.simulado, ambiente.ambiente),
    instrucoes,
    operacoes,
    fiscal,
    posid: posidDoAmbiente(ambiente.ambiente),
  };
}

function mensagemDoEstado(estado: EstadoConclusaoTef, simulado: boolean, ambiente: "homologacao" | "producao") {
  if (estado === "confirmada" && simulado) {
    return "A transação simulada foi confirmada. Ela não foi registrada como pagamento comercial.";
  }
  if (estado === "confirmada" && ambiente === "homologacao") {
    return "A transação de homologação foi confirmada. A NFC-e comercial não foi emitida.";
  }
  if (estado === "confirmada") return "O pagamento TEF foi confirmado.";
  if (estado === "recusada") return "A transação foi recusada. Nenhum pagamento foi recebido.";
  if (estado === "cancelada") return "A transação foi cancelada no PinPad. Nenhum pagamento foi recebido.";
  if (estado === "resultado_desconhecido") return "O resultado financeiro é desconhecido. A venda não foi concluída.";
  if (estado === "aguardando_confirmacao") return "A transação foi aprovada e ainda aguarda confirmação. Nenhum pagamento foi recebido.";
  return "A conclusão TEF não registrou pagamento.";
}

function respostaParada(
  ambiente: "homologacao" | "producao",
  simulado: boolean,
  operacoes: RegistroConclusaoTef[],
  instrucoes: string[],
  estado: EstadoConclusaoTef,
  mensagem: string
) {
  return {
    ok: false as const,
    estado,
    pagamentoRecebido: false,
    podeFinalizar: false,
    cartaoManual: false as const,
    comandoEnviado: operacoes.some((item) => item.estado !== "aguardando"),
    cobrarDeNovo: false as const,
    mensagem,
    instrucoes,
    operacoes,
    fiscal: decidirFiscalAposTef({
      ambiente,
      estado,
      pagamentoRecebido: false,
      simulado,
    }),
    posid: posidDoAmbiente(ambiente),
  };
}
