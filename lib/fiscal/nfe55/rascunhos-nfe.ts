import { hrefEdicaoOperacaoFiscal } from "@/lib/fiscal/acoes-emissao";
import { lerCabecalhoFiscalDoSnapshot } from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import {
  totalLiquidoNota,
  totaisNotaDoSnapshot,
} from "@/lib/fiscal/nfe55/totais-nota";
import { rotuloStatusOperacaoFiscal } from "@/lib/fiscal/operacoes/status-operacao";

export const HREF_RASCUNHOS_NFE = "/vendas/rascunhos-nfe";

export const ABA_RASCUNHOS_NFE = "rascunhos-nfe";

export const MENSAGEM_SAIR_NFE_COM_ALTERACOES =
  "Existem alterações não salvas. Deseja sair mesmo assim?";

export const STATUS_RASCUNHO_NFE55 = [
  "rascunho",
  "pronta_para_verificacao",
  "pronta_para_emissao",
] as const;

export type StatusRascunhoNfe55 = (typeof STATUS_RASCUNHO_NFE55)[number];

export function statusEhRascunhoNfe55(status: string) {
  return (STATUS_RASCUNHO_NFE55 as readonly string[]).includes(
    String(status ?? "")
  );
}

export function identificacaoRascunhoNfe55(input: {
  id: string;
  serie?: number | string | null;
  numero?: number | string | null;
}) {
  const serie = String(input.serie ?? "").trim();
  const numero = String(input.numero ?? "").trim();
  if (serie && numero) {
    return `${serie}/${numero}`;
  }
  const id = String(input.id ?? "").replace(/-/g, "");
  return id ? `Rascunho ${id.slice(0, 8)}` : "Rascunho";
}

export function hrefContinuarRascunhoNfe55(operacaoId: string) {
  return hrefEdicaoOperacaoFiscal(operacaoId);
}

export type ItemListaRascunhoNfe55 = {
  id: string;
  identificacao: string;
  data: string | null;
  destinatario: string;
  quantidadeItens: number;
  valorTotal: number;
  natureza: string;
  status: string;
  statusRotulo: string;
  usuario: string;
  atualizadoEm: string | null;
  href: string;
};

export function montarItemListaRascunhoNfe55(input: {
  id: string;
  status: string;
  naturezaDescricao?: string | null;
  snapshotFiscal?: unknown;
  createdAt?: string | null;
  updatedAt?: string | null;
  destinatarioNome?: string | null;
  usuarioNome?: string | null;
  quantidadeItens?: number;
  totalProdutos?: number;
}): ItemListaRascunhoNfe55 | null {
  if (!statusEhRascunhoNfe55(input.status)) {
    return null;
  }
  const cabecalho = lerCabecalhoFiscalDoSnapshot(input.snapshotFiscal);
  const totais = totaisNotaDoSnapshot(input.snapshotFiscal);
  const totalProdutos = Number(input.totalProdutos ?? 0);
  return {
    id: input.id,
    identificacao: identificacaoRascunhoNfe55({
      id: input.id,
      serie: cabecalho.serie,
      numero: cabecalho.numero,
    }),
    data: input.createdAt ?? null,
    destinatario: String(input.destinatarioNome ?? "").trim() || "—",
    quantidadeItens: Math.max(0, Number(input.quantidadeItens ?? 0)),
    valorTotal: totalLiquidoNota(
      Number.isFinite(totalProdutos) ? totalProdutos : 0,
      totais
    ),
    natureza: String(input.naturezaDescricao ?? "").trim() || "—",
    status: input.status,
    statusRotulo: rotuloStatusOperacaoFiscal(input.status),
    usuario: String(input.usuarioNome ?? "").trim() || "—",
    atualizadoEm: input.updatedAt ?? input.createdAt ?? null,
    href: hrefContinuarRascunhoNfe55(input.id),
  };
}
