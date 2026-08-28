import { diasAteValidade, formatarDataBr } from "@/lib/produtos/lotes";

import { chaveNotificacao, hrefProdutoNotificacao } from "./rotas";
import type { CandidatoNotificacao, ConfiguracaoNotificacoes } from "./tipos";

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type LoteNotificacao = {
  loteId: string;
  produtoId: string;
  nomeProduto: string;
  codigoLote: string;
  dataValidade: string;
  quantidade: number | string | null;
};

export function avaliarValidadeNotificacoes(params: {
  lotes: LoteNotificacao[];
  config: ConfiguracaoNotificacoes;
  referencia?: Date | string;
}): CandidatoNotificacao[] {
  const candidatos: CandidatoNotificacao[] = [];
  const referencia = params.referencia ?? new Date();

  for (const lote of params.lotes) {
    if (numero(lote.quantidade) <= 0) {
      continue;
    }

    const dias = diasAteValidade(lote.dataValidade, referencia);
    if (dias == null) {
      continue;
    }

    const nome = String(lote.nomeProduto ?? "").trim() || "Produto";
    const codigo = String(lote.codigoLote ?? "").trim() || "sem código";
    const validade = formatarDataBr(lote.dataValidade);

    if (dias < 0 && params.config.loteVencido) {
      candidatos.push({
        tipo: "lote_vencido",
        categoria: "validade",
        nivel: "critico",
        titulo: "Lote vencido",
        mensagem: `${nome} · lote ${codigo} venceu em ${validade}.`,
        entidadeTipo: "lote",
        entidadeId: lote.loteId,
        actionUrl: hrefProdutoNotificacao(lote.produtoId),
        chaveDeduplicacao: chaveNotificacao("lote_vencido", lote.loteId),
        metadata: { produtoId: lote.produtoId, dias },
      });
      continue;
    }

    if (
      dias >= 0 &&
      dias <= params.config.antecedenciaValidadeDias &&
      params.config.loteVencendo
    ) {
      candidatos.push({
        tipo: "lote_vencendo",
        categoria: "validade",
        nivel: dias <= 7 ? "importante" : "atencao",
        titulo: "Lote próximo do vencimento",
        mensagem: `${nome} · lote ${codigo} vence em ${validade}.`,
        entidadeTipo: "lote",
        entidadeId: lote.loteId,
        actionUrl: hrefProdutoNotificacao(lote.produtoId),
        chaveDeduplicacao: chaveNotificacao("lote_vencendo", lote.loteId),
        metadata: { produtoId: lote.produtoId, dias },
      });
    }
  }

  return candidatos;
}
