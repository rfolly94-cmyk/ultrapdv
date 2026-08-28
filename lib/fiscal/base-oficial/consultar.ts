import type { SupabaseClient } from "@supabase/supabase-js";

import { regraVigenteEm } from "./tipos";
import type { FonteFiscalOficial, RegraFiscalOficial } from "./tipos";
import { tokensBuscaFiscal } from "@/lib/fiscal/motor/texto";
import type { RegraCestLocal } from "@/lib/fiscal/motor/cest";
import type { RegraNcmLocal } from "@/lib/fiscal/motor/ncm";
import type { CclassTribCatalogo, CstIbsCbsCatalogo } from "@/lib/fiscal/motor/ibs-cbs";

function mapearFonte(row: Record<string, unknown>): FonteFiscalOficial {
  const status = String(row.status ?? "");
  return {
    codigo: String(row.codigo ?? ""),
    nome: String(row.nome ?? ""),
    origem: String(row.origem ?? ""),
    versao: String(row.versao ?? ""),
    status:
      status === "pendente" || status === "descontinuada" ? status : "ativa",
    vigenciaInicio: String(row.vigencia_inicio ?? "").slice(0, 10),
    vigenciaFim: row.vigencia_fim ? String(row.vigencia_fim).slice(0, 10) : null,
  };
}

export async function listarFontesFiscaisOficiais(
  supabase: SupabaseClient
): Promise<FonteFiscalOficial[]> {
  const { data, error } = await supabase
    .from("fiscal_base_fontes")
    .select("codigo, nome, origem, versao, status, vigencia_inicio, vigencia_fim")
    .order("codigo");
  if (error) {
    return [];
  }
  return (data ?? []).map((row) => mapearFonte(row as Record<string, unknown>));
}

function mapearRegra(row: Record<string, unknown>): RegraFiscalOficial {
  const fonteRel = Array.isArray(row.fiscal_base_fontes)
    ? row.fiscal_base_fontes[0]
    : row.fiscal_base_fontes;
  const versaoRel = Array.isArray(row.fiscal_base_versoes)
    ? row.fiscal_base_versoes[0]
    : row.fiscal_base_versoes;
  return {
    tipo: String(row.tipo ?? ""),
    codigo: String(row.codigo ?? ""),
    descricao: row.descricao ? String(row.descricao) : null,
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
    fonte: String((fonteRel as { codigo?: string } | null)?.codigo ?? ""),
    versao: String(
      (versaoRel as { versao?: string } | null)?.versao ??
        (fonteRel as { versao?: string } | null)?.versao ??
        ""
    ),
    vigenciaInicio: String(row.vigencia_inicio ?? "").slice(0, 10),
    vigenciaFim: row.vigencia_fim ? String(row.vigencia_fim).slice(0, 10) : null,
  };
}

export async function consultarRegraFiscalOficial(params: {
  supabase: SupabaseClient;
  tipo: string;
  codigo: string;
  referencia?: Date | string;
}): Promise<RegraFiscalOficial | null> {
  const { data } = await params.supabase
    .from("fiscal_base_regras")
    .select(
      "tipo, codigo, descricao, payload, vigencia_inicio, vigencia_fim, ativo, fiscal_base_fontes ( codigo, versao ), fiscal_base_versoes ( versao, status )"
    )
    .eq("tipo", params.tipo)
    .eq("codigo", params.codigo)
    .eq("ativo", true)
    .limit(5);
  const rows = data ?? [];
  const referencia =
    params.referencia instanceof Date
      ? params.referencia.toISOString()
      : String(params.referencia ?? new Date().toISOString());
  for (const row of rows) {
    const regra = mapearRegra(row as Record<string, unknown>);
    if (regraVigenteEm(regra, referencia)) {
      return regra;
    }
  }
  return null;
}

export async function listarRegrasNcmAtivas(params: {
  supabase: SupabaseClient;
  busca?: string;
  codigo?: string;
  limite?: number;
}): Promise<RegraNcmLocal[]> {
  let query = params.supabase
    .from("fiscal_base_regras")
    .select(
      "codigo, codigo_normalizado, descricao, vigencia_inicio, vigencia_fim, ativo, payload, fiscal_base_versoes ( versao, status )"
    )
    .eq("tipo", "ncm")
    .eq("ativo", true)
    .limit(params.limite ?? 40);
  if (params.codigo) {
    const codigo = params.codigo.replace(/\D/g, "");
    if (!codigo) {
      return [];
    }
    query = query.or(`codigo.eq.${codigo},codigo_normalizado.eq.${codigo}`);
  } else if (params.busca) {
    const tokens = tokensBuscaFiscal(params.busca);
    const termo = tokens.slice(0, 4).join(" ");
    if (!termo) {
      return [];
    }
    query = query.ilike("descricao", `%${termo.replace(/[%_]/g, "")}%`);
  } else {
    return [];
  }
  const { data, error } = await query;
  if (error || !data) {
    return [];
  }
  return data
    .filter((row) => {
      const versao = Array.isArray(row.fiscal_base_versoes)
        ? row.fiscal_base_versoes[0]
        : row.fiscal_base_versoes;
      return !versao || String((versao as { status?: string }).status) === "ativa";
    })
    .map((row) => {
      const versao = Array.isArray(row.fiscal_base_versoes)
        ? row.fiscal_base_versoes[0]
        : row.fiscal_base_versoes;
      return {
        codigo: String(row.codigo_normalizado || row.codigo || ""),
        descricao: row.descricao ? String(row.descricao) : null,
        versao: String((versao as { versao?: string } | null)?.versao ?? ""),
        vigenciaInicio: String(row.vigencia_inicio ?? "").slice(0, 10),
        vigenciaFim: row.vigencia_fim
          ? String(row.vigencia_fim).slice(0, 10)
          : null,
        ativo: row.ativo !== false,
      };
    });
}

export async function listarRegrasCestAtivas(params: {
  supabase: SupabaseClient;
  cest?: string;
  ncm?: string;
  limite?: number;
}): Promise<RegraCestLocal[]> {
  let query = params.supabase
    .from("fiscal_base_regras")
    .select(
      "codigo, codigo_normalizado, descricao, vigencia_inicio, vigencia_fim, ativo, payload, fiscal_base_versoes ( versao, status )"
    )
    .in("tipo", ["cest", "cest_ncm"])
    .eq("ativo", true)
    .limit(params.limite ?? 40);
  if (params.cest) {
    const cest = params.cest.replace(/\D/g, "");
    if (!cest) {
      return [];
    }
    query = query.or(`codigo.eq.${cest},codigo_normalizado.eq.${cest}`);
  } else if (params.ncm) {
    const ncm = params.ncm.replace(/\D/g, "");
    if (!ncm) {
      return [];
    }
    query = query.contains("payload", { ncm });
  } else {
    return [];
  }
  const { data, error } = await query;
  if (error || !data) {
    return [];
  }
  return data
    .filter((row) => {
      const versao = Array.isArray(row.fiscal_base_versoes)
        ? row.fiscal_base_versoes[0]
        : row.fiscal_base_versoes;
      return !versao || String((versao as { status?: string }).status) === "ativa";
    })
    .map((row) => {
      const versao = Array.isArray(row.fiscal_base_versoes)
        ? row.fiscal_base_versoes[0]
        : row.fiscal_base_versoes;
      const payload =
        row.payload && typeof row.payload === "object"
          ? (row.payload as Record<string, unknown>)
          : {};
      return {
        codigo: String(row.codigo_normalizado || row.codigo || ""),
        descricao: row.descricao ? String(row.descricao) : null,
        ncm: payload.ncm ? String(payload.ncm) : null,
        segmento: payload.segmento ? String(payload.segmento) : null,
        versao: String((versao as { versao?: string } | null)?.versao ?? ""),
        vigenciaInicio: String(row.vigencia_inicio ?? "").slice(0, 10),
        vigenciaFim: row.vigencia_fim
          ? String(row.vigencia_fim).slice(0, 10)
          : null,
        ativo: row.ativo !== false,
      };
    });
}

export async function consultarCstIbsCbsCatalogo(params: {
  supabase: SupabaseClient;
  codigo: string;
}) {
  const { data, error } = await params.supabase
    .from("fiscal_cst_ibscbs_catalogo")
    .select("codigo, descricao, permite_nfe, permite_nfce, ativo")
    .eq("codigo", params.codigo)
    .eq("ativo", true)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return {
    codigo: String(data.codigo),
    descricao: data.descricao ? String(data.descricao) : null,
    permiteNfe: data.permite_nfe === true,
    permiteNfce: data.permite_nfce === true,
    fonte: "fiscal_cst_ibscbs_catalogo",
  };
}

export async function consultarCclassTribCatalogo(params: {
  supabase: SupabaseClient;
  codigo?: string | null;
  cstCodigo?: string | null;
}) {
  let query = params.supabase
    .from("fiscal_cclasstrib_catalogo")
    .select(
      "codigo, cst_codigo, descricao, percentual_reducao_ibs, percentual_reducao_cbs, permite_nfe, permite_nfce, ativo"
    )
    .eq("ativo", true)
    .limit(20);
  if (params.codigo) {
    query = query.eq("codigo", params.codigo);
  } else if (params.cstCodigo) {
    query = query.eq("cst_codigo", params.cstCodigo);
  } else {
    return [];
  }
  const { data, error } = await query;
  if (error) {
    return [];
  }
  return (data ?? []).map((item) => ({
    codigo: String(item.codigo),
    cstCodigo: String(item.cst_codigo ?? ""),
    descricao: item.descricao ? String(item.descricao) : null,
    reducaoIbs: Number(item.percentual_reducao_ibs ?? 0),
    reducaoCbs: Number(item.percentual_reducao_cbs ?? 0),
    permiteNfe: item.permite_nfe === true,
    permiteNfce: item.permite_nfce === true,
    fonte: "fiscal_cclasstrib_catalogo",
  }));
}

export async function carregarCatalogosIbsCbs(supabase: SupabaseClient): Promise<{
  csts: CstIbsCbsCatalogo[];
  classes: CclassTribCatalogo[];
}> {
  const [csts, classes] = await Promise.all([
    supabase
      .from("fiscal_cst_ibscbs_catalogo")
      .select("codigo, descricao, permite_nfe, permite_nfce, ativo")
      .eq("ativo", true),
    supabase
      .from("fiscal_cclasstrib_catalogo")
      .select(
        "codigo, cst_codigo, descricao, percentual_reducao_ibs, percentual_reducao_cbs, permite_nfe, permite_nfce, ativo"
      )
      .eq("ativo", true),
  ]);
  return {
    csts: (csts.data ?? []).map((item) => ({
      codigo: String(item.codigo),
      descricao: item.descricao ? String(item.descricao) : null,
      permiteNfe: item.permite_nfe === true,
      permiteNfce: item.permite_nfce === true,
      ativo: item.ativo !== false,
    })),
    classes: (classes.data ?? []).map((item) => ({
      codigo: String(item.codigo),
      cstCodigo: String(item.cst_codigo ?? ""),
      descricao: item.descricao ? String(item.descricao) : null,
      reducaoIbs: Number(item.percentual_reducao_ibs ?? 0),
      reducaoCbs: Number(item.percentual_reducao_cbs ?? 0),
      permiteNfe: item.permite_nfe === true,
      permiteNfce: item.permite_nfce === true,
      ativo: item.ativo !== false,
    })),
  };
}

export async function contarRegrasTipo(params: {
  supabase: SupabaseClient;
  tipo: string;
}) {
  const { count } = await params.supabase
    .from("fiscal_base_regras")
    .select("id", { count: "exact", head: true })
    .eq("tipo", params.tipo)
    .eq("ativo", true);
  return count ?? 0;
}

export function resumoFontesParaIa(fontes: FonteFiscalOficial[]) {
  return fontes.map((fonte) => ({
    codigo: fonte.codigo,
    status: fonte.status,
    versao: fonte.versao,
    origem: fonte.origem,
  }));
}
