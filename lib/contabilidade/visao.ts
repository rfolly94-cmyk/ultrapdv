import type { SupabaseClient } from "@supabase/supabase-js";

import { auditarCompetencia } from "@/lib/contabilidade/auditoria";
import type { Competencia } from "@/lib/contabilidade/competencia";
import { chaveCompetencia, rotuloCompetencia } from "@/lib/contabilidade/competencia";
import { carregarDocumentosCompetencia } from "@/lib/contabilidade/documentos";

export type TotaisTributos = {
  totalVendas: number | null;
  baseIcms: null;
  icms: null;
  pis: null;
  cofins: null;
  ipi: null;
  ibs: null;
  cbs: null;
};

export async function carregarVisaoGeral(
  supabase: SupabaseClient,
  empresaId: string,
  competencia: Competencia,
  fuso?: string
) {
  const [documentos, auditoria, competenciaRow] = await Promise.all([
    carregarDocumentosCompetencia(supabase, empresaId, competencia, {}, fuso),
    auditarCompetencia(supabase, empresaId, competencia, fuso),
    supabase
      .from("contabilidade_competencias")
      .select("status, liberado_em, liberado_por")
      .eq("empresa_id", empresaId)
      .eq("ano", competencia.ano)
      .eq("mes", competencia.mes)
      .maybeSingle(),
  ]);

  const itens = documentos.todos;
  const autorizadas = itens.filter((item) => item.status === "autorizada");

  const totais: TotaisTributos = {
    totalVendas: autorizadas.length
      ? autorizadas.reduce((soma, item) => soma + item.valor, 0)
      : 0,
    baseIcms: null,
    icms: null,
    pis: null,
    cofins: null,
    ipi: null,
    ibs: null,
    cbs: null,
  };

  return {
    competencia: chaveCompetencia(competencia),
    rotulo: rotuloCompetencia(competencia),
    status: competenciaRow.data?.status ?? "ABERTA",
    liberadoEm: competenciaRow.data?.liberado_em ?? null,
    cards: {
      nfeAutorizadas: autorizadas.filter((item) => item.modelo === "55").length,
      nfceAutorizadas: autorizadas.filter((item) => item.modelo === "65").length,
      canceladas: itens.filter((item) => item.status === "cancelada").length,
      inutilizadas: itens.filter((item) => item.status === "inutilizada").length,
      rejeitadas: itens.filter((item) => item.status === "rejeitada").length,
      aguardandoReconciliacao: itens.filter(
        (item) => item.status === "aguardando_reconciliacao"
      ).length,
      aguardandoInutilizacao: itens.filter(
        (item) => item.status === "aguardando_inutilizacao"
      ).length,
    },
    totais,
    auditoria,
    xmlsDisponiveis: itens.filter((item) => item.temXml).length,
    documentos: itens.length,
  };
}
