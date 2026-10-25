import { cobrancaRealBloqueada } from "@/lib/pdv/tef/motor";
import { AgenteTefFase1 } from "../../../tef-2/fase-1/maquina.mjs";
import { bloqueiaNovaOperacao } from "../../../tef-2/fase-1/journal.mjs";

const DIRETORIO_HOMOLOGACAO = "C:\\UltraPDV\\TEF\\Homologacao\\PGWeb";
const PAN = /\d{13,19}/;

export type ContextoVendaPgweb = {
  empresaId: string;
  terminalCodigo: string;
  dispositivoId: string;
};

export type PedidoVendaPgweb = {
  vendaId: string;
  valorCentavos: number;
  idempotencyKey: string;
  modalidade: "debito" | "credito";
  pinpadOcupado?: boolean;
};

export type ConciliacaoVendaPgweb = {
  reqNum: string;
  locRef: string;
  extRef: string;
  authSyst: string;
};

export type ResultadoVendaPgweb = {
  ok: boolean;
  pagamentoAprovado: boolean;
  cobrancaReal: false;
  transacaoConfirmada: boolean;
  repetida: boolean;
  situacao: string;
  codigo: string | number;
  mensagem: string;
  solicitacaoId: string;
  vendaId: string;
  valorCentavos: number;
  empresaId: string;
  terminalCodigo: string;
  modalidade: "debito" | "credito" | "";
  conciliacao: ConciliacaoVendaPgweb;
};

type RetornoAgente = {
  ok?: boolean;
  codigo?: string | number;
  estado?: string;
  situacao?: string;
  mensagem?: string;
  solicitacaoId?: string;
  repetida?: boolean;
  transacaoConfirmada?: boolean;
  confirmada?: boolean;
  vendaId?: string;
  valorCentavos?: number;
  modalidade?: string;
  reqNum?: string;
  locRef?: string;
  extRef?: string;
  authSyst?: string;
  cnfReq?: boolean;
};

type AgenteVenda = {
  journal: {
    status?: string;
    empresaId?: string;
    terminalCodigo?: string;
    vendaId?: string;
    modalidade?: string;
    valorCentavos?: number;
    reqNum?: string;
    locRef?: string;
    extRef?: string;
    authSyst?: string;
  } | null;
  biblioteca: { chamadas?: unknown[]; operacao?: number };
  inicializar(pedido: { ambiente: string; diretorio: string; dispositivoId: string }): Promise<RetornoAgente>;
  transacionar(pedido: Record<string, unknown>): Promise<RetornoAgente>;
  responder(pedido: Record<string, unknown>): Promise<RetornoAgente>;
  confirmar(pedido: Record<string, unknown>): Promise<RetornoAgente>;
  desfazer(pedido: Record<string, unknown>): Promise<RetornoAgente>;
};

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function conciliacaoVazia(): ConciliacaoVendaPgweb {
  return { reqNum: "", locRef: "", extRef: "", authSyst: "" };
}

function conciliacaoDe(origem: {
  reqNum?: string;
  locRef?: string;
  extRef?: string;
  authSyst?: string;
} | null | undefined): ConciliacaoVendaPgweb {
  return {
    reqNum: texto(origem?.reqNum),
    locRef: texto(origem?.locRef),
    extRef: texto(origem?.extRef),
    authSyst: texto(origem?.authSyst),
  };
}

export function mensagemPagamentoPdv(resultado: Pick<ResultadoVendaPgweb, "situacao" | "codigo" | "transacaoConfirmada" | "repetida" | "mensagem">) {
  if (resultado.repetida) {
    return "Esta venda já foi processada. Nenhuma nova cobrança foi iniciada.";
  }
  if (resultado.transacaoConfirmada || resultado.situacao === "confirmada") {
    return "A transação simulada foi confirmada. O pagamento não foi aprovado no PDV porque o motor definitivo permanece bloqueado.";
  }
  if (resultado.situacao === "autorizada") {
    return "A transação foi autorizada e ainda não foi confirmada. O pagamento não está aprovado.";
  }
  if (resultado.situacao === "recusada") return "A venda foi recusada. O pagamento não está aprovado.";
  if (resultado.situacao === "cancelada") return "O operador cancelou a captura. O pagamento não está aprovado.";
  if (resultado.situacao === "falha_comunicacao") {
    return "A comunicação com o PinPad falhou. O pagamento não está aprovado.";
  }
  if (resultado.situacao === "desfeita") return "A transação autorizada foi desfeita. O pagamento não está aprovado.";
  if (resultado.situacao === "pendente" || resultado.codigo === "PENDENTE") {
    return "Há transação pendente neste terminal. Nenhuma nova venda foi iniciada.";
  }
  if (resultado.codigo === "EMPRESA_DIVERGENTE") {
    return "A transação pendente pertence a outra empresa. Nenhuma operação foi executada.";
  }
  if (resultado.codigo === "TERMINAL_DIVERGENTE") {
    return "A transação pendente pertence a outro terminal. Nenhuma operação foi executada.";
  }
  if (resultado.codigo === "PINPAD_OCUPADO" || resultado.situacao === "pinpad_ocupado") {
    return "O PinPad está ocupado. A venda não foi iniciada.";
  }
  if (resultado.codigo === "OCUPADO") {
    return "A venda já está em andamento. A segunda solicitação não iniciou outra transação.";
  }
  if (resultado.situacao === "aguardando_captura" || resultado.situacao === "aguardando_pinpad") {
    return "O PayGo pediu um dado. O pagamento não está aprovado.";
  }
  return "O pagamento não está aprovado.";
}

export function aceiteNaFinalizacao(resultado: ResultadoVendaPgweb) {
  if (cobrancaRealBloqueada() || resultado.pagamentoAprovado !== true || !resultado.transacaoConfirmada) {
    return null;
  }
  return {
    vendaId: resultado.vendaId,
    valorCentavos: resultado.valorCentavos,
    empresaId: resultado.empresaId,
    terminalCodigo: resultado.terminalCodigo,
    conciliacao: resultado.conciliacao,
  };
}

function situacaoDe(bruto: RetornoAgente) {
  if (bruto.situacao) return bruto.situacao;
  if (bruto.codigo === "PENDENTE") return "pendente";
  if (bruto.codigo === "OCUPADO") return "ocupada";
  if (bruto.codigo === "PINPAD_OCUPADO") return "pinpad_ocupado";
  if (bruto.codigo === "EMPRESA_DIVERGENTE" || bruto.codigo === "TERMINAL_DIVERGENTE") return "isolada";
  if (bruto.transacaoConfirmada === true || bruto.confirmada === true) return "confirmada";
  if (bruto.estado === "aguardando_confirmacao" || bruto.cnfReq === true) return "autorizada";
  if (bruto.estado === "aguardando_captura" || bruto.estado === "aguardando_pinpad") return bruto.estado;
  return bruto.ok === true ? "ociosa" : "falha";
}

export class VendaPgwebPdv {
  private readonly agente: AgenteVenda;
  private readonly autorizado: ContextoVendaPgweb;
  private readonly diretorio: string;

  constructor(input: {
    autorizado: ContextoVendaPgweb;
    biblioteca: { real?: boolean };
    arquivo?: string;
    diretorio?: string;
  }) {
    this.autorizado = {
      empresaId: texto(input.autorizado.empresaId),
      terminalCodigo: texto(input.autorizado.terminalCodigo),
      dispositivoId: texto(input.autorizado.dispositivoId),
    };
    this.diretorio = texto(input.diretorio) || DIRETORIO_HOMOLOGACAO;
    this.agente = new AgenteTefFase1({
      biblioteca: input.biblioteca,
      arquivo: input.arquivo,
      dispositivoId: this.autorizado.dispositivoId,
    }) as unknown as AgenteVenda;
  }

  private pedidoAgente(pedido: PedidoVendaPgweb) {
    return {
      dispositivoId: this.autorizado.dispositivoId,
      empresaId: this.autorizado.empresaId,
      terminalCodigo: this.autorizado.terminalCodigo,
      identificador: texto(pedido.vendaId),
      vendaId: texto(pedido.vendaId),
      valorCentavos: pedido.valorCentavos,
      idempotencyKey: texto(pedido.idempotencyKey),
      modalidade: pedido.modalidade,
      moeda: "986",
      expoente: "2",
      pinpadOcupado: pedido.pinpadOcupado === true,
    };
  }

  private publicar(bruto: RetornoAgente, pedido?: PedidoVendaPgweb): ResultadoVendaPgweb {
    const isolada = bruto.codigo === "EMPRESA_DIVERGENTE" || bruto.codigo === "TERMINAL_DIVERGENTE";
    const situacao = situacaoDe(bruto);
    const transacaoConfirmada = situacao === "confirmada" || bruto.transacaoConfirmada === true;
    const divulgavel = !isolada && situacao !== "pinpad_ocupado" && situacao !== "ocupada";
    const resultado: ResultadoVendaPgweb = {
      ok: bruto.ok === true,
      pagamentoAprovado: false,
      cobrancaReal: false,
      transacaoConfirmada,
      repetida: bruto.repetida === true,
      situacao,
      codigo: bruto.codigo ?? "",
      mensagem: "",
      solicitacaoId: texto(bruto.solicitacaoId),
      vendaId: isolada ? "" : texto(bruto.vendaId) || texto(pedido?.vendaId),
      valorCentavos: isolada
        ? 0
        : typeof bruto.valorCentavos === "number" &&
            Number.isInteger(bruto.valorCentavos) &&
            bruto.valorCentavos > 0
          ? bruto.valorCentavos
          : pedido?.valorCentavos ?? 0,
      empresaId: this.autorizado.empresaId,
      terminalCodigo: this.autorizado.terminalCodigo,
      modalidade:
        bruto.modalidade === "credito" || bruto.modalidade === "debito"
          ? bruto.modalidade
          : pedido?.modalidade === "credito" || pedido?.modalidade === "debito"
            ? pedido.modalidade
            : "",
      conciliacao: divulgavel ? conciliacaoDe(bruto) : conciliacaoVazia(),
    };
    resultado.mensagem = mensagemPagamentoPdv(resultado);
    if (PAN.test(JSON.stringify(resultado))) {
      throw new Error("Resultado TEF tentou expor dado de cartão.");
    }
    return resultado;
  }

  async iniciar() {
    const inicio = await this.agente.inicializar({
      ambiente: "homologacao",
      diretorio: this.diretorio,
      dispositivoId: this.autorizado.dispositivoId,
    });
    if (inicio.ok !== true) return this.publicar(inicio);
    return this.consultar();
  }

  consultar() {
    const journal = this.agente.journal;
    if (!journal || !bloqueiaNovaOperacao(journal)) {
      return this.publicar({ ok: true, codigo: "PWRET_OK", situacao: "ociosa", estado: "ociosa" });
    }
    if (journal.empresaId && journal.empresaId !== this.autorizado.empresaId) {
      return this.publicar({ ok: false, codigo: "EMPRESA_DIVERGENTE", situacao: "isolada" });
    }
    if (journal.terminalCodigo && journal.terminalCodigo !== this.autorizado.terminalCodigo) {
      return this.publicar({ ok: false, codigo: "TERMINAL_DIVERGENTE", situacao: "isolada" });
    }
    return this.publicar({
      ok: true,
      codigo: "PENDENTE",
      situacao: journal.status === "aguardando_confirmacao" ? "pendente" : journal.status,
      vendaId: journal.vendaId,
      valorCentavos: journal.valorCentavos,
      modalidade: journal.modalidade,
      reqNum: journal.reqNum,
      locRef: journal.locRef,
      extRef: journal.extRef,
      authSyst: journal.authSyst,
    });
  }

  async vender(pedido: PedidoVendaPgweb) {
    return this.publicar(await this.agente.transacionar(this.pedidoAgente(pedido)), pedido);
  }

  async responder(pedido: { solicitacaoId: string; indice?: number; valor?: string; cancelar?: boolean }) {
    const bruto = await this.agente.responder({
      dispositivoId: this.autorizado.dispositivoId,
      empresaId: this.autorizado.empresaId,
      terminalCodigo: this.autorizado.terminalCodigo,
      solicitacaoId: pedido.solicitacaoId,
      indice: pedido.indice,
      valor: pedido.valor,
      cancelar: pedido.cancelar === true,
    });
    return this.publicar(bruto);
  }

  async confirmar() {
    const bruto = await this.agente.confirmar({
      dispositivoId: this.autorizado.dispositivoId,
      empresaId: this.autorizado.empresaId,
      terminalCodigo: this.autorizado.terminalCodigo,
      motivo: "manual",
    });
    return this.publicar(bruto);
  }

  async desfazer(motivo: "desfazer_manual" | "queda" | "comunicacao" | "aborto" | "fiscal" = "desfazer_manual") {
    const bruto = await this.agente.desfazer({
      dispositivoId: this.autorizado.dispositivoId,
      empresaId: this.autorizado.empresaId,
      terminalCodigo: this.autorizado.terminalCodigo,
      motivo,
    });
    return this.publicar(bruto);
  }
}
