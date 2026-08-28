import type { SupabaseClient } from "@supabase/supabase-js";

import { contarRegrasTipo, listarFontesFiscaisOficiais } from "./consultar";

export type StatusTabelaBase = {
  codigo: string;
  nome: string;
  status: "Atualizada" | "Verificando" | "Erro — usando última versão válida" | "Pendente";
  versao: string;
  quantidade: number | null;
};

export async function statusBaseFiscalUltrapdv(supabase: SupabaseClient) {
  const [fontes, job, ncm, cest, cst, cclass] = await Promise.all([
    listarFontesFiscaisOficiais(supabase),
    supabase
      .from("fiscal_base_atualizacoes")
      .select("iniciado_em, finalizado_em, status, erro")
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    contarRegrasTipo({ supabase, tipo: "ncm" }),
    contarRegrasTipo({ supabase, tipo: "cest" }),
    supabase
      .from("fiscal_cst_ibscbs_catalogo")
      .select("codigo", { count: "exact", head: true })
      .eq("ativo", true),
    supabase
      .from("fiscal_cclasstrib_catalogo")
      .select("codigo", { count: "exact", head: true })
      .eq("ativo", true),
  ]);

  const jobRow = job.data;
  const verificando = jobRow?.status === "verificando" && !jobRow.finalizado_em;
  const tabelas: StatusTabelaBase[] = [
    {
      codigo: "ncm",
      nome: "NCM",
      status: rotulo(fontes.find((f) => f.codigo === "ncm_oficial"), ncm, verificando),
      versao: fontes.find((f) => f.codigo === "ncm_oficial")?.versao ?? "nao_importada",
      quantidade: ncm,
    },
    {
      codigo: "cest",
      nome: "CEST",
      status: rotulo(fontes.find((f) => f.codigo === "cest_oficial"), cest, verificando),
      versao: fontes.find((f) => f.codigo === "cest_oficial")?.versao ?? "nao_importada",
      quantidade: cest,
    },
    {
      codigo: "ibs_cbs",
      nome: "IBS/CBS",
      status: rotulo(
        fontes.find((f) => f.codigo === "cst_ibscbs_catalogo"),
        cst.count ?? 0,
        verificando
      ),
      versao: fontes.find((f) => f.codigo === "cst_ibscbs_catalogo")?.versao ?? "catalogo-interno",
      quantidade: cst.count ?? 0,
    },
    {
      codigo: "cclasstrib",
      nome: "cClassTrib",
      status: rotulo(
        fontes.find((f) => f.codigo === "cclasstrib_catalogo"),
        cclass.count ?? 0,
        verificando
      ),
      versao: fontes.find((f) => f.codigo === "cclasstrib_catalogo")?.versao ?? "catalogo-interno",
      quantidade: cclass.count ?? 0,
    },
  ];

  return {
    tabelas,
    ultimaVerificacao: jobRow?.iniciado_em ? String(jobRow.iniciado_em) : null,
    ultimaAtualizacao: jobRow?.finalizado_em ? String(jobRow.finalizado_em) : null,
    statusGeral: verificando
      ? ("Verificando" as const)
      : jobRow?.status === "erro"
        ? ("Erro — usando última versão válida" as const)
        : tabelas.some((t) => t.status === "Pendente")
          ? ("Pendente" as const)
          : ("Atualizada" as const),
  };
}

function rotulo(
  fonte: { status: string } | undefined,
  quantidade: number,
  verificando: boolean
): StatusTabelaBase["status"] {
  if (verificando) {
    return "Verificando";
  }
  if (fonte?.status === "pendente" || quantidade === 0) {
    return "Pendente";
  }
  if (fonte?.status === "descontinuada") {
    return "Erro — usando última versão válida";
  }
  return "Atualizada";
}
