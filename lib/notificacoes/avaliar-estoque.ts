import { situacaoEstoque } from "@/lib/relatorios/calculo";

import { minimoEstoqueEfetivo } from "./config";
import { chaveNotificacao, hrefProdutoNotificacao } from "./rotas";
import type { CandidatoNotificacao, ConfiguracaoNotificacoes } from "./tipos";

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function quantidadeTexto(valor: number) {
  return valor.toLocaleString("pt-BR", {
    maximumFractionDigits: 4,
  });
}

export type ItemEstoqueNotificacao = {
  produtoId: string;
  nome: string;
  ativo: boolean;
  quantidade: number | string | null;
  estoqueMinimo: number | string | null;
};

export function avaliarEstoqueNotificacoes(params: {
  itens: ItemEstoqueNotificacao[];
  config: ConfiguracaoNotificacoes;
}): CandidatoNotificacao[] {
  const candidatos: CandidatoNotificacao[] = [];

  for (const item of params.itens) {
    if (!item.ativo) {
      continue;
    }

    const quantidade = numero(item.quantidade);
    const minimo = minimoEstoqueEfetivo({
      minimoProduto: numero(item.estoqueMinimo),
      minimoPadraoEmpresa: params.config.estoqueMinimoPadrao,
    });
    const situacao = situacaoEstoque({
      quantidade,
      estoqueMinimo: minimo,
    });
    const nome = String(item.nome ?? "").trim() || "Produto";

    if (situacao === "negativo" && params.config.estoqueNegativo) {
      candidatos.push({
        tipo: "estoque_negativo",
        categoria: "estoque",
        nivel: "critico",
        titulo: "Estoque negativo",
        mensagem: `${nome} está com ${quantidadeTexto(quantidade)} unidades.`,
        entidadeTipo: "produto",
        entidadeId: item.produtoId,
        actionUrl: hrefProdutoNotificacao(item.produtoId),
        chaveDeduplicacao: chaveNotificacao("estoque_negativo", item.produtoId),
        metadata: { quantidade, minimo },
      });
      continue;
    }

    if (situacao === "sem" && params.config.estoqueZerado) {
      candidatos.push({
        tipo: "estoque_zerado",
        categoria: "estoque",
        nivel: "importante",
        titulo: "Estoque zerado",
        mensagem: `${nome} está sem estoque.`,
        entidadeTipo: "produto",
        entidadeId: item.produtoId,
        actionUrl: hrefProdutoNotificacao(item.produtoId),
        chaveDeduplicacao: chaveNotificacao("estoque_zerado", item.produtoId),
        metadata: { quantidade, minimo },
      });
      continue;
    }

    if (situacao === "baixo" && params.config.estoqueBaixo) {
      candidatos.push({
        tipo: "estoque_baixo",
        categoria: "estoque",
        nivel: "atencao",
        titulo: "Estoque baixo",
        mensagem: `${nome} está com ${quantidadeTexto(quantidade)} unidades. Estoque mínimo: ${quantidadeTexto(minimo)}.`,
        entidadeTipo: "produto",
        entidadeId: item.produtoId,
        actionUrl: hrefProdutoNotificacao(item.produtoId),
        chaveDeduplicacao: chaveNotificacao("estoque_baixo", item.produtoId),
        metadata: { quantidade, minimo },
      });
    }
  }

  return candidatos;
}
