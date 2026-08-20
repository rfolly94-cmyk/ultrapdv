import { garantirEmpresa } from "./montar-payload";
import type { StatusPixLocal } from "./types";

export const STATUS_PIX_LOCAL = {
  aguardando: "aguardando_confirmacao",
  confirmado: "confirmado_manual",
  vinculado: "vinculado_venda",
  descartado: "descartado",
} as const satisfies Record<string, StatusPixLocal>;

export function ehFormaPix(forma: {
  tipo?: string | null;
  codigo?: string | null;
  nome?: string | null;
} | null) {
  if (!forma) {
    return false;
  }

  return `${forma.tipo ?? ""} ${forma.codigo ?? ""} ${forma.nome ?? ""}`
    .toLowerCase()
    .includes("pix");
}

export function formatarValorPixBr(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function mensagemBloqueioPixPendente(valor: number) {
  return `Confirme o recebimento do PIX de ${formatarValorPixBr(valor)} antes de finalizar a venda.`;
}

export function mensagemPixConfirmadoNaoAltera() {
  return "Este PIX já foi confirmado manualmente. Para alterar o pagamento, é necessário remover/reverter conscientemente esta confirmação.";
}

export function validarGeracaoPixLocal(params: {
  valor: number;
  modo?: string | null;
  ativo?: boolean | null;
  chavePix?: string | null;
  recebedorNome?: string | null;
  recebedorCidade?: string | null;
}) {
  if (params.modo !== "local_manual" || !params.ativo) {
    throw new Error("Configure o PIX Local / Manual antes de gerar o QR Code.");
  }

  if (!Number.isFinite(params.valor) || params.valor <= 0) {
    throw new Error("Informe um valor PIX maior que zero.");
  }

  if (
    !params.chavePix?.trim() ||
    !params.recebedorNome?.trim() ||
    !params.recebedorCidade?.trim()
  ) {
    throw new Error("Preencha Chave PIX, nome e cidade do recebedor.");
  }
}

export function rejeitarCamposDeConfirmacaoDoCliente(body: Record<string, unknown>) {
  if (
    "confirmado_por" in body ||
    "confirmado_em" in body ||
    "usuario_id" in body ||
    "empresa_id" in body
  ) {
    throw new Error("O cliente não pode escolher quem confirma o PIX.");
  }
}

export function validarConfirmacaoPixLocal(params: {
  empresaId: string;
  recebimento: {
    empresa_id: string;
    status: string;
    modo_pix?: string | null;
    venda_id?: string | null;
  };
}) {
  garantirEmpresa(params.empresaId, params.recebimento.empresa_id);

  if (params.recebimento.modo_pix !== "local_manual") {
    throw new Error("Este recebimento não é um PIX Local.");
  }

  if (params.recebimento.venda_id) {
    throw new Error("Este PIX já está vinculado a uma venda.");
  }

  if (params.recebimento.status !== STATUS_PIX_LOCAL.aguardando) {
    throw new Error("Este PIX não está aguardando confirmação.");
  }
}

export function validarVinculoPixNaFinalizacao(params: {
  empresaId: string;
  valorPagamento: number;
  recebimento: {
    empresa_id: string;
    status: string;
    modo_pix?: string | null;
    venda_id?: string | null;
    valor: number;
    confirmado_manualmente?: boolean | null;
  };
}) {
  garantirEmpresa(params.empresaId, params.recebimento.empresa_id);

  if (params.recebimento.modo_pix !== "local_manual") {
    throw new Error("Este recebimento não é um PIX Local.");
  }

  if (params.recebimento.venda_id) {
    throw new Error("Este PIX já foi utilizado em outra venda.");
  }

  if (
    params.recebimento.status !== STATUS_PIX_LOCAL.confirmado ||
    !params.recebimento.confirmado_manualmente
  ) {
    throw new Error(mensagemBloqueioPixPendente(params.valorPagamento));
  }

  if (Number(params.recebimento.valor) !== Number(params.valorPagamento)) {
    throw new Error(
      `O valor do PIX confirmado (${formatarValorPixBr(params.recebimento.valor)}) deve ser igual ao pagamento (${formatarValorPixBr(params.valorPagamento)}).`
    );
  }
}

export function decidirQrAposMudancaValor(params: {
  status: string;
  valorQr: number;
  valorNovo: number;
}) {
  if (params.valorQr === params.valorNovo) {
    return "manter" as const;
  }

  if (
    params.status === STATUS_PIX_LOCAL.confirmado ||
    params.status === STATUS_PIX_LOCAL.vinculado
  ) {
    return "bloquear" as const;
  }

  if (params.status === STATUS_PIX_LOCAL.aguardando) {
    return "descartar" as const;
  }

  return "ignorar" as const;
}

export function podeDescartarPixLocal(status: string, consciente = false) {
  if (status === STATUS_PIX_LOCAL.aguardando) {
    return true;
  }

  if (status === STATUS_PIX_LOCAL.confirmado && consciente) {
    return true;
  }

  return false;
}
