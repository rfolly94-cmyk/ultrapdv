import { garantirEmpresa } from "./montar-payload";
import { valoresPixCompativeis } from "./evidencia-pagamento";
import type {
  EstadoPagamentoPixGeranet,
  StatusCobrancaPix,
} from "./types";

export const MENSAGEM_PIX_GERANET_NAO_CONFIGURADO =
  "PIX integrado não está configurado para esta empresa.";

export const MENSAGEM_PIX_GERANET_AGUARDANDO =
  "Aguardando confirmação do pagamento PIX.";

export const MENSAGEM_PIX_GERANET_DIVERGENCIA =
  "PIX recebido com valor divergente. Verifique antes de continuar.";

export const MENSAGEM_PIX_GERANET_INDETERMINADO =
  "Não foi possível confirmar automaticamente o pagamento.";

export const MENSAGEM_PIX_GERANET_REDE =
  "Não foi possível consultar o PIX agora. Tentando novamente...";

export const MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA =
  "Este PIX já foi pago. O valor não pode ser alterado sem tratar o recebimento.";

export const MENSAGEM_PIX_GERANET_DESCARTAR =
  "Descartar esta cobrança PIX?";

export const CAMPOS_PROIBIDOS_EMITIR_PDV = [
  "empresa_id",
  "provedor",
  "ambiente",
  "credenciais",
  "chavePix",
  "chave_pix",
  "cnpjcpf",
  "cnpj",
  "apiKey",
  "api_key",
  "clienteId",
  "clienteSegredo",
  "certificado",
  "token",
  "modo",
  "modo_pix",
] as const;

const STATUS_TERMINAL_POLLING = new Set([
  "paga",
  "cancelada",
  "expirada",
  "divergencia_valor",
  "vinculado_venda",
]);

const STATUS_NAO_REBAIXAVEIS = new Set<StatusCobrancaPix>([
  "paga",
  "vinculado_venda",
]);

export function rejeitarCamposSensiveisEmitirPixPdv(
  body: Record<string, unknown>
) {
  for (const campo of CAMPOS_PROIBIDOS_EMITIR_PDV) {
    if (campo in body) {
      throw new Error("O cliente não pode escolher empresa, provedor ou credenciais.");
    }
  }
}

export function checkoutKeyPixValida(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor
  );
}

export function intervaloPollingPixGeranet(decorridoMs: number) {
  return decorridoMs < 60_000 ? 3_000 : 5_000;
}

export function devePararPollingPixGeranet(status: string) {
  return STATUS_TERMINAL_POLLING.has(status);
}

export function decidirQrAposMudancaValorGeranet(params: {
  status: string;
  valorCobranca: number;
  valorNovo: number;
}) {
  if (params.valorCobranca === params.valorNovo) {
    return "manter" as const;
  }

  if (
    params.status === "paga" ||
    params.status === "divergencia_valor" ||
    params.status === "vinculado_venda"
  ) {
    return "bloquear" as const;
  }

  if (params.status === "pendente" || params.status === "erro") {
    return "substituir" as const;
  }

  return "novo" as const;
}

export function decidirReusoCobrancaCheckout(params: {
  existente: {
    status: string;
    valor: number;
    venda_id?: string | null;
  } | null;
  valorNovo: number;
}) {
  if (!params.existente) {
    return "emitir" as const;
  }

  if (params.existente.venda_id) {
    return "erro_vinculada" as const;
  }

  const mesmoValor = valoresPixCompativeis(
    params.existente.valor,
    params.valorNovo
  );

  if (mesmoValor) {
    if (
      params.existente.status === "paga" ||
      params.existente.status === "pendente" ||
      params.existente.status === "divergencia_valor"
    ) {
      return "reutilizar" as const;
    }
  }

  if (
    params.existente.status === "paga" ||
    params.existente.status === "divergencia_valor"
  ) {
    return "bloquear_pago" as const;
  }

  if (params.existente.status === "pendente") {
    return "substituir" as const;
  }

  return "emitir" as const;
}

export function statusMonotonicoConsultaPix(params: {
  statusAtual: StatusCobrancaPix;
  estado: EstadoPagamentoPixGeranet;
  valorCobranca: number;
  valorPago?: number | null;
}): StatusCobrancaPix {
  if (STATUS_NAO_REBAIXAVEIS.has(params.statusAtual)) {
    return params.statusAtual;
  }

  if (
    params.estado === "falha_temporaria" ||
    params.estado === "falha_cliente" ||
    params.estado === "indeterminado"
  ) {
    return params.statusAtual;
  }

  if (params.estado === "pago") {
    if (!valoresPixCompativeis(params.valorCobranca, params.valorPago)) {
      return "divergencia_valor";
    }

    return "paga";
  }

  if (params.estado === "cancelado") {
    return "cancelada";
  }

  if (params.estado === "expirado") {
    return "expirada";
  }

  return params.statusAtual === "erro" ? "pendente" : params.statusAtual;
}

export function validarVinculoPixGeranetNaFinalizacao(params: {
  empresaId: string;
  valorPagamento: number;
  cobranca: {
    empresa_id: string;
    status: string;
    modo_pix?: string | null;
    venda_id?: string | null;
    valor: number;
    txid?: string | null;
    provedor?: string | null;
  };
}) {
  garantirEmpresa(params.empresaId, params.cobranca.empresa_id);

  if (params.cobranca.modo_pix !== "geranet") {
    throw new Error("Este recebimento não é um PIX Geranet.");
  }

  if (params.cobranca.venda_id) {
    throw new Error("Este PIX já foi utilizado em outra venda.");
  }

  if (params.cobranca.status === "divergencia_valor") {
    throw new Error(MENSAGEM_PIX_GERANET_DIVERGENCIA);
  }

  if (params.cobranca.status !== "paga") {
    throw new Error(MENSAGEM_PIX_GERANET_AGUARDANDO);
  }

  if (!String(params.cobranca.txid ?? "").trim()) {
    throw new Error("Cobrança PIX sem TXID não pode finalizar a venda.");
  }

  if (!valoresPixCompativeis(Number(params.cobranca.valor), params.valorPagamento)) {
    throw new Error(
      "O valor do PIX pago deve ser igual ao pagamento."
    );
  }
}

export function podeCancelarCobrancaGeranetPdv(status: string) {
  return status === "pendente" || status === "erro";
}

export function srcQrPix(qr: string | null | undefined) {
  const valor = String(qr ?? "").trim();
  if (!valor) {
    return null;
  }

  if (
    valor.startsWith("data:") ||
    valor.startsWith("http://") ||
    valor.startsWith("https://")
  ) {
    return valor;
  }

  return `data:image/png;base64,${valor}`;
}
