import { createAdminClient } from "@/lib/supabase/admin";

import { carregarIntegracaoPix, ErroPixGeranet } from "./contexto";
import { ehFormaPix } from "./local-regras";
import {
  CODIGO_PIX_GERANET_NAO_ATIVO,
  CODIGO_PIX_LOCAL_NAO_ATIVO,
  CODIGO_PIX_NAO_CONFIGURADO,
  MENSAGEM_PIX_GERANET_NAO_ATIVO,
  MENSAGEM_PIX_LOCAL_NAO_ATIVO,
  MENSAGEM_PIX_NAO_CONFIGURADO,
  MENSAGEM_TROCA_MODO_PIX_PENDENTE,
  STATUS_PIX_BLOQUEIAM_TROCA_MODO,
  classificarIntegracaoPix,
  deveBloquearTrocaModoPix,
  validarCobrancaCompativelComModoAtivo,
  type ModoPixAtivo,
  type ResolucaoModoPix,
} from "./modo-ativo";
import {
  MENSAGEM_FORMA_PIX_LEGADA,
  validarFormaPixNovaVenda,
} from "@/lib/pdv/formas-pagamento-checkout";
import type { ModoPix } from "./types";

export async function resolverModoPixAtivo(
  empresaId: string
): Promise<ResolucaoModoPix> {
  const integracao = await carregarIntegracaoPix(empresaId);
  return classificarIntegracaoPix(
    integracao
      ? {
          id: integracao.id,
          ativo: integracao.ativo,
          modo: integracao.modo,
          provedor: integracao.provedor,
        }
      : null
  );
}

export async function exigirPixLocalAtivo(
  empresaId: string
): Promise<ModoPixAtivo> {
  const resolucao = await resolverModoPixAtivo(empresaId);

  if (!resolucao.ativo) {
    throw new ErroPixGeranet(
      MENSAGEM_PIX_NAO_CONFIGURADO,
      409,
      CODIGO_PIX_NAO_CONFIGURADO
    );
  }

  if (resolucao.modo !== "local_manual") {
    throw new ErroPixGeranet(
      MENSAGEM_PIX_LOCAL_NAO_ATIVO,
      409,
      CODIGO_PIX_LOCAL_NAO_ATIVO
    );
  }

  return resolucao;
}

export async function exigirPixGeranetAtivo(
  empresaId: string
): Promise<ModoPixAtivo> {
  const resolucao = await resolverModoPixAtivo(empresaId);

  if (!resolucao.ativo) {
    throw new ErroPixGeranet(
      MENSAGEM_PIX_NAO_CONFIGURADO,
      409,
      CODIGO_PIX_NAO_CONFIGURADO
    );
  }

  if (resolucao.modo !== "geranet") {
    throw new ErroPixGeranet(
      MENSAGEM_PIX_GERANET_NAO_ATIVO,
      409,
      CODIGO_PIX_GERANET_NAO_ATIVO
    );
  }

  return resolucao;
}

export async function garantirTrocaModoPixPermitida(params: {
  empresaId: string;
  modoAtual?: string | null;
  modoNovo: ModoPix;
}) {
  if (!params.modoAtual || params.modoAtual === params.modoNovo) {
    return;
  }

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("cobrancas_pix")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", params.empresaId)
    .is("venda_id", null)
    .in("status", [...STATUS_PIX_BLOQUEIAM_TROCA_MODO]);

  if (error) {
    throw new ErroPixGeranet(
      "Não foi possível verificar operações PIX pendentes.",
      500
    );
  }

  if (
    deveBloquearTrocaModoPix({
      modoAtual: params.modoAtual,
      modoNovo: params.modoNovo,
      pendenciasNaoVinculadas: count ?? 0,
    })
  ) {
    throw new ErroPixGeranet(MENSAGEM_TROCA_MODO_PIX_PENDENTE, 409);
  }
}

type ClienteConsulta = {
  // O client real do Supabase tem genéricos profundos demais para
  // descrever select/eq/in sem TS2589. O contrato usado aqui é só
  // .from().select().eq().in().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tabela: string) => any;
};

export async function validarPixNaFinalizacaoComercial(params: {
  supabase: ClienteConsulta;
  empresaId: string;
  pagamentos: Array<{
    formaPagamentoId: string;
    valorCentavos: number;
    pixLocalRecebimentoId?: string | null;
  }>;
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const formaIds = [
    ...new Set(params.pagamentos.map((pagamento) => pagamento.formaPagamentoId)),
  ];

  if (formaIds.length === 0) {
    return { ok: true };
  }

  const { data: formas, error: erroFormas } = await params.supabase
    .from("formas_pagamento")
    .select("id, tipo, codigo, nome")
    .eq("empresa_id", params.empresaId)
    .in("id", formaIds);

  if (erroFormas || !formas) {
    return {
      ok: false,
      erro: "Não foi possível validar as formas de pagamento.",
    };
  }

  const formaPorId = new Map<
    string,
    { id: string; tipo?: string | null; codigo?: string | null; nome?: string | null }
  >(
    formas.map(
      (forma: {
        id: string;
        tipo?: string | null;
        codigo?: string | null;
        nome?: string | null;
      }) => [forma.id, forma]
    )
  );

  for (const pagamento of params.pagamentos) {
    const forma = formaPorId.get(pagamento.formaPagamentoId) ?? null;
    try {
      validarFormaPixNovaVenda(forma);
    } catch (error) {
      return {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : MENSAGEM_FORMA_PIX_LEGADA,
      };
    }
  }

  const pagamentosPix = params.pagamentos.filter((pagamento) =>
    ehFormaPix(formaPorId.get(pagamento.formaPagamentoId) ?? null)
  );

  if (pagamentosPix.length === 0) {
    return { ok: true };
  }

  const resolucao = await resolverModoPixAtivo(params.empresaId);

  if (!resolucao.ativo) {
    return { ok: false, erro: MENSAGEM_PIX_NAO_CONFIGURADO };
  }

  const admin = createAdminClient();

  for (const pagamento of pagamentosPix) {
    const recebimentoId = pagamento.pixLocalRecebimentoId?.trim();
    if (!recebimentoId) {
      return {
        ok: false,
        erro:
          resolucao.modo === "local_manual"
            ? "Confirme o recebimento do PIX antes de finalizar a venda."
            : "Aguardando confirmação do pagamento PIX.",
      };
    }

    const { data, error } = await admin
      .from("cobrancas_pix")
      .select("id, empresa_id, modo_pix, venda_id, status")
      .eq("id", recebimentoId)
      .eq("empresa_id", params.empresaId)
      .maybeSingle();

    if (error) {
      return { ok: false, erro: "Não foi possível validar o PIX da venda." };
    }

    if (!data) {
      return { ok: false, erro: "Recebimento PIX não encontrado nesta empresa." };
    }

    try {
      validarCobrancaCompativelComModoAtivo({
        modoAtivo: resolucao.modo,
        cobrancaModoPix: data.modo_pix ? String(data.modo_pix) : null,
      });
    } catch (error) {
      return {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : MENSAGEM_PIX_NAO_CONFIGURADO,
      };
    }
  }

  return { ok: true };
}
