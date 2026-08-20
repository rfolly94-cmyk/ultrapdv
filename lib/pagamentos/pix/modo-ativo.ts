import { ehModoPix } from "./local-config";
import { ErroPixGeranet } from "./erro";
import type { ModoPix } from "./types";

export const CODIGO_PIX_LOCAL_NAO_ATIVO = "PIX_LOCAL_NAO_ATIVO";
export const CODIGO_PIX_GERANET_NAO_ATIVO = "PIX_GERANET_NAO_ATIVO";
export const CODIGO_PIX_NAO_CONFIGURADO = "PIX_NAO_CONFIGURADO";

export const MENSAGEM_PIX_NAO_CONFIGURADO =
  "PIX não está configurado para esta empresa.";

export const MENSAGEM_PIX_LOCAL_NAO_ATIVO =
  "O PIX Local não está habilitado para esta empresa. O modo ativo é PIX Integrado.";

export const MENSAGEM_PIX_GERANET_NAO_ATIVO =
  "O PIX Integrado não está habilitado para esta empresa. O modo ativo é PIX Local.";

export const MENSAGEM_TROCA_MODO_PIX_PENDENTE =
  "Existem operações PIX ainda não vinculadas a vendas. Conclua ou descarte essas operações antes de alterar o modo PIX.";

export const MENSAGEM_VENDA_LOCAL_NAO_ACEITA_GERANET =
  "Esta venda não aceita cobrança PIX Integrada. O modo ativo é PIX Local.";

export const MENSAGEM_VENDA_GERANET_NAO_ACEITA_LOCAL =
  "Esta venda não aceita recebimento PIX Local. O modo ativo é PIX Integrado.";

export const STATUS_PIX_BLOQUEIAM_TROCA_MODO = [
  "aguardando_confirmacao",
  "pendente",
  "confirmado_manual",
  "paga",
] as const;

export type ModoPixAtivo = {
  ativo: true;
  modo: ModoPix;
  integracaoId: string;
  provedor: string | null;
};

export type ResolucaoModoPix =
  | {
      ativo: false;
      motivo: "ausente" | "inativa" | "invalido";
      integracaoId?: string;
      provedor?: string | null;
    }
  | ModoPixAtivo;

export type PixConfigPdv =
  | {
      modo: "local_manual";
    }
  | {
      modo: "geranet";
      provedor: string | null;
    };

export function classificarIntegracaoPix(integracao: {
  id?: string | null;
  ativo?: boolean | null;
  modo?: string | null;
  provedor?: string | null;
} | null): ResolucaoModoPix {
  if (!integracao) {
    return { ativo: false, motivo: "ausente" };
  }

  if (integracao.ativo !== true) {
    return {
      ativo: false,
      motivo: "inativa",
      integracaoId: integracao.id ? String(integracao.id) : undefined,
      provedor: integracao.provedor ?? null,
    };
  }

  if (!ehModoPix(integracao.modo)) {
    return {
      ativo: false,
      motivo: "invalido",
      integracaoId: integracao.id ? String(integracao.id) : undefined,
      provedor: integracao.provedor ?? null,
    };
  }

  return {
    ativo: true,
    modo: integracao.modo,
    integracaoId: String(integracao.id ?? ""),
    provedor: integracao.provedor ?? null,
  };
}

export function pixConfigPublicoPdv(
  resolucao: ResolucaoModoPix
): PixConfigPdv | null {
  if (!resolucao.ativo) {
    return null;
  }

  if (resolucao.modo === "local_manual") {
    return { modo: "local_manual" };
  }

  return {
    modo: "geranet",
    provedor: resolucao.provedor,
  };
}

export function rejeitarModoAdulteradoNoCliente(body: Record<string, unknown>) {
  if ("modo" in body || "modo_pix" in body) {
    throw new ErroPixGeranet("O cliente não pode escolher o modo PIX.", 422);
  }
}

export function deveBloquearTrocaModoPix(params: {
  modoAtual?: string | null;
  modoNovo: string;
  pendenciasNaoVinculadas: number;
}) {
  if (!ehModoPix(params.modoNovo)) {
    return false;
  }

  if (!params.modoAtual || params.modoAtual === params.modoNovo) {
    return false;
  }

  return params.pendenciasNaoVinculadas > 0;
}

export function validarCobrancaCompativelComModoAtivo(params: {
  modoAtivo: ModoPix;
  cobrancaModoPix?: string | null;
}) {
  if (
    params.modoAtivo === "local_manual" &&
    params.cobrancaModoPix !== "local_manual"
  ) {
    throw new Error(MENSAGEM_VENDA_LOCAL_NAO_ACEITA_GERANET);
  }

  if (params.modoAtivo === "geranet" && params.cobrancaModoPix !== "geranet") {
    throw new Error(MENSAGEM_VENDA_GERANET_NAO_ACEITA_LOCAL);
  }
}
