import "server-only";

import {
  avaliarParcelasCartao,
  operacaoManualAceita,
  type PoliticaCartaoTef,
} from "@/lib/pdv/tef/cartao-checkout";
import {
  formaDaModalidadeEfetiva,
  mensagemFormaAusente,
} from "@/lib/pdv/tef/modalidade-efetiva";
import { classificarFormaTef, validarPagamentoMisto, type ModalidadeTef } from "@/lib/pdv/tef/regras";
import { hashSegredoVinculo } from "@/lib/pdv/tef/prova";
import {
  ErroTef,
  lerHabilitacaoTef,
  marcarPendenciaFormaTefPersistida,
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
    return { ok: true as const, operacaoIds: [] as string[], segredos: {}, ajustes: [] };
  }

  const informouTef = input.pagamentos.some((pagamento) => pagamento.tefOperacaoId);
  if (!habilitacao.empresaHabilitada && !informouTef) {
    return { ok: true as const, operacaoIds: [] as string[], segredos: {}, ajustes: [] };
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
          "id, empresa_id, modalidade, valor_centavos, status, venda_id, teste, nsu, autorizacao, rede, instituicao, bandeira_nome, usuario_id, segredo_vinculo_hash, ambiente_efetivo"
        )
        .eq("empresa_id", input.empresaId)
        .in("id", ids)
    : { data: [], error: null };

  if (erroOps) {
    const detalhe = `${erroOps.code ?? ""} ${erroOps.message ?? ""}`;
    return {
      ok: false as const,
      erro: /42703|PGRST204|ambiente_efetivo/i.test(detalhe)
        ? "A comprovação de ambiente do TEF ainda não está disponível. A venda não foi finalizada."
        : "Não foi possível validar o TEF.",
      operacaoIds: [] as string[],
    };
  }

  const formasTef = (formas ?? []).map((item: Record<string, unknown>) => ({
    id: String(item.id),
    codigo: item.codigo ? String(item.codigo) : null,
    nome: item.nome ? String(item.nome) : null,
    tipo: item.tipo ? String(item.tipo) : null,
    codigo_fiscal: item.codigo_fiscal ? String(item.codigo_fiscal) : null,
    permite_fiado: item.permite_fiado === true,
  }));
  const ajustes: Array<{
    indice: number;
    formaPagamentoId: string;
    aviso: string | null;
  }> = [];
  const parcelasAlinhadas = parcelasProva.map((parcela, indice) => {
    if (!parcela.modalidade || !parcela.tefOperacaoId) {
      return parcela;
    }
    const operacao = (operacoes ?? []).find(
      (item: Record<string, unknown>) => String(item.id) === parcela.tefOperacaoId
    );
    const efetiva: ModalidadeTef | null =
      operacao?.modalidade === "credito" || operacao?.modalidade === "debito"
        ? operacao.modalidade
        : null;
    if (!efetiva || efetiva === parcela.modalidade) {
      return parcela;
    }
    const forma = formaDaModalidadeEfetiva(
      formasTef,
      efetiva,
      input.pagamentos[indice]?.formaPagamentoId
    );
    if (!forma) {
      return parcela;
    }
    ajustes.push({
      indice,
      formaPagamentoId: forma.id,
      aviso:
        efetiva === "credito"
          ? "Pagamento aprovado no crédito"
          : "Pagamento aprovado no débito",
    });
    return { ...parcela, modalidade: efetiva };
  });
  const semForma = parcelasProva.find((parcela, indice) => {
    if (!parcela.modalidade || !parcela.tefOperacaoId) {
      return false;
    }
    const operacao = (operacoes ?? []).find(
      (item: Record<string, unknown>) => String(item.id) === parcela.tefOperacaoId
    );
    const efetiva = operacao?.modalidade === "credito" || operacao?.modalidade === "debito"
      ? operacao.modalidade
      : null;
    return Boolean(efetiva && efetiva !== parcela.modalidade && !ajustes.some((item) => item.indice === indice));
  });
  if (semForma) {
    const operacao = (operacoes ?? []).find(
      (item: Record<string, unknown>) => String(item.id) === semForma.tefOperacaoId
    );
    const efetiva = operacao?.modalidade === "credito" ? "credito" : "debito";
    if (semForma.tefOperacaoId) {
      await marcarPendenciaFormaTefPersistida({
        empresaId: input.empresaId,
        operacaoId: semForma.tefOperacaoId,
      }).catch(() => undefined);
    }
    return {
      ok: false as const,
      erro: mensagemFormaAusente(efetiva),
      operacaoIds: [] as string[],
    };
  }

  const avaliacao = validarPagamentoMisto(
    parcelasAlinhadas,
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
      ambienteEfetivo: linha.ambiente_efetivo ? String(linha.ambiente_efetivo) : "",
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
  return { ok: true as const, operacaoIds: avaliacao.operacaoIds, segredos, ajustes };
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
