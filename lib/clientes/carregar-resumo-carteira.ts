import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { chaveDiaSaoPaulo } from "@/lib/dashboard/periodo";
import { tituloTemSaldo } from "@/lib/carteira/titulos";
import { numeroSeguro } from "@/lib/relatorios/formatacao";
import { createClient } from "@/lib/supabase/server";

import { creditoCarteiraAberto, tituloCarteiraVencido } from "./listagem";

export type ItemAbertoListagem = {
  id: string;
  titulo_id: string;
  venda_id: string | null;
  numero_venda: number | string | null;
  data: string | null;
  produto_nome: string;
  valor_original: number;
  valor_recebido: number;
  valor_aberto: number;
  vencido: boolean;
};

export type CreditoAbertoListagem = {
  id: string;
  data: string;
  origem: string;
  observacao: string | null;
  valor_original: number;
  valor_utilizado: number;
  valor_disponivel: number;
};

export type FormaRecebimentoListagem = {
  id: string;
  nome: string;
};

export async function carregarResumoCarteiraListagem(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  empresaId: string;
  clienteId: string;
}) {
  const hojeIso = chaveDiaSaoPaulo(new Date());

  const [clienteResult, titulosResult, itensResult, creditosResult, formasResult] =
    await Promise.all([
      input.supabase
        .from("clientes")
        .select("id, empresa_id, nome")
        .eq("empresa_id", input.empresaId)
        .eq("id", input.clienteId)
        .maybeSingle(),
      input.supabase
        .from("carteira_cliente_titulos")
        .select("id, empresa_id, venda_id, numero_venda, created_at, vencimento, status")
        .eq("empresa_id", input.empresaId)
        .eq("cliente_id", input.clienteId)
        .neq("status", "CANCELADO"),
      input.supabase
        .from("carteira_cliente_itens")
        .select(
          "id, empresa_id, titulo_id, produto_nome, valor_original, valor_aberto, status, created_at"
        )
        .eq("empresa_id", input.empresaId)
        .eq("cliente_id", input.clienteId)
        .neq("status", "CANCELADO")
        .gt("valor_aberto", 0)
        .order("created_at", { ascending: true }),
      input.supabase
        .from("carteira_cliente_creditos")
        .select(
          "id, empresa_id, origem, observacao, valor_original, valor_disponivel, status, created_at"
        )
        .eq("empresa_id", input.empresaId)
        .eq("cliente_id", input.clienteId)
        .in("status", ["DISPONIVEL", "PARCIAL"])
        .gt("valor_disponivel", 0)
        .order("created_at", { ascending: false }),
      input.supabase
        .from("formas_pagamento")
        .select("id, empresa_id, nome, permite_fiado, ativo, ordem")
        .eq("empresa_id", input.empresaId)
        .eq("ativo", true)
        .eq("permite_fiado", false)
        .order("ordem", { ascending: true }),
    ]);

  if (clienteResult.error) {
    throw new Error(clienteResult.error.message);
  }
  if (!clienteResult.data) {
    return null;
  }
  if (titulosResult.error) {
    throw new Error(titulosResult.error.message);
  }
  if (itensResult.error) {
    throw new Error(itensResult.error.message);
  }
  if (creditosResult.error) {
    throw new Error(creditosResult.error.message);
  }
  if (formasResult.error) {
    throw new Error(formasResult.error.message);
  }

  const titulos = filtrarRegistrosDaEmpresaAtiva(
    titulosResult.data ?? [],
    input.empresaId
  );
  const tituloPorId = new Map(titulos.map((titulo) => [titulo.id, titulo]));

  const itens: ItemAbertoListagem[] = filtrarRegistrosDaEmpresaAtiva(
    itensResult.data ?? [],
    input.empresaId
  )
    .filter((item) => tituloTemSaldo(item.status, numeroSeguro(item.valor_aberto)))
    .map((item) => {
      const titulo = tituloPorId.get(item.titulo_id);
      const original = numeroSeguro(item.valor_original);
      const aberto = numeroSeguro(item.valor_aberto);
      return {
        id: item.id,
        titulo_id: item.titulo_id,
        venda_id: titulo?.venda_id ?? null,
        numero_venda: titulo?.numero_venda ?? null,
        data: titulo?.created_at ?? item.created_at,
        produto_nome: item.produto_nome,
        valor_original: original,
        valor_recebido: Math.max(0, arredondar(original - aberto)),
        valor_aberto: aberto,
        vencido: tituloCarteiraVencido({
          status: item.status,
          valorAberto: aberto,
          vencimento: titulo?.vencimento ?? null,
          hojeIso,
        }),
      };
    });

  const creditos: CreditoAbertoListagem[] = filtrarRegistrosDaEmpresaAtiva(
    creditosResult.data ?? [],
    input.empresaId
  )
    .filter((credito) =>
      creditoCarteiraAberto(credito.status, credito.valor_disponivel)
    )
    .map((credito) => {
      const original = numeroSeguro(credito.valor_original);
      const disponivel = numeroSeguro(credito.valor_disponivel);
      return {
        id: credito.id,
        data: credito.created_at,
        origem: rotuloOrigemCredito(credito.origem),
        observacao: credito.observacao,
        valor_original: original,
        valor_utilizado: Math.max(0, arredondar(original - disponivel)),
        valor_disponivel: disponivel,
      };
    });

  return {
    clienteNome: clienteResult.data.nome,
    itens,
    creditos,
    formas: filtrarRegistrosDaEmpresaAtiva(
      formasResult.data ?? [],
      input.empresaId
    ).map((forma) => ({
      id: forma.id,
      nome: forma.nome,
    })),
    situacao: {
      debitoAberto: arredondar(
        itens.reduce((total, item) => total + item.valor_aberto, 0)
      ),
      creditoAberto: arredondar(
        creditos.reduce((total, credito) => total + credito.valor_disponivel, 0)
      ),
      vencido: arredondar(
        itens
          .filter((item) => item.vencido)
          .reduce((total, item) => total + item.valor_aberto, 0)
      ),
    },
  };
}

function rotuloOrigemCredito(origem: string) {
  const valor = String(origem ?? "").trim().toUpperCase();
  if (valor === "CANCELAMENTO_VENDA") {
    return "Cancelamento de venda";
  }
  if (valor === "ESTORNO_RECEBIMENTO") {
    return "Estorno de recebimento";
  }
  return origem || "Crédito";
}

function arredondar(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
