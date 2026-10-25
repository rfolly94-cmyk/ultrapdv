import type {
  EtapaFinalizacao,
  MedidorFinalizacao,
} from "@/lib/pdv/desempenho/cronometro-finalizacao";

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type ParcelaTefCliente = {
  formaPagamentoId: string;
  modalidade: "debito" | "credito" | "pix";
  valorCentavos: number;
};

export type CobrancaTefPronta = {
  formaPagamentoId: string;
  operacaoId: string;
  valorCentavos: number;
  identificador: string;
  empresaId: string;
  terminalCodigo: string;
  desafio: string;
  vinculoSegredo: string;
  autorizacao: string;
  estabelecimento?: string;
  modalidadeSolicitada?: "debito" | "credito" | null;
  modalidadeEfetiva?: "debito" | "credito" | null;
  avisoModalidade?: string | null;
};

function cabecalhosTef(operacao: {
  empresaId?: string;
  terminalCodigo?: string;
  desafio?: string;
  identificador?: string;
  valorCentavos?: number;
  autorizacao?: string;
  estabelecimento?: string;
}) {
  return {
    "Content-Type": "application/json",
    "x-ultrapdv-empresa": operacao.empresaId ?? "",
    "x-ultrapdv-terminal": operacao.terminalCodigo ?? "",
    "x-ultrapdv-desafio": operacao.desafio ?? "",
    "x-ultrapdv-identificador": operacao.identificador ?? "",
    "x-ultrapdv-valor-centavos":
      operacao.valorCentavos === undefined ? "" : String(operacao.valorCentavos),
    "x-ultrapdv-autorizacao": operacao.autorizacao ?? "",
    "x-ultrapdv-estabelecimento": operacao.estabelecimento ?? "",
  };
}

type InicioTef = {
  ok?: boolean;
  erro?: string;
  operacaoId?: string;
  identificador?: string;
  valor?: number;
  terminalCodigo?: string;
  empresaId?: string;
  dispositivoId?: string;
  parear?: boolean;
  jaAutorizada?: boolean;
  emAndamento?: boolean;
  repetida?: boolean;
  recuperada?: boolean;
  cobrarDeNovo?: boolean;
  diagnostico?: string;
  modalidadeSolicitada?: "debito" | "credito" | null;
  modalidadeEfetiva?: "debito" | "credito" | null;
  avisoModalidade?: string;
  status?: string;
  desafio?: string;
  vinculoSegredo?: string;
};

function mensagemOperacaoExistente(criado: InicioTef) {
  const efetiva =
    criado.modalidadeEfetiva === "credito"
      ? "crédito"
      : criado.modalidadeEfetiva === "debito"
        ? "débito"
        : "";
  const diagnostico = texto(criado.diagnostico);
  const base =
    diagnostico ||
    "Já existe autorização TEF nesta venda. Nenhuma nova cobrança foi iniciada.";
  return efetiva ? `${base} Modalidade autorizada: ${efetiva}. Situação: ${texto(criado.status) || "pendente"}.` : base;
}

type ResultadoApi = {
  ok?: boolean;
  erro?: string;
  status?: string;
  teste?: boolean;
  diagnostico?: string;
  proibirDesfazimento?: boolean;
  confirmar?: boolean;
  executar?: "desfazer" | "confirmar" | "nenhum";
  modalidadeSolicitada?: "debito" | "credito" | null;
  modalidadeEfetiva?: "debito" | "credito" | null;
  avisoModalidade?: string;
  rede?: string;
  nsu?: string;
  finalizacao?: string;
  autorizacao?: string;
  identificador?: string;
  valorCentavos?: number;
  desafio?: string;
};

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

async function medirCliente<T>(
  medicao: MedidorFinalizacao | null | undefined,
  etapa: EtapaFinalizacao,
  trabalho: () => Promise<T>
) {
  if (!medicao) {
    return trabalho();
  }
  return medicao.medir(etapa, "tef", trabalho);
}

async function lerJson(resposta: { json: () => Promise<unknown> }) {
  try {
    return (await resposta.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const COBRANCA_TEF_DESATIVADA =
  "A cobrança TEF foi desativada. Nenhuma cobrança PayGoWeb foi iniciada. O histórico financeiro permanece.";

export async function executarCobrancasTef(
  input: {
    parcelas: ParcelaTefCliente[];
    origem: string;
    dispositivoId: string;
    idempotencyKey: (indice: number) => string;
    grupoVenda?: string;
    estabelecimento?: string;
    ambiente?: "homologacao" | "producao" | "";
    medicao?: MedidorFinalizacao | null;
  },
  deps: { fetchImpl?: FetchLike } = {}
) {
  void input;
  void deps;
  return {
    ok: false as const,
    erro: COBRANCA_TEF_DESATIVADA,
    operacoes: [] as CobrancaTefPronta[],
    pagamentoRecebido: false as const,
    podeFinalizar: false as const,
    simulado: false as const,
    comandoEnviado: false as const,
    estados: [] as string[],
  };
}


export async function confirmarTefAposVenda(
  input: {
    vendaId: string;
    operacoes: CobrancaTefPronta[];
    origem: string;
    medicao?: MedidorFinalizacao | null;
  },
  deps: { fetchImpl?: FetchLike } = {}
) {
  void input;
  void deps;
  return { ok: false as const, erro: COBRANCA_TEF_DESATIVADA };
}


export async function desfazerCobrancasTef(
  input: {
    operacoes: CobrancaTefPronta[];
    origem: string;
    idempotencyKeyVenda: string | null;
    proibirConfirmacao?: boolean;
    medicao?: MedidorFinalizacao | null;
  },
  deps: { fetchImpl?: FetchLike } = {}
): Promise<{ desfez: number }> {
  void input;
  void deps;
  return { desfez: 0 };
}

export async function reenviarProvaLocal(
  input: {
    origem: string;
    empresaId: string;
    terminalCodigo: string;
    estabelecimento?: string;
    pendencias: Array<{ id: string; identificador?: string; status?: string }>;
  },
  deps: { fetchImpl?: FetchLike } = {}
) {
  void input;
  void deps;
  return { ok: true as const, reenviadas: 0 };
}


export async function executarVendaPinpad(
  input: {
    parcelas: ParcelaTefCliente[];
    dispositivoId: string;
    origem: string;
    idempotencyKey: (indice: number) => string;
    buscar?: FetchLike;
  }
) {
  void input;
  return {
    ok: false as boolean,
    comandoEnviado: false as boolean,
    pagamentoRecebido: false as boolean,
    erro: COBRANCA_TEF_DESATIVADA,
    codigo: "TEF_DESATIVADO",
    captura: false as boolean,
    fase: "menu" as "menu" | "pinpad",
    menu: null as { capturaId?: number; prompt?: string; opcoes?: Array<{ texto?: string; valor?: string }> } | null,
  };
}

