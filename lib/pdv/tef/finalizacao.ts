import "server-only";

import {
  avaliarParcelasCartao,
  operacaoManualAceita,
  type PoliticaCartaoTef,
} from "@/lib/pdv/tef/cartao-checkout";
import { classificarFormaTef, validarPagamentoMisto } from "@/lib/pdv/tef/regras";
import { hashSegredoVinculo } from "@/lib/pdv/tef/prova";
import {
  ErroTef,
  lerHabilitacaoTef,
  vincularOperacoesTefNaVenda,
} from "@/lib/pdv/tef/persistencia";

type PagamentoTef = {
  formaPagamentoId: string;
  valorCentavos: number;
  tefOperacaoId?: string | null;
  tefVinculoSegredo?: string | null;
  cartaoManual?: boolean | null;
};

const MENSAGEM_CONSULTA_TEF =
  "Não foi possível validar o TEF. O cartão não foi registrado.";

export async function validarTefNaFinalizacao(input: {
  supabase: {
    from: (tabela: string) => {
      select: (colunas: string) => any;
    };
  };
  empresaId: string;
  usuarioId: string;
  pagamentos: PagamentoTef[];
}) {
  let habilitacao: Awaited<ReturnType<typeof lerHabilitacaoTef>> | null;
  try {
    habilitacao = await lerHabilitacaoTef(input.supabase, input.empresaId);
  } catch (error) {
    if (error instanceof ErroTef && error.status === 503) {
      habilitacao = {
        habilitado: false,
        plataformaHabilitada: false,
        empresaHabilitada: false,
        permitirOperacaoManual: false,
        operacaoManualDisponivel: false,
        migracaoPendente: true,
        ambiente: "homologacao",
        estabelecimento: "",
        pontoCaptura: "",
      };
    } else {
      habilitacao = null;
    }
  }

  if (!habilitacao) {
    const bloqueio = await bloquearCartaoSeConsultaFalhou(input);
    if (bloqueio) {
      return bloqueio;
    }
    return { ok: true as const, operacaoIds: [] as string[], segredos: {} };
  }

  const informouTef = input.pagamentos.some((pagamento) => pagamento.tefOperacaoId);
  if (!habilitacao.empresaHabilitada && !informouTef) {
    return { ok: true as const, operacaoIds: [] as string[], segredos: {} };
  }

  if (habilitacao.migracaoPendente && informouTef) {
    return {
      ok: false as const,
      erro: "A estrutura de TEF ainda não foi aplicada neste ambiente.",
      operacaoIds: [] as string[],
    };
  }

  const idsForma = [...new Set(input.pagamentos.map((item) => item.formaPagamentoId))];
  const { data: formas, error } = await input.supabase
    .from("formas_pagamento")
    .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado, permite_troco")
    .eq("empresa_id", input.empresaId)
    .in("id", idsForma);
  if (error) {
    return {
      ok: false as const,
      erro: "Não foi possível validar as formas de pagamento.",
      operacaoIds: [] as string[],
    };
  }

  const parcelas = input.pagamentos.map((pagamento) => {
    const forma =
      (formas ?? []).find((item: Record<string, unknown>) => String(item.id) === pagamento.formaPagamentoId) ??
      null;
    return {
      modalidade: classificarFormaTef(
        forma
          ? {
              codigo: forma.codigo ? String(forma.codigo) : null,
              nome: forma.nome ? String(forma.nome) : null,
              tipo: forma.tipo ? String(forma.tipo) : null,
              codigo_fiscal: forma.codigo_fiscal ? String(forma.codigo_fiscal) : null,
              permite_fiado: forma.permite_fiado === true,
            }
          : null
      ),
      valorCentavos: pagamento.valorCentavos,
      tefOperacaoId: pagamento.tefOperacaoId,
      operacaoManual: pagamento.cartaoManual === true,
      permiteTroco: forma?.permite_troco === true,
      usuarioId: input.usuarioId,
      segredoVinculoHash: pagamento.tefVinculoSegredo
        ? hashSegredoVinculo(pagamento.tefVinculoSegredo)
        : "",
    };
  });

  const politica: PoliticaCartaoTef = {
    plataformaHabilitada: habilitacao.plataformaHabilitada,
    empresaHabilitada: habilitacao.empresaHabilitada,
    permitirOperacaoManual: habilitacao.permitirOperacaoManual,
  };
  const decisao = avaliarParcelasCartao(politica, parcelas);
  if (!decisao.ok) {
    return { ok: false as const, erro: decisao.erro, operacaoIds: [] as string[] };
  }
  const parcelasProva = parcelas.map((parcela) =>
    operacaoManualAceita(politica, parcela)
      ? { ...parcela, modalidade: null, tefOperacaoId: null }
      : parcela
  );

  const ids = parcelasProva
    .map((parcela) => parcela.tefOperacaoId)
    .filter((id): id is string => Boolean(id));
  const { data: operacoes, error: erroOps } = ids.length
    ? await input.supabase
        .from("tef_operacoes")
        .select(
          "id, empresa_id, modalidade, valor_centavos, status, venda_id, teste, nsu, autorizacao, rede, instituicao, bandeira_nome, usuario_id, segredo_vinculo_hash"
        )
        .eq("empresa_id", input.empresaId)
        .in("id", ids)
    : { data: [], error: null };

  if (erroOps) {
    return {
      ok: false as const,
      erro: "Não foi possível validar o TEF.",
      operacaoIds: [] as string[],
    };
  }

  const avaliacao = validarPagamentoMisto(
    parcelasProva,
    (operacoes ?? []).map((linha: Record<string, unknown>) => ({
      id: String(linha.id),
      empresaId: String(linha.empresa_id),
      modalidade: linha.modalidade === "credito" ? "credito" : "debito",
      valorCentavos: Number(linha.valor_centavos),
      status: linha.status as "autorizada",
      vendaId: linha.venda_id ? String(linha.venda_id) : null,
      teste: linha.teste === true,
      nsu: linha.nsu ? String(linha.nsu) : null,
      autorizacao: linha.autorizacao ? String(linha.autorizacao) : null,
      rede: linha.rede ? String(linha.rede) : null,
      instituicao: linha.instituicao ? String(linha.instituicao) : null,
      nomeBandeiraPadrao: linha.bandeira_nome ? String(linha.bandeira_nome) : null,
      usuarioId: linha.usuario_id ? String(linha.usuario_id) : "",
      segredoVinculoHash: linha.segredo_vinculo_hash
        ? String(linha.segredo_vinculo_hash)
        : "",
    })),
    input.empresaId
  );
  if (!avaliacao.ok) {
    return { ok: false as const, erro: avaliacao.erro, operacaoIds: [] as string[] };
  }
  const segredos: Record<string, string> = {};
  for (const parcela of parcelas) {
    if (parcela.tefOperacaoId && parcela.segredoVinculoHash) {
      segredos[parcela.tefOperacaoId] = parcela.segredoVinculoHash;
    }
  }
  return { ok: true as const, operacaoIds: avaliacao.operacaoIds, segredos };
}

async function bloquearCartaoSeConsultaFalhou(input: {
  supabase: {
    from: (tabela: string) => {
      select: (colunas: string) => any;
    };
  };
  empresaId: string;
  pagamentos: PagamentoTef[];
}) {
  if (input.pagamentos.some((pagamento) => pagamento.tefOperacaoId || pagamento.cartaoManual)) {
    return {
      ok: false as const,
      erro: MENSAGEM_CONSULTA_TEF,
      operacaoIds: [] as string[],
    };
  }
  const idsForma = [...new Set(input.pagamentos.map((item) => item.formaPagamentoId))];
  if (idsForma.length === 0) {
    return null;
  }
  const { data: formas, error } = await input.supabase
    .from("formas_pagamento")
    .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado")
    .eq("empresa_id", input.empresaId)
    .in("id", idsForma);
  if (error) {
    return {
      ok: false as const,
      erro: MENSAGEM_CONSULTA_TEF,
      operacaoIds: [] as string[],
    };
  }
  const temCartao = input.pagamentos.some((pagamento) => {
    const forma =
      (formas ?? []).find(
        (item: Record<string, unknown>) => String(item.id) === pagamento.formaPagamentoId
      ) ?? null;
    return (
      classificarFormaTef(
        forma
          ? {
              codigo: forma.codigo ? String(forma.codigo) : null,
              nome: forma.nome ? String(forma.nome) : null,
              tipo: forma.tipo ? String(forma.tipo) : null,
              codigo_fiscal: forma.codigo_fiscal ? String(forma.codigo_fiscal) : null,
              permite_fiado: forma.permite_fiado === true,
            }
          : null
      ) != null
    );
  });
  if (!temCartao) {
    return null;
  }
  return {
    ok: false as const,
    erro: MENSAGEM_CONSULTA_TEF,
    operacaoIds: [] as string[],
  };
}

export async function vincularTefNaVenda(input: {
  empresaId: string;
  vendaId: string;
  usuarioId: string;
  operacaoIds: string[];
  segredos: Record<string, string>;
}) {
  try {
    return await vincularOperacoesTefNaVenda(input);
  } catch {
    return { confirmacaoLiberada: false };
  }
}
