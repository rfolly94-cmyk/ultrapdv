import { tituloCarteiraVencido } from "@/lib/clientes/listagem";

import { chaveNotificacao, hrefCarteiraNotificacao } from "./rotas";
import type { CandidatoNotificacao, ConfiguracaoNotificacoes } from "./tipos";

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type TituloCarteiraNotificacao = {
  clienteId: string;
  nomeCliente: string;
  status: string;
  valorAberto: number | string | null;
  vencimento: string | null;
};

export function avaliarFinanceiroNotificacoes(params: {
  titulos: TituloCarteiraNotificacao[];
  config: ConfiguracaoNotificacoes;
  hojeIso: string;
}): CandidatoNotificacao[] {
  if (!params.config.carteiraVencida) {
    return [];
  }

  const porCliente = new Map<
    string,
    { nome: string; valor: number; titulos: number }
  >();

  for (const titulo of params.titulos) {
    if (
      !tituloCarteiraVencido({
        status: titulo.status,
        valorAberto: titulo.valorAberto,
        vencimento: titulo.vencimento,
        hojeIso: params.hojeIso,
      })
    ) {
      continue;
    }

    const atual = porCliente.get(titulo.clienteId) ?? {
      nome: String(titulo.nomeCliente ?? "").trim() || "Cliente",
      valor: 0,
      titulos: 0,
    };
    atual.valor += numero(titulo.valorAberto);
    atual.titulos += 1;
    porCliente.set(titulo.clienteId, atual);
  }

  return [...porCliente.entries()].map(([clienteId, dados]) => ({
    tipo: "carteira_vencida" as const,
    categoria: "financeiro" as const,
    nivel: "importante" as const,
    titulo: "Carteira vencida",
    mensagem: `${dados.nome} tem ${moeda.format(dados.valor)} em atraso (${dados.titulos} título(s)).`,
    entidadeTipo: "cliente",
    entidadeId: clienteId,
    actionUrl: hrefCarteiraNotificacao(clienteId),
    chaveDeduplicacao: chaveNotificacao("carteira_vencida", clienteId),
    metadata: { valor: dados.valor, titulos: dados.titulos },
  }));
}
