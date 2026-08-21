import { rotuloModeloFiscal } from "@/lib/fiscal/acoes-emissao";

export type EmissaoFiscalCarteira = {
  origem_id: string;
  modelo: string | null;
  numero: number | string | null;
  serie?: number | string | null;
  status: string | null;
};

export function rotuloStatusFiscalCarteira(status: string | null | undefined) {
  const valor = String(status ?? "").trim().toLowerCase();
  if (!valor) {
    return null;
  }

  const mapa: Record<string, string> = {
    autorizada: "AUTORIZADA",
    cancelada: "CANCELADA",
    rejeitada: "REJEITADA",
    denegada: "DENEGADA",
    enviando: "ENVIANDO",
    erro_comunicacao: "ERRO DE COMUNICAÇÃO",
    aguardando_reconciliacao: "AGUARDANDO RECONCILIAÇÃO",
    reservada: "RESERVADA",
    inutilizada: "INUTILIZADA",
  };

  return mapa[valor] ?? valor.toUpperCase();
}

export function resumoFiscalVendaCarteira(
  emissao: EmissaoFiscalCarteira | null | undefined
) {
  if (!emissao) {
    return null;
  }

  const modelo = rotuloModeloFiscal(emissao.modelo);
  const numero = emissao.numero == null || emissao.numero === ""
    ? null
    : String(emissao.numero);
  const status = rotuloStatusFiscalCarteira(emissao.status);

  return {
    modelo,
    numero,
    status,
    linha: [
      numero ? `${modelo} #${numero}` : modelo,
      status,
    ]
      .filter(Boolean)
      .join("  "),
  };
}

export function vendaPossuiDocumentoFiscal(
  emissao: EmissaoFiscalCarteira | null | undefined
) {
  return Boolean(emissao?.status);
}
